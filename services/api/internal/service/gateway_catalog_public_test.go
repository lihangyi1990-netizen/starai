package service

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGatewayCatalogPublicMetadataIsNeutral(t *testing.T) {
	description, tags := gatewayCatalogPublicMetadata("video")
	if gatewayCatalogContainsInternalTerm(description) {
		t.Fatalf("public description contains infrastructure text: %q", description)
	}
	if len(tags) != 1 || tags[0] != "video" {
		t.Fatalf("public tags = %#v, want [video]", tags)
	}
}

func TestSanitizeGatewayCatalogPublicMetadata(t *testing.T) {
	description := gatewayCatalogLegacyDescription
	model := ModelDTO{
		Code:        "gpt-5.6",
		Category:    "chat",
		Description: &description,
		Provider:    "gateway",
		Tags:        []string{"Sub2API", "chat", "账号池"},
		RuntimeRule: map[string]interface{}{
			"upstream": map[string]interface{}{
				"adapter":  "sub2api",
				"endpoint": "/internal/gateway",
				"map":      map[string]interface{}{"prompt": "messages"},
			},
			"capabilities": map[string]interface{}{"stream": true},
		},
		InputSchema: map[string]interface{}{
			"properties": map[string]interface{}{
				"provider": map[string]interface{}{"enum": []interface{}{"openai", "sub2api"}},
				"prompt":   map[string]interface{}{"type": "string"},
			},
		},
		DefaultParams: map[string]interface{}{"provider": "openai", "endpoint": "/v1/chat/completions"},
		PriceRule:     map[string]interface{}{"unit_price": 1.2, "provider_cost": 0.3, "currency": "CNY"},
	}

	sanitizeGatewayCatalogPublicMetadata(&model, []byte(`{"catalog_source":"sub2api"}`))

	if model.Description == nil || *model.Description != gatewayCatalogPublicDescription {
		t.Fatalf("public description = %v, want neutral description", model.Description)
	}
	if model.Provider != "openai" {
		t.Fatalf("public provider = %q, want inferred real vendor", model.Provider)
	}
	if len(model.Tags) != 1 || model.Tags[0] != "chat" {
		t.Fatalf("public tags = %#v, want [chat]", model.Tags)
	}
	if _, ok := model.RuntimeRule["upstream"].(map[string]interface{}); !ok {
		t.Fatal("safe runtime structure should remain available to the UI")
	}
	upstream := model.RuntimeRule["upstream"].(map[string]interface{})
	if _, ok := upstream["endpoint"]; ok {
		t.Fatal("runtime endpoint must not be exposed")
	}
	if _, ok := upstream["adapter"]; ok {
		t.Fatal("internal runtime adapter must not be exposed")
	}
	if _, ok := model.DefaultParams["endpoint"]; ok {
		t.Fatal("default endpoint must not be exposed")
	}
	if _, ok := model.PriceRule["provider_cost"]; ok {
		t.Fatal("provider cost must not be exposed")
	}
	raw, _ := json.Marshal(model)
	if strings.Contains(strings.ToLower(string(raw)), "sub2api") || strings.Contains(string(raw), "账号池") {
		t.Fatalf("sanitized public model still contains infrastructure text: %s", raw)
	}
}

func TestSanitizeGatewayCatalogPublicMetadataLeavesNonCatalogRowsUntouched(t *testing.T) {
	description := "由管理员配置的模型"
	model := ModelDTO{
		Code:        "custom",
		Category:    "chat",
		Description: &description,
		Provider:    "custom-vendor",
		Tags:        []string{"custom"},
		RuntimeRule: map[string]interface{}{"endpoint": "/custom"},
	}

	sanitizeGatewayCatalogPublicMetadata(&model, []byte(`{"catalog_source":"manual"}`))
	if model.Description == nil || *model.Description != description || model.Provider != "custom-vendor" {
		t.Fatalf("non-catalog metadata was changed: %#v", model)
	}
	if _, ok := model.RuntimeRule["endpoint"]; !ok {
		t.Fatal("non-catalog runtime metadata should remain untouched")
	}
}

func TestSanitizePublicAPIDocKeepsProtocolShape(t *testing.T) {
	doc := &APIDocDTO{
		ModelDesc: "来自 Sub2API 账号池的模型",
		Content: map[string]interface{}{
			"notes":           []string{"请勿填写上游供应商 Key", "model 使用平台编码"},
			"request_example": map[string]interface{}{"endpoint": "/v1/chat/completions", "model": "gpt-5.6"},
		},
	}

	SanitizePublicAPIDoc(doc)
	if doc.ModelDesc != gatewayCatalogPublicDescription {
		t.Fatalf("public model description = %q, want neutral description", doc.ModelDesc)
	}
	notes, ok := doc.Content["notes"].([]string)
	if !ok || len(notes) != 2 || gatewayCatalogContainsSensitiveTerm(notes[0]) {
		t.Fatalf("public notes were not sanitized: %#v", doc.Content["notes"])
	}
	example, ok := doc.Content["request_example"].(map[string]interface{})
	if !ok || example["endpoint"] != "/v1/chat/completions" {
		t.Fatalf("protocol example changed unexpectedly: %#v", doc.Content["request_example"])
	}
}
