package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ailxpSeedanceAssetUploadPath = "/kyyReactApiServer/asset/seedance2/assetUpload"
	ailxpSeedanceAssetDetailPath = "/kyyReactApiServer/asset/seedance2/assetDetail"
	ailxpSeedanceAssetWaitTimeout = 2 * time.Minute
	ailxpSeedanceAssetPollInterval = 2 * time.Second
)

type ailxpSeedanceReferenceAsset struct {
	ID        int64
	PublicID  string
	ObjectKey string
	Kind      string
}

type ailxpSeedanceAssetMapping struct {
	UpstreamAssetID string
	Status          string
}

type ailxpSeedanceAssetResponse struct {
	AssetID             string          `json:"assetId"`
	AssetType           string          `json:"assetType"`
	URL                 string          `json:"url"`
	Status              string          `json:"status"`
	Name                string          `json:"name"`
	ErrorMessage        string          `json:"errorMessage"`
	LegacyErrorMessage  string          `json:"error_message"`
	Message             string          `json:"message"`
	Data                json.RawMessage `json:"data"`
}

type ailxpSeedanceReferenceSource struct {
	URL          string
	ExpectedKind string
}

func isAILXPSeedance2Route(runtimeRule map[string]interface{}) bool {
	upstream, _ := runtimeRule["upstream"].(map[string]interface{})
	return strings.EqualFold(strings.TrimSpace(fmt.Sprint(upstream["adapter"])), "ailxp_seedance_2")
}

// prepareAILXPSeedanceReferences turns owned Tuna assets into AILXP asset IDs before video submission.
func prepareAILXPSeedanceReferences(ctx context.Context, pool *pgxpool.Pool, p ImageTaskPayload, route workerModelRoute, payload map[string]interface{}) error {
	sources := ailxpSeedanceReferenceSources(p.Input)
	if len(sources) == 0 {
		return nil
	}
	if objectStore == nil {
		return fmt.Errorf("参考素材存储不可用")
	}
	if route.ID <= 0 {
		return fmt.Errorf("参考素材线路配置无效")
	}

	assetIDs := uniqueNonEmptyStrings(ailxpStringList(p.Input["reference_asset_ids"]))
	if len(assetIDs) == 0 {
		return fmt.Errorf("参考素材必须从当前账号的资产库上传")
	}
	assets, err := loadAILXPSeedanceReferenceAssets(ctx, pool, p.UserID, assetIDs)
	if err != nil {
		return err
	}
	if len(assets) != len(assetIDs) {
		return fmt.Errorf("参考素材不存在或无权访问")
	}

	assetsByObjectKey := make(map[string]ailxpSeedanceReferenceAsset, len(assets))
	for _, asset := range assets {
		assetsByObjectKey[asset.ObjectKey] = asset
	}

	replacements := make(map[string]string, len(sources))
	resolved := make(map[int64]string, len(sources))
	for _, source := range sources {
		objectKey := objectStore.ObjectKeyFromURL(source.URL)
		asset, ok := assetsByObjectKey[objectKey]
		if objectKey == "" || !ok {
			return fmt.Errorf("参考素材地址与当前账号资产不匹配")
		}
		if !strings.EqualFold(asset.Kind, source.ExpectedKind) {
			return fmt.Errorf("参考素材类型不匹配：需要%s素材", ailxpSeedanceKindLabel(source.ExpectedKind))
		}
		if upstreamAssetID, ok := resolved[asset.ID]; ok {
			replacements[source.URL] = "assetId://" + upstreamAssetID
			continue
		}
		upstreamAssetID, err := ensureAILXPSeedanceAssetActive(ctx, pool, route, p.UserID, asset, source.URL)
		if err != nil {
			return err
		}
		resolved[asset.ID] = upstreamAssetID
		replacements[source.URL] = "assetId://" + upstreamAssetID
	}
	replaceAILXPSeedanceReferences(payload, replacements)
	return nil
}

func ailxpSeedanceReferenceSources(input map[string]interface{}) []ailxpSeedanceReferenceSource {
	sources := make([]ailxpSeedanceReferenceSource, 0, 8)
	appendSources := func(value interface{}, expectedKind string) {
		for _, rawURL := range ailxpStringList(value) {
			if normalized := strings.TrimSpace(rawURL); normalized != "" {
				sources = append(sources, ailxpSeedanceReferenceSource{URL: normalized, ExpectedKind: expectedKind})
			}
		}
	}
	appendSources(input["reference_images"], "image")
	appendSources(input["first_frame"], "image")
	appendSources(input["last_frame"], "image")
	appendSources(input["image_url"], "image")
	appendSources(input["image"], "image")
	appendSources(input["reference_videos"], "video")
	appendSources(input["reference_audios"], "audio")
	appendSources(input["reference_audio"], "audio")
	return sources
}

func ailxpStringList(value interface{}) []string {
	switch typed := value.(type) {
	case string:
		return []string{typed}
	case []string:
		return typed
	case []interface{}:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	case map[string]interface{}:
		if text, ok := typed["url"].(string); ok {
			return []string{text}
		}
	}
	return nil
}

func uniqueNonEmptyStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func loadAILXPSeedanceReferenceAssets(ctx context.Context, pool *pgxpool.Pool, userID int64, publicIDs []string) ([]ailxpSeedanceReferenceAsset, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, public_id, object_key, kind
		FROM assets
		WHERE user_id=$1 AND public_id=ANY($2)
	`, userID, publicIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]ailxpSeedanceReferenceAsset, 0, len(publicIDs))
	for rows.Next() {
		var asset ailxpSeedanceReferenceAsset
		if err := rows.Scan(&asset.ID, &asset.PublicID, &asset.ObjectKey, &asset.Kind); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return assets, nil
}

func ensureAILXPSeedanceAssetActive(ctx context.Context, pool *pgxpool.Pool, route workerModelRoute, userID int64, asset ailxpSeedanceReferenceAsset, sourceURL string) (string, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return "", err
	}
	lockKey := fmt.Sprintf("ailxp-seedance-asset:%d:%d:%d", userID, route.ID, asset.ID)
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext($1))`, lockKey); err != nil {
		conn.Release()
		return "", err
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtext($1))`, lockKey)
		conn.Release()
	}()

	mapping, found, err := loadAILXPSeedanceAssetMapping(ctx, pool, userID, route.ID, asset.ID)
	if err != nil {
		return "", err
	}
	if found && mapping.UpstreamAssetID != "" {
		detail, err := getAILXPSeedanceAssetDetail(ctx, route, mapping.UpstreamAssetID)
		if err != nil {
			return "", err
		}
		if err := saveAILXPSeedanceAssetMapping(ctx, pool, userID, route.ID, asset, sourceURL, detail); err != nil {
			return "", err
		}
		if strings.EqualFold(strings.TrimSpace(detail.Status), "ACTIVE") {
			return detail.AssetID, nil
		}
		if !ailxpSeedanceAssetNeedsReupload(detail.Status) {
			return waitForAILXPSeedanceAssetActive(ctx, pool, route, userID, asset, sourceURL, detail)
		}
	}

	created, err := uploadAILXPSeedanceAsset(ctx, route, asset, sourceURL)
	if err != nil {
		return "", err
	}
	if err := saveAILXPSeedanceAssetMapping(ctx, pool, userID, route.ID, asset, sourceURL, created); err != nil {
		return "", err
	}
	return waitForAILXPSeedanceAssetActive(ctx, pool, route, userID, asset, sourceURL, created)
}

func loadAILXPSeedanceAssetMapping(ctx context.Context, pool *pgxpool.Pool, userID, routeID, assetID int64) (ailxpSeedanceAssetMapping, bool, error) {
	var mapping ailxpSeedanceAssetMapping
	err := pool.QueryRow(ctx, `
		SELECT upstream_asset_id, status
		FROM ailxp_seedance_assets
		WHERE user_id=$1 AND route_id=$2 AND asset_id=$3
	`, userID, routeID, assetID).Scan(&mapping.UpstreamAssetID, &mapping.Status)
	if err == pgx.ErrNoRows {
		return ailxpSeedanceAssetMapping{}, false, nil
	}
	if err != nil {
		return ailxpSeedanceAssetMapping{}, false, err
	}
	return mapping, true, nil
}

func saveAILXPSeedanceAssetMapping(ctx context.Context, pool *pgxpool.Pool, userID, routeID int64, asset ailxpSeedanceReferenceAsset, sourceURL string, upstream ailxpSeedanceAssetResponse) error {
	status := strings.ToUpper(strings.TrimSpace(upstream.Status))
	if status == "" {
		status = "PROCESSING"
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO ailxp_seedance_assets
			(user_id, route_id, asset_id, source_url, asset_type, upstream_asset_id, status, error_message, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),now(),now())
		ON CONFLICT (user_id, route_id, asset_id) DO UPDATE
		SET source_url=EXCLUDED.source_url,
			asset_type=EXCLUDED.asset_type,
			upstream_asset_id=EXCLUDED.upstream_asset_id,
			status=EXCLUDED.status,
			error_message=EXCLUDED.error_message,
			updated_at=now()
	`, userID, routeID, asset.ID, sourceURL, ailxpSeedanceAssetType(asset.Kind), upstream.AssetID, status, ailxpSeedanceAssetError(upstream))
	return err
}

func waitForAILXPSeedanceAssetActive(ctx context.Context, pool *pgxpool.Pool, route workerModelRoute, userID int64, asset ailxpSeedanceReferenceAsset, sourceURL string, current ailxpSeedanceAssetResponse) (string, error) {
	if strings.TrimSpace(current.AssetID) == "" {
		return "", fmt.Errorf("上游参考素材未返回 assetId")
	}
	deadline := time.Now().Add(ailxpSeedanceAssetWaitTimeout)
	for {
		status := strings.ToUpper(strings.TrimSpace(current.Status))
		switch status {
		case "ACTIVE":
			return current.AssetID, nil
		case "FAILED", "EXPIRED", "DELETED":
			return "", fmt.Errorf("参考素材不可用：%s", firstNonEmpty(ailxpSeedanceAssetError(current), status))
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("参考素材仍在处理中，请稍后重试")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(ailxpSeedanceAssetPollInterval):
		}
		next, err := getAILXPSeedanceAssetDetail(ctx, route, current.AssetID)
		if err != nil {
			return "", err
		}
		if err := saveAILXPSeedanceAssetMapping(ctx, pool, userID, route.ID, asset, sourceURL, next); err != nil {
			return "", err
		}
		current = next
	}
}

func uploadAILXPSeedanceAsset(ctx context.Context, route workerModelRoute, asset ailxpSeedanceReferenceAsset, sourceURL string) (ailxpSeedanceAssetResponse, error) {
	requestBody, _ := json.Marshal(map[string]string{
		"assetType": ailxpSeedanceAssetType(asset.Kind),
		"url":       sourceURL,
		"name":      truncateAILXPSeedanceAssetName(asset.PublicID),
	})
	return callAILXPSeedanceAssetAPI(ctx, route, ailxpSeedanceAssetUploadPath, requestBody)
}

func getAILXPSeedanceAssetDetail(ctx context.Context, route workerModelRoute, assetID string) (ailxpSeedanceAssetResponse, error) {
	requestBody, _ := json.Marshal(map[string]string{"assetId": strings.TrimPrefix(strings.TrimSpace(assetID), "assetId://")})
	return callAILXPSeedanceAssetAPI(ctx, route, ailxpSeedanceAssetDetailPath, requestBody)
}

func callAILXPSeedanceAssetAPI(ctx context.Context, route workerModelRoute, path string, body []byte) (ailxpSeedanceAssetResponse, error) {
	baseURL, err := ailxpSeedanceAssetBaseURL(route.Connection.BaseURL, route.RuntimeRule)
	if err != nil {
		return ailxpSeedanceAssetResponse{}, err
	}
	responseBody, statusCode, err := doJSONRequest(ctx, route.Connection, "POST", joinBaseEndpoint(baseURL, path), body, 30*time.Second)
	if err != nil {
		return ailxpSeedanceAssetResponse{}, err
	}
	if statusCode < 200 || statusCode >= 300 {
		return ailxpSeedanceAssetResponse{}, fmt.Errorf("上游参考素材请求失败（HTTP %d）：%s", statusCode, truncateText(string(responseBody), 300))
	}
	response, err := decodeAILXPSeedanceAssetResponse(responseBody)
	if err != nil {
		return ailxpSeedanceAssetResponse{}, err
	}
	if strings.TrimSpace(response.AssetID) == "" {
		return ailxpSeedanceAssetResponse{}, fmt.Errorf("上游参考素材请求未返回 assetId：%s", firstNonEmpty(ailxpSeedanceAssetError(response), truncateText(string(responseBody), 300)))
	}
	return response, nil
}

func decodeAILXPSeedanceAssetResponse(raw []byte) (ailxpSeedanceAssetResponse, error) {
	var response ailxpSeedanceAssetResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return ailxpSeedanceAssetResponse{}, fmt.Errorf("解析上游参考素材响应失败：%w", err)
	}
	if strings.TrimSpace(response.AssetID) == "" && len(response.Data) > 0 && string(response.Data) != "null" {
		var nested ailxpSeedanceAssetResponse
		if err := json.Unmarshal(response.Data, &nested); err == nil {
			if nested.Message == "" {
				nested.Message = response.Message
			}
			response = nested
		}
	}
	return response, nil
}

func ailxpSeedanceAssetBaseURL(routeBaseURL string, runtimeRule map[string]interface{}) (string, error) {
	if upstream, ok := runtimeRule["upstream"].(map[string]interface{}); ok {
		if configured := strings.TrimSpace(fmt.Sprint(upstream["asset_base_url"])); configured != "" && configured != "<nil>" {
			return trimRightSlash(configured), nil
		}
	}
	parsed, err := url.Parse(strings.TrimSpace(routeBaseURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("上游素材 API 地址无效")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if strings.HasSuffix(parsed.Path, "/v1") {
		parsed.Path = strings.TrimSuffix(parsed.Path, "/v1")
	}
	return trimRightSlash(parsed.String()), nil
}

func ailxpSeedanceAssetNeedsReupload(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "FAILED", "EXPIRED", "DELETED":
		return true
	default:
		return false
	}
}

func ailxpSeedanceAssetType(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "video":
		return "Video"
	case "audio":
		return "Audio"
	default:
		return "Image"
	}
}

func ailxpSeedanceKindLabel(kind string) string {
	switch kind {
	case "video":
		return "视频"
	case "audio":
		return "音频"
	default:
		return "图片"
	}
}

func ailxpSeedanceAssetError(response ailxpSeedanceAssetResponse) string {
	return firstNonEmpty(strings.TrimSpace(response.ErrorMessage), strings.TrimSpace(response.LegacyErrorMessage), strings.TrimSpace(response.Message))
}

func truncateAILXPSeedanceAssetName(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > 50 {
		runes = runes[:50]
	}
	return string(runes)
}

func replaceAILXPSeedanceReferences(payload map[string]interface{}, replacements map[string]string) {
	for _, key := range []string{"reference_images", "reference_videos", "reference_audios", "reference_audio", "first_frame", "last_frame", "image", "image_url"} {
		if value, ok := payload[key]; ok {
			payload[key] = replaceAILXPSeedanceReferenceValue(value, replacements)
		}
	}
	if content, ok := payload["content"].([]interface{}); ok {
		for _, raw := range content {
			item, _ := raw.(map[string]interface{})
			if item == nil {
				continue
			}
			for _, key := range []string{"image_url", "video_url", "audio_url"} {
				if value, ok := item[key]; ok {
					item[key] = replaceAILXPSeedanceReferenceValue(value, replacements)
				}
			}
		}
	}
}

func replaceAILXPSeedanceReferenceValue(value interface{}, replacements map[string]string) interface{} {
	switch typed := value.(type) {
	case string:
		if replacement, ok := replacements[typed]; ok {
			return replacement
		}
		return typed
	case []string:
		out := make([]string, len(typed))
		for index, item := range typed {
			out[index] = fmt.Sprint(replaceAILXPSeedanceReferenceValue(item, replacements))
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(typed))
		for index, item := range typed {
			out[index] = replaceAILXPSeedanceReferenceValue(item, replacements)
		}
		return out
	case map[string]interface{}:
		out := make(map[string]interface{}, len(typed))
		for key, item := range typed {
			out[key] = replaceAILXPSeedanceReferenceValue(item, replacements)
		}
		return out
	default:
		return value
	}
}
