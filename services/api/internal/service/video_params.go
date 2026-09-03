package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	imageDimensionMin       = 64
	imageDimensionMax       = 4096
	imageDimensionMaxPixels = int64(16_000_000)
)

// These are platform presets, not custom canvases.  Keeping them separate is
// important because the web client always sends its selected preset as
// `size`; treating every valid WxH string as custom would make the worker
// replace normal 2K/4K requests with a low-resolution upstream size.
var standardImageSizeValues = map[string]struct{}{
	"1024x1024": {}, "2048x2048": {}, "2880x2880": {},
	"1280x720": {}, "2560x1440": {}, "3840x2160": {},
	"720x1280": {}, "1440x2560": {}, "2160x3840": {},
	"1248x832": {}, "2496x1664": {}, "3504x2336": {},
	"832x1248": {}, "1664x2496": {}, "2336x3504": {},
	"1152x864": {}, "2304x1728": {}, "3264x2448": {},
	"864x1152": {}, "1728x2304": {}, "2448x3264": {},
	"1120x896": {}, "2240x1792": {}, "3200x2560": {},
	"896x1120": {}, "1792x2240": {}, "2560x3200": {},
	"1456x624": {}, "3024x1296": {}, "3696x1584": {},
	"624x1456": {}, "1296x3024": {}, "1584x3696": {},
	"1440x720": {}, "2880x1440": {}, "3840x1920": {},
	"720x1440": {}, "1440x2880": {}, "1920x3840": {},
	"1440x480": {}, "2880x960": {}, "3840x1280": {},
	"480x1440": {}, "960x2880": {}, "1280x3840": {},
	// Common OpenAI-compatible preset values used by older model records.
	"1792x1024": {}, "1024x1792": {}, "1536x1024": {}, "1024x1536": {},
}

// ValidateVideoParams checks upload slots + input_schema enums/required fields.
func ValidateVideoParams(model *ModelFull, params map[string]interface{}) error {
	normalizeVideoSchemaParamTypes(model.InputSchema, params)
	cfg := parseVideoRuntimeConfig(model.RuntimeRule)
	if err := validateVideoUpload(cfg, params); err != nil {
		return err
	}
	return validateSchemaParams(model.InputSchema, params)
}

// normalizeVideoSchemaParamTypes accepts semantically equivalent legacy
// duration values while preserving the exact enum type required by the
// selected provider. For example, Veo declares "4s" while Seedance declares 4.
func normalizeVideoSchemaParamTypes(inputSchema map[string]interface{}, params map[string]interface{}) {
	props, _ := inputSchema["properties"].(map[string]interface{})
	durationProp, _ := props["duration"].(map[string]interface{})
	enumValues, _ := durationProp["enum"].([]interface{})
	current, exists := params["duration"]
	if !exists || len(enumValues) == 0 || enumContains(enumValues, current) {
		return
	}
	currentSeconds, ok := schemaDurationSeconds(current)
	if !ok {
		return
	}
	for _, candidate := range enumValues {
		if seconds, valid := schemaDurationSeconds(candidate); valid && seconds == currentSeconds {
			params["duration"] = candidate
			return
		}
	}
}

func schemaDurationSeconds(value interface{}) (float64, bool) {
	raw := strings.TrimSpace(fmt.Sprint(value))
	raw = strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(raw, "秒"), "s"), "S"))
	seconds, err := strconv.ParseFloat(raw, 64)
	return seconds, err == nil
}

// BuildUpstreamVideoPayload maps platform params to NEW API request body.
func BuildUpstreamVideoPayload(model *ModelFull, params map[string]interface{}) map[string]interface{} {
	upCfg := parseUpstreamConfig(model.RuntimeRule)
	modelName := model.NewAPIModel
	if modelName == "" {
		modelName = model.Code
	}
	out := map[string]interface{}{}
	setPayloadValue(out, mappedUpstreamKey(upCfg, "model", "model"), modelName)
	if prompt, ok := params["prompt"].(string); ok {
		setPayloadValue(out, mappedUpstreamKey(upCfg, "prompt", "prompt"), prompt)
	}
	for k, v := range model.NewAPIExtraParams {
		out[k] = v
	}
	if upCfg.Static != nil {
		for k, v := range upCfg.Static {
			out[k] = v
		}
	}
	include := upCfg.Include
	if len(include) == 0 {
		include = defaultUpstreamInclude(params)
	}
	for _, key := range include {
		val, ok := params[key]
		if !ok || val == nil {
			continue
		}
		upKey := key
		if upCfg.Map != nil {
			if mapped, ok := upCfg.Map[key]; ok && mapped != "" {
				upKey = mapped
			}
		}
		if omitAutoValue(val) {
			continue
		}
		setPayloadValue(out, upKey, normalizeUpstreamValue(val))
	}
	return out
}

func parseDurationSeconds(params map[string]interface{}) float64 {
	for _, key := range []string{"duration", "duration_sec", "seconds"} {
		raw, ok := params[key]
		if !ok {
			continue
		}
		switch v := raw.(type) {
		case float64:
			if v > 0 {
				return v
			}
		case int:
			if v > 0 {
				return float64(v)
			}
		case string:
			s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(v, "s"), "S"))
			if n, err := strconv.ParseFloat(s, 64); err == nil && n > 0 {
				return n
			}
		}
	}
	return 5
}

type videoRuntimeConfig struct {
	UploadProfile      string
	MinReferenceImages int
	MaxReferenceImages int
	MaxTotalImages     int
	CountTowardTotal   bool
	FirstFrameKey      string
	LastFrameKey       string
	ReferenceImagesKey string
	RefSlotMax         int
	ReferenceVideosKey string
	MaxReferenceVideos int
	ReferenceAudiosKey string
	MaxReferenceAudios int
	ModeParam          string
	PromptRequired     bool
}

type upstreamConfig struct {
	Include []string
	Map     map[string]string
	Static  map[string]interface{}
}

func parseVideoRuntimeConfig(runtimeRule map[string]interface{}) videoRuntimeConfig {
	cfg := videoRuntimeConfig{
		UploadProfile:      "single_ref",
		MinReferenceImages: 0,
		MaxReferenceImages: 1,
		MaxTotalImages:     9,
		CountTowardTotal:   true,
		FirstFrameKey:      "first_frame",
		LastFrameKey:       "last_frame",
		ReferenceImagesKey: "reference_images",
		RefSlotMax:         4,
		ReferenceVideosKey: "reference_videos",
		MaxReferenceVideos: 3,
		ReferenceAudiosKey: "reference_audios",
		MaxReferenceAudios: 3,
		ModeParam:          "generation_mode",
		PromptRequired:     true,
	}
	if runtimeRule == nil {
		return cfg
	}
	video, _ := runtimeRule["video"].(map[string]interface{})
	if video == nil {
		return cfg
	}
	if s, ok := video["upload_profile"].(string); ok && s != "" {
		cfg.UploadProfile = s
	}
	cfg.MinReferenceImages = intFromAny(video["min_reference_images"], cfg.MinReferenceImages)
	cfg.MaxReferenceImages = intFromAny(video["max_reference_images"], cfg.MaxReferenceImages)
	cfg.MaxTotalImages = intFromAny(video["max_total_images"], cfg.MaxTotalImages)
	if v, ok := video["count_toward_total"].(bool); ok {
		cfg.CountTowardTotal = v
	}
	if v, ok := video["prompt_required"].(bool); ok {
		cfg.PromptRequired = v
	}
	if frames, ok := video["frames"].(map[string]interface{}); ok {
		if first, ok := frames["first"].(map[string]interface{}); ok {
			if k, ok := first["key"].(string); ok && k != "" {
				cfg.FirstFrameKey = k
			}
		}
		if last, ok := frames["last"].(map[string]interface{}); ok {
			if k, ok := last["key"].(string); ok && k != "" {
				cfg.LastFrameKey = k
			}
		}
	}
	if ref, ok := video["reference_images"].(map[string]interface{}); ok {
		if k, ok := ref["key"].(string); ok && k != "" {
			cfg.ReferenceImagesKey = k
		}
		cfg.RefSlotMax = intFromAny(ref["max"], cfg.RefSlotMax)
	}
	if ref, ok := video["reference_videos"].(map[string]interface{}); ok {
		if k, ok := ref["key"].(string); ok && k != "" {
			cfg.ReferenceVideosKey = k
		}
		cfg.MaxReferenceVideos = intFromAny(ref["max"], cfg.MaxReferenceVideos)
	}
	if ref, ok := video["reference_audios"].(map[string]interface{}); ok {
		if k, ok := ref["key"].(string); ok && k != "" {
			cfg.ReferenceAudiosKey = k
		}
		cfg.MaxReferenceAudios = intFromAny(ref["max"], cfg.MaxReferenceAudios)
	}
	if s, ok := video["mode_param"].(string); ok && strings.TrimSpace(s) != "" {
		cfg.ModeParam = strings.TrimSpace(s)
	}
	if cfg.MaxReferenceImages < 0 {
		cfg.MaxReferenceImages = 0
	}
	if cfg.MaxReferenceImages > 20 {
		cfg.MaxReferenceImages = 20
	}
	return cfg
}

func parseUpstreamConfig(runtimeRule map[string]interface{}) upstreamConfig {
	cfg := upstreamConfig{Map: map[string]string{}, Static: map[string]interface{}{}}
	if runtimeRule == nil {
		return cfg
	}
	up, _ := runtimeRule["upstream"].(map[string]interface{})
	if up == nil {
		return cfg
	}
	if arr, ok := up["include"].([]interface{}); ok {
		for _, item := range arr {
			if s, ok := item.(string); ok {
				cfg.Include = append(cfg.Include, s)
			}
		}
	}
	if m, ok := up["map"].(map[string]interface{}); ok {
		for k, v := range m {
			if s, ok := v.(string); ok {
				cfg.Map[k] = s
			}
		}
	}
	if st, ok := up["static"].(map[string]interface{}); ok {
		cfg.Static = st
	}
	return cfg
}

func mappedUpstreamKey(upCfg upstreamConfig, key string, fallback string) string {
	if upCfg.Map != nil {
		if mapped, ok := upCfg.Map[key]; ok && mapped != "" {
			return mapped
		}
	}
	return fallback
}

func setPayloadValue(out map[string]interface{}, key string, val interface{}) {
	key = strings.TrimSpace(key)
	if key == "" {
		return
	}
	parts := strings.Split(key, ".")
	if len(parts) == 1 {
		out[key] = val
		return
	}
	cur := out
	for _, part := range parts[:len(parts)-1] {
		part = strings.TrimSpace(part)
		if part == "" {
			return
		}
		next, _ := cur[part].(map[string]interface{})
		if next == nil {
			next = map[string]interface{}{}
			cur[part] = next
		}
		cur = next
	}
	last := strings.TrimSpace(parts[len(parts)-1])
	if last != "" {
		cur[last] = val
	}
}

func validateVideoUpload(cfg videoRuntimeConfig, params map[string]interface{}) error {
	refKey := cfg.ReferenceImagesKey
	firstKey := cfg.FirstFrameKey
	lastKey := cfg.LastFrameKey

	refCount := urlFieldCount(params[refKey])
	firstCount := singleURLCount(params[firstKey])
	lastCount := singleURLCount(params[lastKey])
	total := refCount
	if cfg.CountTowardTotal {
		total += firstCount + lastCount
	}

	switch cfg.UploadProfile {
	case "none":
		return nil
	case "veo_reference":
		mode := strings.ToLower(strings.TrimSpace(fmt.Sprint(params[cfg.ModeParam])))
		switch mode {
		case "", "text":
			if strings.TrimSpace(fmt.Sprint(params["prompt"])) == "" {
				return errors.New("文生视频需要填写提示词")
			}
		case "reference":
			if refCount < 1 {
				return errors.New("参考图模式至少需要 1 张参考图")
			}
			if refCount > 3 || refCount > cfg.MaxReferenceImages {
				return errors.New("VEO 参考图模式最多支持 3 张参考图")
			}
		default:
			return errors.New("VEO 参考图模板仅支持文生或参考图模式")
		}
	case "omni_reference":
		mode := strings.ToLower(strings.TrimSpace(fmt.Sprint(params[cfg.ModeParam])))
		switch mode {
		case "", "text":
			if strings.TrimSpace(fmt.Sprint(params["prompt"])) == "" {
				return errors.New("文生视频需要填写提示词")
			}
		case "reference":
			if refCount < 1 {
				return errors.New("Omni 参考图模式至少需要 1 张参考图")
			}
			if refCount > 7 || refCount > cfg.MaxReferenceImages {
				return errors.New("Omni 参考图模式最多支持 7 张参考图")
			}
		default:
			return errors.New("Omni 模板仅支持文生或参考图模式，暂不支持首尾帧")
		}
	case "veo_frame_pair":
		if firstCount != 1 {
			return errors.New("VEO 首尾帧模式至少需要上传 1 张首帧图片")
		}
		if lastCount > 1 {
			return errors.New("VEO 尾帧最多只能上传 1 张")
		}
		if refCount > 0 {
			return errors.New("VEO 首尾帧模板不支持参考图")
		}
	case "multi_ref":
		if refCount < cfg.MinReferenceImages {
			return fmt.Errorf("至少需要 %d 张参考图", cfg.MinReferenceImages)
		}
		if refCount > cfg.MaxReferenceImages {
			return errors.New("参考图数量超过模型限制")
		}
	case "frame_pair":
		if refCount > cfg.RefSlotMax {
			return errors.New("参考图数量超过模型限制")
		}
		if firstCount > 1 || lastCount > 1 {
			return errors.New("首尾帧各只能上传 1 张")
		}
		if cfg.MaxTotalImages > 0 && total > cfg.MaxTotalImages {
			return errors.New("上传图片总数超过模型限制")
		}
	case "seedance_2":
		videoCount := urlFieldCount(params[cfg.ReferenceVideosKey])
		audioCount := urlFieldCount(params[cfg.ReferenceAudiosKey])
		portraitAssetID := strings.TrimSpace(fmt.Sprint(params["portrait_asset_id"]))
		if portraitAssetID == "<nil>" {
			portraitAssetID = ""
		}
		portraitType := strings.ToLower(strings.TrimSpace(fmt.Sprint(params["portrait_asset_type"])))
		if portraitType == "<nil>" || portraitType == "" {
			portraitType = "image"
		}
		if portraitAssetID != "" {
			if !strings.HasPrefix(portraitAssetID, "asset://") {
				return errors.New("人像形象必须填写火山方舟 asset:// 素材 ID")
			}
			switch portraitType {
			case "image":
				refCount++
			case "video":
				videoCount++
			default:
				return errors.New("人像形象类型仅支持图片或视频")
			}
		}
		if refCount > cfg.MaxReferenceImages || videoCount > cfg.MaxReferenceVideos || audioCount > cfg.MaxReferenceAudios {
			return errors.New("参考素材数量超过 Seedance 2.0 模型限制")
		}
		mode := strings.TrimSpace(fmt.Sprint(params[cfg.ModeParam]))
		prompt := strings.TrimSpace(fmt.Sprint(params["prompt"]))
		switch mode {
		case "", "text":
			if prompt == "" {
				return errors.New("文生视频需要填写提示词")
			}
		case "first_frame":
			if firstCount != 1 {
				return errors.New("首帧生视频需要上传 1 张首帧图片")
			}
		case "first_last":
			if firstCount != 1 || lastCount != 1 {
				return errors.New("首尾帧生视频需要同时上传首帧和尾帧")
			}
		case "image":
			if refCount < 1 {
				return errors.New("当前组合至少需要 1 张参考图片")
			}
		case "video":
			if videoCount < 1 {
				return errors.New("当前组合至少需要 1 个参考视频")
			}
		case "image_audio":
			if refCount < 1 || audioCount < 1 {
				return errors.New("图片+音频组合需要同时上传图片和音频")
			}
		case "image_video":
			if refCount < 1 || videoCount < 1 {
				return errors.New("图片+视频组合需要同时上传图片和视频")
			}
		case "video_audio":
			if videoCount < 1 || audioCount < 1 {
				return errors.New("视频+音频组合需要同时上传视频和音频")
			}
		case "image_video_audio":
			if refCount < 1 || videoCount < 1 || audioCount < 1 {
				return errors.New("图片+视频+音频组合需要上传三类素材")
			}
		case "draft_task":
			if strings.TrimSpace(fmt.Sprint(params["draft_task_id"])) == "" {
				return errors.New("样片转正式视频需要填写样片任务 ID")
			}
		default:
			return errors.New("不支持的 Seedance 2.0 素材组合")
		}
	default: // single_ref
		if refCount > cfg.MaxReferenceImages {
			return errors.New("参考图数量超过模型限制")
		}
	}
	return nil
}

func validateSchemaParams(inputSchema map[string]interface{}, params map[string]interface{}) error {
	return validateSchemaParamsWithOptions(inputSchema, params, false)
}

func validateSchemaParamsWithOptions(inputSchema map[string]interface{}, params map[string]interface{}, allowCustomImageSize bool) error {
	props, _ := inputSchema["properties"].(map[string]interface{})
	if props == nil {
		return nil
	}
	required, _ := inputSchema["required"].([]interface{})
	for _, r := range required {
		key, _ := r.(string)
		if key == "" {
			continue
		}
		if _, ok := params[key]; !ok {
			return fmt.Errorf("缺少必填参数: %s", key)
		}
	}
	for key, raw := range props {
		prop, _ := raw.(map[string]interface{})
		if prop == nil {
			continue
		}
		val, exists := params[key]
		if !exists {
			continue
		}
		if enum, ok := prop["enum"].([]interface{}); ok && len(enum) > 0 {
			// Image providers often advertise a small enum (for example
			// 1024x1024/1792x1024), while the platform can normalize an
			// arbitrary validated canvas after generation. Keep that escape hatch
			// scoped to image tasks; video schemas must remain enum-only.
			if allowCustomImageSize {
				switch key {
				case "size":
					if _, _, valid := parseImageSizeString(val); valid {
						continue
					}
				case "width", "height":
					if customDimensionMatches(key, val, params) {
						continue
					}
				}
			}
			if enumContains(enum, val) {
				continue
			}
			if allowCustom, _ := prop["x-allow-custom"].(bool); allowCustom && validateIntRange(prop, val) {
				continue
			}
			return fmt.Errorf("参数 %s 的值无效", key)
		}
	}
	return nil
}

func customDimensionMatches(key string, value interface{}, params map[string]interface{}) bool {
	width, widthOK := imageDimensionFromValue(params["width"])
	height, heightOK := imageDimensionFromValue(params["height"])
	if !widthOK || !heightOK || int64(width)*int64(height) > imageDimensionMaxPixels {
		return false
	}
	actual, actualOK := imageDimensionFromValue(value)
	if !actualOK {
		return false
	}
	if key == "width" {
		return actual == width
	}
	return actual == height
}

func imageValuePresent(value interface{}) bool {
	if value == nil {
		return false
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text) != ""
	}
	return true
}

func imageDimensionFromValue(value interface{}) (int, bool) {
	var parsed int
	switch v := value.(type) {
	case int:
		parsed = v
	case int8:
		parsed = int(v)
	case int16:
		parsed = int(v)
	case int32:
		parsed = int(v)
	case int64:
		if v < 0 || v > imageDimensionMax {
			return 0, false
		}
		parsed = int(v)
	case uint:
		if uint64(v) > uint64(imageDimensionMax) {
			return 0, false
		}
		parsed = int(v)
	case uint8:
		parsed = int(v)
	case uint16:
		parsed = int(v)
	case uint32:
		if uint64(v) > uint64(imageDimensionMax) {
			return 0, false
		}
		parsed = int(v)
	case uint64:
		if v > uint64(imageDimensionMax) {
			return 0, false
		}
		parsed = int(v)
	case float32:
		if math.Trunc(float64(v)) != float64(v) || v < 0 || v > float32(imageDimensionMax) {
			return 0, false
		}
		parsed = int(v)
	case float64:
		if math.Trunc(v) != v || v < 0 || v > float64(imageDimensionMax) {
			return 0, false
		}
		parsed = int(v)
	case json.Number:
		n, err := strconv.ParseInt(strings.TrimSpace(string(v)), 10, 64)
		if err != nil || n < 0 || n > int64(imageDimensionMax) {
			return 0, false
		}
		parsed = int(n)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return 0, false
		}
		parsed = n
	default:
		return 0, false
	}
	if parsed < imageDimensionMin || parsed > imageDimensionMax {
		return 0, false
	}
	return parsed, true
}

func parseImageSizeString(value interface{}) (int, int, bool) {
	raw := strings.TrimSpace(fmt.Sprint(value))
	parts := strings.Split(strings.ToLower(raw), "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, widthOK := imageDimensionFromValue(strings.TrimSpace(parts[0]))
	height, heightOK := imageDimensionFromValue(strings.TrimSpace(parts[1]))
	if !widthOK || !heightOK || int64(width)*int64(height) > imageDimensionMaxPixels {
		return 0, 0, false
	}
	return width, height, true
}

// normalizeCustomImageDimensions accepts both the explicit width/height
// fields used by the web toolbar and a size string supplied by API clients.
// It stores canonical integer fields so the worker sees the same contract no
// matter which JSON number representation the caller used.
func normalizeCustomImageDimensions(params map[string]interface{}, schemaStandardSizes ...map[string]struct{}) (bool, error) {
	widthRaw, widthProvided := params["width"]
	if !widthProvided || !imageValuePresent(widthRaw) {
		widthRaw, widthProvided = params["custom_width"]
	}
	heightRaw, heightProvided := params["height"]
	if !heightProvided || !imageValuePresent(heightRaw) {
		heightRaw, heightProvided = params["custom_height"]
	}
	widthSet := widthProvided && imageValuePresent(widthRaw)
	heightSet := heightProvided && imageValuePresent(heightRaw)
	if !widthSet && !heightSet {
		rawSize := strings.ToLower(strings.TrimSpace(fmt.Sprint(params["size"])))
		isStandard := false
		if _, ok := standardImageSizeValues[rawSize]; ok {
			isStandard = true
		}
		for _, values := range schemaStandardSizes {
			if _, ok := values[rawSize]; ok {
				isStandard = true
				break
			}
		}
		if width, height, valid := parseImageSizeString(params["size"]); valid && !isStandard {
			params["width"], params["height"] = width, height
			return true, nil
		}
		return false, nil
	}
	if widthSet != heightSet {
		return false, errors.New("自定义图片尺寸需要同时提供宽度和高度")
	}
	width, widthOK := imageDimensionFromValue(widthRaw)
	height, heightOK := imageDimensionFromValue(heightRaw)
	if !widthOK || !heightOK {
		return false, errors.New("图片宽度和高度必须是 64-4096 的整数")
	}
	if int64(width)*int64(height) > imageDimensionMaxPixels {
		return false, errors.New("图片总像素不能超过 1600 万")
	}
	params["width"], params["height"] = width, height
	params["custom_width"], params["custom_height"] = width, height
	params["size"] = fmt.Sprintf("%dx%d", width, height)
	return true, nil
}

func validateImageTaskParams(model *ModelFull, params map[string]interface{}) error {
	allowCustomSize, err := normalizeCustomImageDimensions(params, imageSchemaStandardSizes(model.InputSchema))
	if err != nil {
		return err
	}
	maxRefs := maxReferenceImages(model)
	if refs, ok := params["reference_images"]; ok {
		if referenceImageCount(refs) > maxRefs {
			return errors.New("参考图数量超过模型限制")
		}
	}
	return validateSchemaParamsWithOptions(model.InputSchema, params, allowCustomSize)
}

func imageSchemaStandardSizes(inputSchema map[string]interface{}) map[string]struct{} {
	values := make(map[string]struct{})
	props, _ := inputSchema["properties"].(map[string]interface{})
	prop, _ := props["size"].(map[string]interface{})
	enum, _ := prop["enum"].([]interface{})
	for _, item := range enum {
		raw := strings.ToLower(strings.TrimSpace(fmt.Sprint(item)))
		if raw != "" {
			values[raw] = struct{}{}
		}
	}
	return values
}

func defaultUpstreamInclude(params map[string]interface{}) []string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "prompt" {
			continue
		}
		keys = append(keys, k)
	}
	return keys
}

func urlFieldCount(v interface{}) int {
	switch arr := v.(type) {
	case []interface{}:
		n := 0
		for _, item := range arr {
			if str, ok := item.(string); ok && strings.TrimSpace(str) != "" {
				n++
			}
		}
		return n
	case []string:
		n := 0
		for _, s := range arr {
			if strings.TrimSpace(s) != "" {
				n++
			}
		}
		return n
	case string:
		if strings.TrimSpace(arr) != "" {
			return 1
		}
	}
	return 0
}

func singleURLCount(v interface{}) int {
	return urlFieldCount(v)
}

func enumContains(enum []interface{}, val interface{}) bool {
	for _, item := range enum {
		if fmt.Sprint(item) == fmt.Sprint(val) {
			return true
		}
	}
	return false
}

func validateIntRange(prop map[string]interface{}, val interface{}) bool {
	n := intFromAny(val, -1)
	if n < 1 {
		return false
	}
	min := intFromAny(prop["minimum"], 1)
	max := intFromAny(prop["maximum"], 50)
	return n >= min && n <= max
}

func omitAutoValue(val interface{}) bool {
	switch v := val.(type) {
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "auto") || strings.TrimSpace(v) == ""
	}
	return false
}

func normalizeUpstreamValue(val interface{}) interface{} {
	switch v := val.(type) {
	case string:
		if strings.HasSuffix(strings.TrimSpace(v), "s") || strings.HasSuffix(strings.TrimSpace(v), "S") {
			s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(v, "s"), "S"))
			if n, err := strconv.ParseFloat(s, 64); err == nil {
				return int(math.Round(n))
			}
		}
		return v
	default:
		b, _ := json.Marshal(val)
		var out interface{}
		_ = json.Unmarshal(b, &out)
		return out
	}
}

func intFromAny(v interface{}, fallback int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		if i, err := strconv.Atoi(n); err == nil {
			return i
		}
	}
	return fallback
}
