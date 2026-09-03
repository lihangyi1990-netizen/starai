package service

import (
	"context"
	"encoding/json"
	"strings"
)

// GatewayCatalogModel is a model advertised by the server-to-server gateway.
// It intentionally carries no upstream credential: PICO always uses the
// runtime-level gateway token, never a provider account credential.
type GatewayCatalogModel struct {
	Code           string
	DisplayName    string
	Provider       string
	ProviderSource string
	Category       string
	Endpoint       string
	RequestMode    string
	// AudioCapable allows a multimodal model to be shown in the audio
	// capability view without changing its primary category or transport mode.
	AudioCapable bool
	SortOrder      int
}

// Keep an audio capability marker when syncing a catalog, without replacing
// an operator's explicit runtime rule.
const gatewayCatalogRuntimeRuleUpsertSQL = `CASE
	WHEN models.runtime_rule IS NULL OR models.runtime_rule='{}'::jsonb THEN EXCLUDED.runtime_rule
	WHEN EXCLUDED.runtime_rule ? 'capabilities'
		AND NOT (COALESCE(models.runtime_rule->'capabilities','{}'::jsonb) ? 'audio_output')
		THEN jsonb_set(
			models.runtime_rule,
			'{capabilities}',
			COALESCE(models.runtime_rule->'capabilities','{}'::jsonb) || EXCLUDED.runtime_rule->'capabilities',
			true
		)
	ELSE models.runtime_rule
	END`

// Keep the catalog metadata useful to customers without revealing how the
// models are connected behind the Tuna API. The source marker itself lives in
// new_api_extra_params and remains available to admin-only code paths.
const gatewayCatalogPublicDescription = "适用于当前创作功能的模型"

// This is the description written by older catalog syncs. It is kept here so
// a subsequent sync can replace it for rows that have not been customized by
// an operator.
const gatewayCatalogLegacyDescription = "来自已授权的 Sub2API 账号池，模型目录会自动同步。"

var gatewayCatalogInternalTerms = []string{
	"sub2api", "newapi", "new-api", "starai", "pico", "gateway", "upstream",
	"account pool", "账号池", "号池", "上游", "网关",
}

var gatewayCatalogSensitiveTerms = []string{
	"sub2api", "newapi", "new-api", "starai", "pico", "账号池", "号池", "上游", "网关",
}

var gatewayCatalogPrivateKeys = map[string]struct{}{
	"connection": {}, "new_api_extra_params": {}, "catalog_source": {}, "catalog_status": {},
	"provider_source": {}, "api_key": {}, "access_token": {}, "authorization": {}, "headers": {},
	"base_url": {}, "endpoint": {}, "upstream_url": {}, "provider_url": {}, "credentials": {},
	"credential": {}, "provider_cost": {}, "upstream_cost": {}, "cost_rule": {}, "margin": {}, "profit": {},
}

func gatewayCatalogPublicMetadata(category string) (string, []string) {
	category = strings.TrimSpace(category)
	if category == "" {
		category = "chat"
	}
	return gatewayCatalogPublicDescription, []string{category}
}

func gatewayCatalogContainsInternalTerm(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return false
	}
	for _, term := range gatewayCatalogInternalTerms {
		if strings.Contains(value, term) {
			return true
		}
	}
	return false
}

func gatewayCatalogContainsSensitiveTerm(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return false
	}
	for _, term := range gatewayCatalogSensitiveTerms {
		if strings.Contains(value, term) {
			return true
		}
	}
	return false
}

func gatewayCatalogPrivateKey(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	key = strings.ReplaceAll(key, "-", "_")
	if key == "" {
		return false
	}
	_, found := gatewayCatalogPrivateKeys[key]
	return found
}

// sanitizeGatewayCatalogValue keeps UI configuration (for example video
// upload profiles and schema defaults) but strips transport credentials,
// endpoints, and infrastructure-labelled values. Public DTOs are the only
// callers; runtime invocation continues to read the unmodified ModelFull row.
func sanitizeGatewayCatalogValue(value interface{}) interface{} {
	switch value := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(value))
		for key, child := range value {
			if gatewayCatalogPrivateKey(key) {
				continue
			}
			if text, ok := child.(string); ok && gatewayCatalogContainsInternalTerm(text) {
				continue
			}
			out[key] = sanitizeGatewayCatalogValue(child)
		}
		return out
	case []interface{}:
		out := make([]interface{}, 0, len(value))
		for _, child := range value {
			if text, ok := child.(string); ok && gatewayCatalogContainsInternalTerm(text) {
				continue
			}
			out = append(out, sanitizeGatewayCatalogValue(child))
		}
		return out
	default:
		return value
	}
}

func sanitizeGatewayCatalogMap(value map[string]interface{}) map[string]interface{} {
	if value == nil {
		return nil
	}
	cleaned, _ := sanitizeGatewayCatalogValue(value).(map[string]interface{})
	return cleaned
}

func sanitizeGatewayCatalogDocValue(value interface{}) interface{} {
	switch value := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(value))
		for key, child := range value {
			if text, ok := child.(string); ok && gatewayCatalogContainsSensitiveTerm(text) {
				out[key] = "平台模型服务"
				continue
			}
			out[key] = sanitizeGatewayCatalogDocValue(child)
		}
		return out
	case []interface{}:
		out := make([]interface{}, 0, len(value))
		for _, child := range value {
			out = append(out, sanitizeGatewayCatalogDocValue(child))
		}
		return out
	case []string:
		out := make([]string, len(value))
		for i, child := range value {
			if gatewayCatalogContainsSensitiveTerm(child) {
				out[i] = "平台模型服务"
			} else {
				out[i] = child
			}
		}
		return out
	case []map[string]interface{}:
		out := make([]map[string]interface{}, len(value))
		for i, child := range value {
			out[i], _ = sanitizeGatewayCatalogDocValue(child).(map[string]interface{})
		}
		return out
	default:
		return value
	}
}

// SanitizePublicAPIDoc removes legacy brand/source wording from customer
// documentation while preserving its protocol fields and examples. Admin
// documentation endpoints intentionally do not call this helper.
func SanitizePublicAPIDoc(doc *APIDocDTO) {
	if doc == nil {
		return
	}
	if gatewayCatalogContainsSensitiveTerm(doc.ModelDesc) {
		doc.ModelDesc = gatewayCatalogPublicDescription
	}
	if doc.Content != nil {
		doc.Content, _ = sanitizeGatewayCatalogDocValue(doc.Content).(map[string]interface{})
	}
}

func isSub2APICatalogMetadata(raw []byte) bool {
	if len(raw) == 0 {
		return false
	}
	var extra map[string]interface{}
	if err := json.Unmarshal(raw, &extra); err != nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(stringValue(extra["catalog_source"])), "sub2api")
}

// sanitizeGatewayCatalogPublicMetadata is applied at public DTO boundaries.
// It deliberately leaves the stored row (including catalog_source) untouched,
// while preventing stale or operator-entered infrastructure labels from
// reaching customer-facing model lists.
func sanitizeGatewayCatalogPublicMetadata(model *ModelDTO, raw []byte) {
	if model == nil || !isSub2APICatalogMetadata(raw) {
		return
	}
	if model.Description == nil || gatewayCatalogContainsInternalTerm(*model.Description) || strings.TrimSpace(*model.Description) == gatewayCatalogLegacyDescription {
		description := gatewayCatalogPublicDescription
		model.Description = &description
	}

	filteredTags := make([]string, 0, len(model.Tags)+1)
	for _, tag := range model.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || gatewayCatalogContainsInternalTerm(tag) {
			continue
		}
		duplicate := false
		for _, existing := range filteredTags {
			if strings.EqualFold(existing, tag) {
				duplicate = true
				break
			}
		}
		if !duplicate {
			filteredTags = append(filteredTags, tag)
		}
	}
	if len(filteredTags) == 0 {
		_, filteredTags = gatewayCatalogPublicMetadata(model.Category)
	}
	model.Tags = filteredTags
	model.RuntimeRule = sanitizeGatewayCatalogMap(model.RuntimeRule)
	model.InputSchema = sanitizeGatewayCatalogMap(model.InputSchema)
	model.DefaultParams = sanitizeGatewayCatalogMap(model.DefaultParams)
	model.PriceRule = sanitizeGatewayCatalogMap(model.PriceRule)

	if gatewayCatalogContainsInternalTerm(model.Provider) {
		provider := CatalogProvider(model.Code)
		if provider == "" || strings.EqualFold(provider, "other") || gatewayCatalogContainsInternalTerm(provider) {
			model.Provider = ""
		} else {
			model.Provider = provider
		}
	}
}

// SyncGatewayCatalog materializes the models currently available through the
// gateway so the existing PICO conversation and task services can resolve
// them by model code. Entries created here are marked in JSON so a later sync
// can update or disable only gateway-managed models, never manual routes.
func (s *ModelService) SyncGatewayCatalog(ctx context.Context, catalog []GatewayCatalogModel) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	codes := make([]string, 0, len(catalog))
	for _, item := range catalog {
		item.Code = strings.TrimSpace(item.Code)
		if item.Code == "" || len(item.Code) > 64 {
			continue
		}
		if item.DisplayName == "" {
			item.DisplayName = item.Code
		}
		if item.Category == "" {
			item.Category = "chat"
		}
		if item.Endpoint == "" {
			item.Endpoint = "/v1/chat/completions"
		}
		if item.RequestMode == "" {
			item.RequestMode = "chat_completions"
		}

		description, publicTags := gatewayCatalogPublicMetadata(item.Category)
		tags, _ := json.Marshal(publicTags)
		schema, _ := json.Marshal(gatewayCatalogSchema(item.Category))
		defaults, _ := json.Marshal(gatewayCatalogDefaults(item.Category))
		// /v1/models does not provide a reliable sell price. Keep new models
		// unavailable until an operator sets PICO's retail price and publishes it.
		price, _ := json.Marshal(map[string]interface{}{"billing_type": "per_request", "unit_price": 0, "currency": "算力", "pico_pricing_status": "pending"})
		// catalog_status describes whether this entry is still returned by the
		// current Sub2API gateway. It is distinct from is_enabled: an active
		// entry can be visible in PICO's model directory while it waits for its
		// retail price to be configured, but it must not be callable yet.
		// A provider inferred from the model id is useful for display and product
		// grouping, but it must not overwrite an administrator's custom provider.
		// Real `owned_by` values are marked as catalog-sourced by the caller and
		// may update the stored hint when the upstream owner changes.
		provider := catalogProviderForStorage(item.Provider)
		extraFields := map[string]interface{}{"catalog_source": "sub2api", "catalog_status": "active"}
		if provider != "" {
			extraFields["provider"] = provider
			source := strings.ToLower(strings.TrimSpace(item.ProviderSource))
			if source != "inferred" {
				source = "catalog"
			}
			extraFields["provider_source"] = source
		}
		extra, _ := json.Marshal(extraFields)
		runtimeFields := map[string]interface{}{}
		if item.AudioCapable {
			runtimeFields["capabilities"] = map[string]interface{}{"audio_output": true}
		}
		runtimeRule, _ := json.Marshal(runtimeFields)

		_, err = tx.Exec(ctx, `
			INSERT INTO models (
				code, display_name, new_api_model, new_api_endpoint, request_mode, category,
				description, tags, runtime_rule, input_schema, default_params,
				new_api_extra_params, price_rule, is_enabled, sort_order
			) VALUES (
				$1,$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13
			)
			ON CONFLICT (code) DO UPDATE SET
				-- A sync owns the source identity and transport fields, but it must
				-- never erase operator edits made in PICO (pricing, schemas,
				-- runtime mappings, or a private connection override).
				display_name=CASE WHEN NULLIF(BTRIM(models.display_name), '') IS NULL THEN EXCLUDED.display_name ELSE models.display_name END,
				-- category/endpoint/request_mode are inferred from the model id by
				-- keyword match, which is a reasonable default for a new model but a
				-- poor argument against an operator who corrected it. Once an operator
				-- has changed any of them the row carries category_source=manual and
				-- the inference stops applying, mirroring provider_source=manual.
				new_api_model=CASE WHEN LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'category_source',''))) = 'manual' THEN models.new_api_model ELSE EXCLUDED.new_api_model END,
				new_api_endpoint=CASE WHEN LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'category_source',''))) = 'manual' THEN models.new_api_endpoint ELSE EXCLUDED.new_api_endpoint END,
				request_mode=CASE WHEN LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'category_source',''))) = 'manual' THEN models.request_mode ELSE EXCLUDED.request_mode END,
				category=CASE WHEN LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'category_source',''))) = 'manual' THEN models.category ELSE EXCLUDED.category END,
				-- Replace metadata generated by the pre-Tuna sync while retaining
				-- an operator's own neutral description and tags.
				description=CASE
					WHEN models.description IS NULL OR models.description = '来自已授权的 Sub2API 账号池，模型目录会自动同步。' THEN EXCLUDED.description
					ELSE models.description
				END,
				tags=CASE
					WHEN models.tags IS NULL OR models.tags @> '["Sub2API"]'::jsonb THEN EXCLUDED.tags
					ELSE models.tags
				END,
			runtime_rule=`+gatewayCatalogRuntimeRuleUpsertSQL+`,
				input_schema=CASE WHEN models.input_schema IS NULL OR models.input_schema='{}'::jsonb THEN EXCLUDED.input_schema ELSE models.input_schema END,
				default_params=CASE WHEN models.default_params IS NULL OR models.default_params='{}'::jsonb THEN EXCLUDED.default_params ELSE models.default_params END,
				new_api_extra_params=COALESCE(models.new_api_extra_params,'{}'::jsonb) || jsonb_build_object(
					'catalog_source', 'sub2api',
					'catalog_status', 'active',
					'provider', CASE
						WHEN LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'provider_source',''))) = 'manual'
							AND LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'provider',''))) NOT IN ('', 'other', 'unknown', 'n/a', 'na', 'none', 'starai', 'sub2api', 'pico', 'gateway', 'model-gateway', 'newapi', 'new-api')
							THEN models.new_api_extra_params->>'provider'
						WHEN NULLIF(EXCLUDED.new_api_extra_params->>'provider','') IS NOT NULL
							AND EXCLUDED.new_api_extra_params->>'provider_source' = 'inferred'
							AND LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'provider',''))) NOT IN ('', 'other', 'unknown', 'n/a', 'na', 'none', 'starai', 'sub2api', 'pico', 'gateway', 'model-gateway', 'newapi', 'new-api')
							THEN models.new_api_extra_params->>'provider'
						WHEN NULLIF(EXCLUDED.new_api_extra_params->>'provider','') IS NOT NULL THEN EXCLUDED.new_api_extra_params->>'provider'
						WHEN LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'provider',''))) IN ('', 'other', 'unknown', 'n/a', 'na', 'none', 'starai', 'sub2api', 'pico', 'gateway', 'model-gateway', 'newapi', 'new-api') THEN ''
						ELSE models.new_api_extra_params->>'provider'
					END,
					'provider_source', CASE
						WHEN LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'provider_source',''))) = 'manual'
							AND LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'provider',''))) NOT IN ('', 'other', 'unknown', 'n/a', 'na', 'none', 'starai', 'sub2api', 'pico', 'gateway', 'model-gateway', 'newapi', 'new-api')
							THEN 'manual'
						WHEN NULLIF(EXCLUDED.new_api_extra_params->>'provider','') IS NOT NULL
							AND EXCLUDED.new_api_extra_params->>'provider_source' = 'inferred'
							AND LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'provider',''))) NOT IN ('', 'other', 'unknown', 'n/a', 'na', 'none', 'starai', 'sub2api', 'pico', 'gateway', 'model-gateway', 'newapi', 'new-api')
							THEN COALESCE(NULLIF(models.new_api_extra_params->>'provider_source',''), 'manual')
						WHEN NULLIF(EXCLUDED.new_api_extra_params->>'provider','') IS NOT NULL
							AND EXCLUDED.new_api_extra_params->>'provider_source' = 'inferred' THEN 'inferred'
						WHEN NULLIF(EXCLUDED.new_api_extra_params->>'provider','') IS NOT NULL THEN 'catalog'
						WHEN LOWER(BTRIM(COALESCE(models.new_api_extra_params->>'provider',''))) IN ('', 'other', 'unknown', 'n/a', 'na', 'none', 'starai', 'sub2api', 'pico', 'gateway', 'model-gateway', 'newapi', 'new-api') THEN ''
						ELSE COALESCE(NULLIF(models.new_api_extra_params->>'provider_source',''), 'manual')
					END
				),
				price_rule=CASE
					WHEN models.price_rule IS NULL OR models.price_rule='{}'::jsonb THEN EXCLUDED.price_rule
					ELSE models.price_rule
				END,
				is_enabled=CASE
					WHEN models.price_rule->>'pico_pricing_status'='published' THEN models.is_enabled
					ELSE false
				END,
				sort_order=EXCLUDED.sort_order,
				updated_at=now()
			WHERE models.new_api_extra_params->>'catalog_source' = 'sub2api'`,
			item.Code, item.DisplayName, item.Endpoint, item.RequestMode, item.Category,
			description, tags, runtimeRule,
			schema, defaults, extra, price, item.SortOrder)
		if err != nil {
			return err
		}
		codes = append(codes, item.Code)
	}

	if len(codes) == 0 {
		_, err = tx.Exec(ctx, `UPDATE models SET
			is_enabled=false,
			new_api_extra_params=jsonb_set(new_api_extra_params, '{catalog_status}', '"unavailable"'::jsonb, true),
			updated_at=now()
			WHERE new_api_extra_params->>'catalog_source' = 'sub2api'`)
	} else {
		_, err = tx.Exec(ctx, `UPDATE models SET
			is_enabled=false,
			new_api_extra_params=jsonb_set(new_api_extra_params, '{catalog_status}', '"unavailable"'::jsonb, true),
			updated_at=now()
			WHERE new_api_extra_params->>'catalog_source' = 'sub2api' AND NOT (code = ANY($1))`, codes)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ListGatewayCatalog returns the callable entries materialized by
// SyncGatewayCatalog. It is used by the public OpenAI-compatible API, so
// unpriced entries must not appear here.
func (s *ModelService) ListGatewayCatalog(ctx context.Context, category string) ([]ModelDTO, error) {
	return s.listGatewayCatalog(ctx, category, false)
}

// ListGatewayCatalogForDisplay returns the active Sub2API directory including
// entries waiting for their PICO retail price. The website can show those rows
// as unavailable without advertising them as callable API models.
func (s *ModelService) ListGatewayCatalogForDisplay(ctx context.Context, category string) ([]ModelDTO, error) {
	return s.listGatewayCatalog(ctx, category, true)
}

func (s *ModelService) listGatewayCatalog(ctx context.Context, category string, includePending bool) ([]ModelDTO, error) {
	q := `SELECT id, code, display_name, category, icon_url, description, tags, runtime_rule, input_schema, default_params, price_rule, is_enabled, sort_order, new_api_extra_params
		FROM models WHERE new_api_extra_params->>'catalog_source' = 'sub2api'
		  AND new_api_extra_params->>'catalog_status' = 'active'`
	if !includePending {
		q += ` AND is_enabled=true AND price_rule->>'pico_pricing_status'='published'`
	}
	args := []interface{}{}
	if category != "" && category != "all" {
		if category == "chat" {
			q += ` AND category IN ('chat','multi_collab')`
		} else if category == "audio" && includePending {
			q += ` AND ` + publicAudioCapabilitySQL
		} else {
			q += ` AND category=$1`
			args = append(args, category)
		}
	}
	q += ` ORDER BY sort_order ASC, id ASC`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanModels(rows)
}

// ListGatewayCatalogCategories follows the display catalog rather than the
// callable catalog, so the website keeps its chat/image/video/audio controls
// while an operator is still setting retail prices.
func (s *ModelService) ListGatewayCatalogCategories(ctx context.Context) ([]map[string]string, error) {
	rows, err := s.db.Query(ctx, `
	SELECT category FROM (
		SELECT DISTINCT category
		FROM models
		WHERE new_api_extra_params->>'catalog_source' = 'sub2api'
		  AND new_api_extra_params->>'catalog_status' = 'active'
		UNION
		SELECT 'audio'
		WHERE EXISTS (
			SELECT 1 FROM models
			WHERE new_api_extra_params->>'catalog_source' = 'sub2api'
			  AND new_api_extra_params->>'catalog_status' = 'active'
			  AND `+publicAudioCapabilitySQL+`
		)
	) AS model_categories
	ORDER BY category`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	labels := map[string]string{
		"chat": "聊天", "multi_collab": "多模型协作", "image": "图片", "video": "视频", "audio": "音频",
	}
	categories := make([]map[string]string, 0)
	for rows.Next() {
		var category string
		if err := rows.Scan(&category); err != nil {
			return nil, err
		}
		label := labels[category]
		if label == "" {
			label = category
		}
		categories = append(categories, map[string]string{"code": category, "label": label})
	}
	return categories, rows.Err()
}

func gatewayCatalogSchema(category string) map[string]interface{} {
	if category == "chat" {
		return map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"temperature": map[string]interface{}{"type": "number", "title": "温度", "default": 0.7, "minimum": 0, "maximum": 2},
			},
		}
	}
	return map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
}

func gatewayCatalogDefaults(category string) map[string]interface{} {
	if category == "chat" {
		return map[string]interface{}{"temperature": 0.7}
	}
	return map[string]interface{}{}
}
