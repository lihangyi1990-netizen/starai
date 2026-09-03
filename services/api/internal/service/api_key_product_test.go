package service

import "testing"

func TestApiTokenAllowsModel(t *testing.T) {
	cases := []struct {
		name   string
		scopes []string
		model  string
		want   bool
	}{
		{"all product", []string{"*"}, "seedance-2.0", true},
		{"GPT product allows GPT", []string{"gpt-*", "codex-*"}, "gpt-5.6", true},
		{"GPT product blocks Claude", []string{"gpt-*", "codex-*"}, "claude-sonnet-4-6", false},
		{"Claude product allows Claude", []string{"claude-*"}, "claude-sonnet-4-6", true},
		{"empty scopes deny", nil, "gpt-5.6", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ApiTokenAllowsModel(tc.scopes, tc.model); got != tc.want {
				t.Fatalf("ApiTokenAllowsModel(%v, %q)=%v, want %v", tc.scopes, tc.model, got, tc.want)
			}
		})
	}
}

func TestSelectApiTokenScopes(t *testing.T) {
	product := &ApiKeyProduct{
		Code:        "pico-openai",
		ModelScopes: []string{"gpt-5.6", "gpt-4.1", "dall-e-3"},
		Models: []ApiKeyProductModel{
			{Code: "gpt-5.6", DisplayName: "GPT 5.6"},
			{Code: "gpt-4.1", DisplayName: "GPT 4.1"},
			{Code: "dall-e-3", DisplayName: "DALL-E 3"},
		},
	}
	tests := []struct {
		name      string
		requested []string
		want      []string
		wantErr   bool
	}{
		{name: "empty keeps provider product", want: []string{"gpt-5.6", "gpt-4.1", "dall-e-3"}},
		{name: "exact subset", requested: []string{"gpt-4.1", "gpt-5.6", "gpt-4.1"}, want: []string{"gpt-4.1", "gpt-5.6"}},
		{name: "unknown model rejected", requested: []string{"claude-sonnet-4-6"}, wantErr: true},
		{name: "wildcard provider rejected", requested: []string{"gpt-*"}, wantErr: true},
		{name: "blank selection rejected", requested: []string{"", "  "}, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := SelectApiTokenScopes(product, tc.requested)
			if (err != nil) != tc.wantErr {
				t.Fatalf("error=%v, wantErr=%v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if len(got) != len(tc.want) {
				t.Fatalf("scopes=%v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("scopes=%v, want %v", got, tc.want)
				}
			}
		})
	}
}

func TestSelectApiTokenScopesAllProduct(t *testing.T) {
	product := &ApiKeyProduct{
		Code:        "pico-all",
		ModelScopes: []string{"*"},
		Models:      []ApiKeyProductModel{{Code: "gpt-5.6"}, {Code: "claude-sonnet-4-6"}},
	}
	if got, err := SelectApiTokenScopes(product, []string{"gpt-5.6", "claude-sonnet-4-6"}); err != nil || len(got) != 2 {
		t.Fatalf("exact all-product subset = %v, err=%v", got, err)
	}
	if got, err := SelectApiTokenScopes(product, []string{"*"}); err != nil || len(got) != 1 || got[0] != "*" {
		t.Fatalf("wildcard all-product selection = %v, err=%v", got, err)
	}
	if _, err := SelectApiTokenScopes(product, []string{"unknown-model"}); err == nil {
		t.Fatal("unknown model should be rejected for wildcard product")
	}
	if _, err := SelectApiTokenScopes(product, []string{"*", "gpt-5.6"}); err == nil {
		t.Fatal("mixed wildcard and exact scopes should be rejected")
	}
}

func TestCatalogProviderAndPricePublication(t *testing.T) {
	if got := CatalogProvider("gpt-5.6"); got != "openai" {
		t.Fatalf("provider=%q, want openai", got)
	}
	if got := CatalogProvider("claude-sonnet-4-6"); got != "anthropic" {
		t.Fatalf("provider=%q, want anthropic", got)
	}
	if !picoCatalogPricePublished(map[string]interface{}{"pico_pricing_status": "published", "billing_type": "per_request", "unit_price": 0.2}) {
		t.Fatal("published per-request price should be sellable")
	}
	if picoCatalogPricePublished(map[string]interface{}{"pico_pricing_status": "pending", "billing_type": "per_request", "unit_price": 0.2}) {
		t.Fatal("pending price must not be sellable")
	}
}

func TestCatalogProviderRecognizesQualifiedThirdPartyModels(t *testing.T) {
	cases := map[string]string{
		"moonshot-v1-8k":       "kimi",
		"deepseek/deepseek-v3": "deepseek",
		"glm-4.5":              "zhipu",
		"qwen-max":             "qwen",
		"minimax/abab6.5s":     "minimax",
		"mistral-large":        "mistral",
	}
	for model, want := range cases {
		if got := CatalogProvider(model); got != want {
			t.Errorf("CatalogProvider(%q)=%q, want %q", model, got, want)
		}
	}
	if got := CatalogProviderWithHint("custom-model", "xai"); got != "grok" {
		t.Fatalf("CatalogProviderWithHint xai=%q, want grok", got)
	}
}

func TestCatalogProviderWithHintIgnoresGenericGatewayOwners(t *testing.T) {
	cases := map[string]string{
		"starai":  "openai",
		"sub2api": "anthropic",
		"pico":    "grok",
		"other":   "openai",
	}
	for hint, want := range cases {
		if got := CatalogProviderWithHint(map[string]string{
			"starai":  "gpt-5.6",
			"sub2api": "claude-sonnet-4-6",
			"pico":    "grok-4",
			"other":   "gpt-5.6",
		}[hint], hint); got != want {
			t.Errorf("CatalogProviderWithHint(%q)=%q, want %q", hint, got, want)
		}
		if !CatalogProviderHintIsGeneric(hint) {
			t.Errorf("%q should be recognized as a generic gateway owner", hint)
		}
	}
	if got := CatalogProviderWithHint("custom/model", "Relay B"); got != "relay b" {
		t.Fatalf("custom owner=%q, want relay b", got)
	}
	if CatalogProviderHintIsGeneric("Relay B") {
		t.Fatal("real custom owner must not be treated as generic")
	}
	if CatalogProviderHintIsGeneric("tuna") {
		t.Fatal("custom provider slug tuna must remain available")
	}
	if got := CatalogProviderWithExtra("gpt-5.6", map[string]interface{}{"provider": "starai"}); got != "openai" {
		t.Fatalf("generic stored provider should fall back to model id, got %q", got)
	}
	if got := catalogProviderForStorage("Sub2API"); got != "" {
		t.Fatalf("generic provider storage value = %q, want empty", got)
	}
	if got := catalogProviderForStorage("Relay B"); got != "relay b" {
		t.Fatalf("custom provider storage value = %q, want relay b", got)
	}
}

func TestProviderProductsStartWithExactScopesOnly(t *testing.T) {
	for _, provider := range []string{"openai", "anthropic", "grok", "gemini", "seedance", "custom-relay"} {
		product := apiKeyProductForProvider(provider)
		if product == nil {
			t.Fatalf("provider %q returned nil product", provider)
		}
		if len(product.ModelScopes) != 0 {
			t.Fatalf("provider %q has default scopes %v; scopes must be populated from published model IDs", provider, product.ModelScopes)
		}
	}
}

func TestCustomProviderProductsKeepDistinctSlugs(t *testing.T) {
	first := apiKeyProductForProvider("waffo-pancake")
	second := apiKeyProductForProvider("relay-b")
	if first.Code != "pico-waffo-pancake" || second.Code != "pico-relay-b" {
		t.Fatalf("custom product codes = %q, %q", first.Code, second.Code)
	}
	if first.Code == second.Code || first.Code == "pico-other" || second.Code == "pico-other" {
		t.Fatalf("custom providers were merged: %q, %q", first.Code, second.Code)
	}
	if got := CatalogProviderWithExtra("vendor-model", map[string]interface{}{"provider": "Relay B"}); got != "relay b" {
		t.Fatalf("explicit provider = %q, want relay b", got)
	}
}

func TestApiKeyCatalogModelSellable(t *testing.T) {
	if !apiKeyCatalogModelSellable(nil, nil) {
		t.Fatal("enabled manual model should be sellable")
	}
	if apiKeyCatalogModelSellable(
		map[string]interface{}{"catalog_source": "sub2api", "catalog_status": "active"},
		map[string]interface{}{"pico_pricing_status": "pending", "billing_type": "per_request", "unit_price": 1.0},
	) {
		t.Fatal("pending Sub2API pricing should not be sellable")
	}
	if !apiKeyCatalogModelSellable(
		map[string]interface{}{"catalog_source": "sub2api", "catalog_status": "active"},
		map[string]interface{}{"pico_pricing_status": "published", "billing_type": "per_request", "unit_price": 1.0},
	) {
		t.Fatal("published Sub2API pricing should be sellable")
	}
	if apiKeyCatalogModelSellable(
		map[string]interface{}{"catalog_source": "sub2api", "catalog_status": "unavailable"},
		map[string]interface{}{"pico_pricing_status": "published", "billing_type": "per_request", "unit_price": 1.0},
	) {
		t.Fatal("unavailable Sub2API model should not be sellable")
	}
	if apiKeyCatalogModelSellable(
		map[string]interface{}{"catalog_source": "sub2api"},
		map[string]interface{}{"pico_pricing_status": "published", "billing_type": "per_request", "unit_price": 1.0},
	) {
		t.Fatal("Sub2API model without an active catalog status should not be sellable")
	}
}

func TestApiKeyCatalogModelSellableForMode(t *testing.T) {
	published := map[string]interface{}{
		"pico_pricing_status": "published",
		"billing_type":        "per_request",
		"unit_price":          1.0,
	}
	if apiKeyCatalogModelSellableForMode(map[string]interface{}{"catalog_source": "manual"}, published, true) {
		t.Fatal("strict Sub2API mode must exclude manual catalog rows")
	}
	if apiKeyCatalogModelSellableForMode(map[string]interface{}{"catalog_source": "sub2api", "catalog_status": "unavailable"}, published, true) {
		t.Fatal("strict Sub2API mode must exclude unavailable rows")
	}
	if !apiKeyCatalogModelSellableForMode(map[string]interface{}{"catalog_source": "sub2api", "catalog_status": "active"}, published, true) {
		t.Fatal("strict Sub2API mode should include active, published rows")
	}
	if !apiKeyCatalogModelSellableForMode(map[string]interface{}{"catalog_source": "manual"}, nil, false) {
		t.Fatal("legacy mode should retain enabled manual rows")
	}
}
