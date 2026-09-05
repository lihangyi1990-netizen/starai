package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ApiKeyProduct is a customer-facing entitlement. It is deliberately derived
// from PICO's published catalog, not from an upstream credential or channel
// name. One PICO key may use a product, while the server keeps the sole
// Sub2API gateway credential private.
type ApiKeyProduct struct {
	Code        string               `json:"code"`
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Provider    string               `json:"provider"`
	ModelScopes []string             `json:"model_scopes"`
	Models      []ApiKeyProductModel `json:"models"`
	ModelCount  int                  `json:"model_count"`
}

// ApiKeyProductModel is the public, non-secret model metadata needed when a
// customer narrows a key to specific models. It intentionally excludes route,
// endpoint, pricing-cost and credential fields.
type ApiKeyProductModel struct {
	Code        string `json:"code"`
	DisplayName string `json:"display_name"`
	Category    string `json:"category"`
}

type catalogProductModel struct {
	Code        string
	DisplayName string
	Category    string
	Price       map[string]interface{}
	Extra       map[string]interface{}
}

// ListApiKeyProducts exposes models that are enabled for customer use. The
// optional catalogSync argument is kept variadic for compatibility with older
// callers; when true, Sub2API is the source of truth and manual/seed rows are
// excluded before products are assembled.
func (s *ModelService) ListApiKeyProducts(ctx context.Context, catalogSync ...bool) ([]ApiKeyProduct, error) {
	return s.listApiKeyProducts(ctx, catalogSyncRequested(catalogSync))
}

// ListApiKeyProductsForCatalog is the explicit form used by request handlers
// whose configuration selects the Sub2API source of truth.
func (s *ModelService) ListApiKeyProductsForCatalog(ctx context.Context, catalogSync bool) ([]ApiKeyProduct, error) {
	return s.listApiKeyProducts(ctx, catalogSync)
}

func (s *ModelService) listApiKeyProducts(ctx context.Context, catalogSync bool) ([]ApiKeyProduct, error) {
	where := "is_enabled=true"
	if catalogSync {
		// Keep this predicate aligned with ListGatewayCatalog. In sync mode an
		// old manually seeded row must never create a customer-facing product,
		// even if an administrator left its legacy is_enabled flag on. A manual
		// row is admitted only once it's enabled and published, matching
		// gatewayCatalogManualRowSQL.
		where += `
			AND (
				(new_api_extra_params->>'catalog_source'='sub2api'
					AND new_api_extra_params->>'catalog_status'='active'
					AND price_rule->>'pico_pricing_status'='published')
				OR ` + gatewayCatalogManualRowSQL + `
			)`
	}
	rows, err := s.db.Query(ctx, `
		SELECT code, display_name, category, price_rule, new_api_extra_params
		FROM models
		WHERE `+where+`
		ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	models := make([]catalogProductModel, 0)
	for rows.Next() {
		var item catalogProductModel
		var price, extra []byte
		if err := rows.Scan(&item.Code, &item.DisplayName, &item.Category, &price, &extra); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(price, &item.Price)
		_ = json.Unmarshal(extra, &item.Extra)
		if apiKeyCatalogModelSellableForMode(item.Extra, item.Price, catalogSync) {
			models = append(models, item)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(models) == 0 {
		return []ApiKeyProduct{}, nil
	}

	products := map[string]*ApiKeyProduct{
		"pico-all": {
			Code: "pico-all", Name: "PICO ALL Key", Provider: "PICO",
			Description: "可调用所有已定价并发布的 PICO 模型。", ModelScopes: []string{"*"}, Models: make([]ApiKeyProductModel, 0, len(models)),
		},
	}
	for _, model := range models {
		products["pico-all"].ModelCount++
		publicModel := apiKeyProductModelFromCatalog(model)
		products["pico-all"].Models = append(products["pico-all"].Models, publicModel)
		provider := CatalogProviderWithExtra(model.Code, model.Extra)
		if gatewayCatalogContainsInternalTerm(provider) {
			provider = CatalogProvider(model.Code)
		}
		product := apiKeyProductForProvider(provider)
		if _, exists := products[product.Code]; !exists {
			products[product.Code] = product
		}
		products[product.Code].ModelCount++
		products[product.Code].Models = append(products[product.Code].Models, publicModel)
		// Keep an exact entitlement for every published catalog entry. This also
		// makes provider-qualified aliases such as `openai/gpt-4o` and arbitrary
		// upstream names work without granting access to similarly prefixed but
		// unpublished models.
		products[product.Code].ModelScopes = appendUniqueScope(products[product.Code].ModelScopes, model.Code)
	}

	items := make([]ApiKeyProduct, 0, len(products))
	for _, product := range products {
		if product.ModelCount > 0 {
			items = append(items, *product)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Code == "pico-all" {
			return true
		}
		if items[j].Code == "pico-all" {
			return false
		}
		return items[i].Name < items[j].Name
	})
	return items, nil
}

func apiKeyProductModelFromCatalog(model catalogProductModel) ApiKeyProductModel {
	displayName := strings.TrimSpace(model.DisplayName)
	if displayName == "" {
		displayName = model.Code
	}
	if gatewayCatalogContainsInternalTerm(displayName) {
		displayName = model.Code
	}
	category := strings.TrimSpace(model.Category)
	if category == "" {
		category = "chat"
	}
	return ApiKeyProductModel{Code: model.Code, DisplayName: displayName, Category: category}
}

// ApiKeyProductByCode resolves a product using the same catalog mode as the
// list endpoint. Without this, a strict product list could still be bypassed
// by creating a key from a legacy/manual product code.
func (s *ModelService) ApiKeyProductByCode(ctx context.Context, code string, catalogSync ...bool) (*ApiKeyProduct, error) {
	return s.apiKeyProductByCode(ctx, code, catalogSyncRequested(catalogSync))
}

// ApiKeyProductByCodeForCatalog resolves a product with an explicit catalog
// source mode, matching ListApiKeyProductsForCatalog.
func (s *ModelService) ApiKeyProductByCodeForCatalog(ctx context.Context, code string, catalogSync bool) (*ApiKeyProduct, error) {
	return s.apiKeyProductByCode(ctx, code, catalogSync)
}

func (s *ModelService) apiKeyProductByCode(ctx context.Context, code string, catalogSync bool) (*ApiKeyProduct, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		code = "pico-all"
	}
	products, err := s.listApiKeyProducts(ctx, catalogSync)
	if err != nil {
		return nil, err
	}
	for i := range products {
		if products[i].Code == code {
			return &products[i], nil
		}
	}
	return nil, errors.New("所选 PICO Key 产品暂无已定价并发布的模型")
}

func apiKeyProductForProvider(provider string) *ApiKeyProduct {
	provider = normalizeCatalogProvider(provider)
	switch provider {
	case "openai":
		return &ApiKeyProduct{Code: "pico-openai", Name: "PICO GPT Key", Provider: "OpenAI", Description: "仅调用已发布的 GPT、Codex、图像等 OpenAI 模型。", ModelScopes: []string{}}
	case "anthropic":
		return &ApiKeyProduct{Code: "pico-claude", Name: "PICO Claude Key", Provider: "Anthropic", Description: "仅调用已发布的 Claude 模型。", ModelScopes: []string{}}
	case "grok":
		return &ApiKeyProduct{Code: "pico-grok", Name: "PICO Grok Key", Provider: "Grok", Description: "仅调用已发布的 Grok 模型。", ModelScopes: []string{}}
	case "gemini":
		return &ApiKeyProduct{Code: "pico-gemini", Name: "PICO Gemini Key", Provider: "Gemini", Description: "仅调用已发布的 Gemini 模型。", ModelScopes: []string{}}
	case "seedance":
		return &ApiKeyProduct{Code: "pico-seedance", Name: "PICO Seedance Key", Provider: "Seedance", Description: "仅调用已发布的 Seedance 视频模型。", ModelScopes: []string{}}
	}
	// Sub2API can expose arbitrary providers and administrator-defined aliases.
	// Do not collapse them into one "other" product: use a stable, bounded
	// provider slug so each generated key has an understandable entitlement.
	slug := catalogProviderSlug(provider)
	if slug == "" {
		slug = "custom"
	}
	label := catalogProviderLabel(provider)
	return &ApiKeyProduct{
		Code:        "pico-" + slug,
		Name:        "PICO " + label + " Key",
		Provider:    label,
		Description: "仅调用已发布的 " + label + " 模型。",
		ModelScopes: []string{},
	}
}

func CatalogProviderWithExtra(code string, extra map[string]interface{}) string {
	if extra != nil {
		if provider, ok := extra["provider"].(string); ok && strings.TrimSpace(provider) != "" && !isGenericCatalogProviderHint(provider) {
			return normalizeCatalogProvider(provider)
		}
	}
	model := strings.ToLower(strings.TrimSpace(code))
	switch {
	case strings.HasPrefix(model, "claude-") || strings.HasPrefix(model, "anthropic/"):
		return "anthropic"
	case strings.HasPrefix(model, "grok-") || strings.HasPrefix(model, "xai/"):
		return "grok"
	case strings.HasPrefix(model, "gemini-") || strings.HasPrefix(model, "google/"):
		return "gemini"
	case strings.HasPrefix(model, "seedance-") || strings.HasPrefix(model, "seedance/") || strings.HasPrefix(model, "bytedance/") || strings.HasPrefix(model, "volcengine/"):
		return "seedance"
	case strings.HasPrefix(model, "kimi-") || strings.HasPrefix(model, "kimi/") || strings.HasPrefix(model, "moonshot-") || strings.HasPrefix(model, "moonshot/"):
		return "kimi"
	case strings.HasPrefix(model, "glm-") || strings.HasPrefix(model, "glm/") || strings.HasPrefix(model, "chatglm") || strings.HasPrefix(model, "zhipu/"):
		return "zhipu"
	case strings.HasPrefix(model, "deepseek-") || strings.HasPrefix(model, "deepseek/"):
		return "deepseek"
	case strings.HasPrefix(model, "qwen-") || strings.HasPrefix(model, "qwen/") || strings.HasPrefix(model, "dashscope/"):
		return "qwen"
	case strings.HasPrefix(model, "minimax-") || strings.HasPrefix(model, "minimax/"):
		return "minimax"
	case strings.HasPrefix(model, "mistral-") || strings.HasPrefix(model, "mistral/"):
		return "mistral"
	case strings.HasPrefix(model, "command-") || strings.HasPrefix(model, "cohere/"):
		return "cohere"
	case strings.HasPrefix(model, "llama-") || strings.HasPrefix(model, "llama/") || strings.HasPrefix(model, "meta/"):
		return "meta"
	case strings.HasPrefix(model, "baichuan-") || strings.HasPrefix(model, "baichuan/"):
		return "baichuan"
	case strings.HasPrefix(model, "yi-") || strings.HasPrefix(model, "yi/"):
		return "yi"
	case strings.HasPrefix(model, "gpt-") || strings.HasPrefix(model, "openai/") || strings.HasPrefix(model, "codex-") || strings.HasPrefix(model, "dall-e-") || strings.HasPrefix(model, "text-embedding-") || strings.HasPrefix(model, "o1") || strings.HasPrefix(model, "o3") || strings.HasPrefix(model, "o4"):
		return "openai"
	default:
		return "other"
	}
}

// CatalogProviderWithHint prefers the provider/owned_by value supplied by a
// gateway model list, while still falling back to model-name conventions.
// Sub2API's composite groups often return qualified IDs whose vendor cannot
// be inferred from the ID alone, so dropping this hint makes provider keys
// unusable for perfectly valid models.
func CatalogProviderWithHint(code, hint string) string {
	if hint = strings.TrimSpace(hint); hint != "" && !isGenericCatalogProviderHint(hint) {
		provider := normalizeCatalogProvider(hint)
		if provider != "" && provider != "other" {
			return provider
		}
		// Preserve an administrator-defined provider name instead of collapsing
		// every unknown value into one bucket.
		if slug := catalogProviderSlug(hint); slug != "" {
			return slug
		}
	}
	return CatalogProvider(code)
}

// CatalogProviderHintIsGeneric reports whether an owned_by/provider value is
// merely the gateway's owner label rather than a real upstream vendor. Such a
// value must not replace a useful model-id inference or an administrator's
// custom provider metadata.
func CatalogProviderHintIsGeneric(value string) bool {
	return isGenericCatalogProviderHint(value)
}

func isGenericCatalogProviderHint(value string) bool {
	raw := strings.ToLower(strings.TrimSpace(value))
	raw = strings.Trim(raw, " /._-")
	switch raw {
	case "", "other", "unknown", "n/a", "na", "none",
		"starai", "sub2api", "pico", "gateway", "model-gateway",
		"newapi", "new-api":
		return true
	default:
		return false
	}
}

// CatalogProvider provides a safe default provider classification for standard
// model identifiers. Composite-route aliases that do not follow a standard
// naming convention should be given a provider in the PICO catalog metadata.
func CatalogProvider(code string) string {
	return CatalogProviderWithExtra(code, nil)
}

func normalizeCatalogProvider(value string) string {
	raw := strings.ToLower(strings.TrimSpace(value))
	raw = strings.Trim(raw, " /._-")
	switch raw {
	case "xai", "x.ai", "grok":
		return "grok"
	case "openai", "open-ai", "chatgpt":
		return "openai"
	case "anthropic", "claude":
		return "anthropic"
	case "google", "googleai", "google-ai", "gemini":
		return "gemini"
	case "bytedance", "volcengine", "doubao", "seedance", "volc":
		return "seedance"
	case "kimi", "moonshot", "moonshotai":
		return "kimi"
	case "zhipu", "glm", "bigmodel", "chatglm":
		return "zhipu"
	case "deepseek":
		return "deepseek"
	case "qwen", "aliyun", "dashscope":
		return "qwen"
	case "minimax", "mini-max":
		return "minimax"
	case "mistral", "mistralai":
		return "mistral"
	case "cohere":
		return "cohere"
	case "meta", "llama", "llama2", "llama3":
		return "meta"
	case "baichuan":
		return "baichuan"
	case "yi", "01ai":
		return "yi"
	case "":
		return "other"
	default:
		return raw
	}
}

func catalogProviderSlug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || value == "other" {
		return ""
	}
	var b strings.Builder
	for _, r := range value {
		// Product codes are used in URLs and headers. Keep the slug ASCII even
		// when Sub2API reports a localized provider name; encode non-ASCII
		// runes as a short, deterministic `uXXXX` token instead of emitting an
		// unsafe or truncated UTF-8 byte sequence.
		if r < utf8.RuneSelf && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			b.WriteRune(r)
			continue
		}
		if r >= utf8.RuneSelf {
			fmt.Fprintf(&b, "u%x", r)
			continue
		}
		if b.Len() > 0 {
			b.WriteByte('-')
		}
	}
	slug := strings.Trim(b.String(), "-")
	if len(slug) > 40 {
		slug = slug[:40]
	}
	return slug
}

// catalogProviderForStorage canonicalizes a provider supplied by a gateway
// before it is written to model metadata. Generic gateway owner labels are
// represented by an empty value so the upsert can retain an existing custom
// provider (or let the model id be classified later).
func catalogProviderForStorage(value string) string {
	if isGenericCatalogProviderHint(value) {
		return ""
	}
	return normalizeCatalogProvider(value)
}

func catalogProviderLabel(provider string) string {
	switch normalizeCatalogProvider(provider) {
	case "openai":
		return "OpenAI"
	case "anthropic":
		return "Claude"
	case "grok":
		return "Grok"
	case "gemini":
		return "Gemini"
	case "seedance":
		return "Seedance"
	case "kimi":
		return "Kimi"
	case "zhipu":
		return "GLM / 智谱"
	case "deepseek":
		return "DeepSeek"
	case "qwen":
		return "Qwen"
	case "minimax":
		return "MiniMax"
	case "mistral":
		return "Mistral"
	case "cohere":
		return "Cohere"
	case "meta":
		return "Meta"
	case "baichuan":
		return "Baichuan"
	case "yi":
		return "Yi"
	}
	provider = strings.TrimSpace(provider)
	if provider == "" {
		return "Custom"
	}
	runes := []rune(provider)
	return strings.ToUpper(string(runes[0])) + string(runes[1:])
}

func appendUniqueScope(scopes []string, scope string) []string {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		return scopes
	}
	for _, existing := range scopes {
		if existing == scope {
			return scopes
		}
	}
	return append(scopes, scope)
}

func catalogSyncRequested(options []bool) bool {
	return len(options) > 0 && options[0]
}

// apiKeyCatalogModelSellable is intentionally separate from the SQL
// is_enabled predicate. Manual model rows do not carry the Sub2API pricing
// marker, while synchronized rows must not become sellable merely because a
// stale/invalid row was left enabled in the database.
func apiKeyCatalogModelSellable(extra, price map[string]interface{}) bool {
	source := strings.ToLower(strings.TrimSpace(stringValue(extra["catalog_source"])))
	if source != "sub2api" {
		return true
	}
	status := strings.ToLower(strings.TrimSpace(stringValue(extra["catalog_status"])))
	// Synchronized rows are callable only while the latest gateway sync still
	// reports them. Treat a missing/unknown status as unavailable as well; an
	// operator can still set pricing while the row is hidden, but it must not
	// leak into a customer product until the model reappears upstream.
	if status != "active" {
		return false
	}
	return picoCatalogPricePublished(price)
}

// apiKeyCatalogModelSellableForMode mirrors the SQL source filter in the scan
// loop. The duplicate check is intentional: it protects against a future
// query change (or a database view) reintroducing a manual row into strict
// Sub2API mode. A manual row is still admitted here once it's enabled and
// published, mirroring gatewayCatalogManualRowSQL.
func apiKeyCatalogModelSellableForMode(extra, price map[string]interface{}, catalogSync bool) bool {
	if catalogSync {
		source := strings.ToLower(strings.TrimSpace(stringValue(extra["catalog_source"])))
		if source != "sub2api" {
			return picoCatalogPricePublished(price)
		}
		if !strings.EqualFold(strings.TrimSpace(stringValue(extra["catalog_status"])), "active") {
			return false
		}
		if !picoCatalogPricePublished(price) {
			return false
		}
		return true
	}
	return apiKeyCatalogModelSellable(extra, price)
}

func picoCatalogPricePublished(rule map[string]interface{}) bool {
	if strings.ToLower(strings.TrimSpace(stringValue(rule["pico_pricing_status"]))) != "published" {
		return false
	}
	return picoCatalogPriceReady(rule)
}

func picoCatalogPriceReady(rule map[string]interface{}) bool {
	switch strings.ToLower(strings.TrimSpace(stringValue(rule["billing_type"]))) {
	case "per_token":
		return perTokenPrice(rule, "input_price") > 0 || perTokenPrice(rule, "output_price") > 0
	case "per_image", "per_request", "per_second":
		return floatValue(rule["unit_price"]) > 0
	case "dynamic":
		return floatValue(rule["fallback_cost"]) > 0
	default:
		return false
	}
}

func ApiTokenAllowsModel(scopes []string, model string) bool {
	model = strings.TrimSpace(model)
	if model == "" {
		return false
	}
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope == "*" {
			return true
		}
		matched, err := path.Match(scope, model)
		if err == nil && matched {
			return true
		}
	}
	return false
}

// SelectApiTokenScopes validates a customer-selected subset of a published
// product. An empty selection means "the whole product" for backwards
// compatibility. A non-empty selection is always reduced to exact model IDs;
// wildcard scopes are accepted only for the all-model product and only when
// explicitly selected as the sole value. This keeps provider/model limits
// enforceable even when the request is forged outside the web UI.
func SelectApiTokenScopes(product *ApiKeyProduct, requested []string) ([]string, error) {
	if product == nil {
		return nil, errors.New("API Key 产品不存在")
	}
	allowedScopes, err := normalizeProductScopes(product.ModelScopes)
	if err != nil {
		return nil, err
	}
	if len(requested) == 0 {
		return append([]string(nil), allowedScopes...), nil
	}
	if len(requested) > 1000 {
		return nil, errors.New("API Key 最多只能授权 1000 个模型")
	}

	// The product response contains the authoritative exact model list. Keep a
	// fallback for older callers that construct a product in-process without
	// populating Models, but never let a wildcard product authorize an arbitrary
	// model that was not present in that list.
	modelSet := make(map[string]struct{}, len(product.Models))
	for _, model := range product.Models {
		code := strings.TrimSpace(model.Code)
		if code != "" {
			modelSet[code] = struct{}{}
		}
	}
	allowedSet := make(map[string]struct{}, len(allowedScopes))
	for _, scope := range allowedScopes {
		allowedSet[scope] = struct{}{}
	}
	allProduct := false
	if _, ok := allowedSet["*"]; ok {
		allProduct = true
	}

	selected := make([]string, 0, len(requested))
	seen := make(map[string]struct{}, len(requested))
	for _, raw := range requested {
		scope := strings.TrimSpace(raw)
		if scope == "" {
			continue
		}
		if len(scope) > 128 {
			return nil, errors.New("API Key 模型编码过长")
		}
		if _, duplicate := seen[scope]; duplicate {
			continue
		}
		seen[scope] = struct{}{}
		if scope == "*" {
			if !allProduct || len(requested) != 1 {
				return nil, errors.New("只有全部模型 Key 可以使用通配权限")
			}
			return []string{"*"}, nil
		}
		if strings.ContainsAny(scope, "*?[") {
			return nil, errors.New("模型权限必须使用具体模型编码")
		}
		if !allProduct {
			if _, ok := allowedSet[scope]; !ok {
				return nil, errors.New("所选模型不属于当前厂商 Key 产品")
			}
		} else if _, ok := modelSet[scope]; !ok {
			return nil, errors.New("所选模型当前不可用")
		}
		selected = append(selected, scope)
	}
	if len(selected) == 0 {
		return nil, errors.New("请至少选择一个模型")
	}
	return selected, nil
}

func normalizeProductScopes(scopes []string) ([]string, error) {
	clean := make([]string, 0, len(scopes))
	seen := make(map[string]struct{}, len(scopes))
	for _, raw := range scopes {
		scope := strings.TrimSpace(raw)
		if scope == "" {
			continue
		}
		if len(scope) > 128 {
			return nil, errors.New("API Key 模型编码过长")
		}
		if _, exists := seen[scope]; exists {
			continue
		}
		seen[scope] = struct{}{}
		clean = append(clean, scope)
	}
	if len(clean) == 0 {
		return nil, errors.New("API Key 产品未配置可用模型")
	}
	return clean, nil
}
