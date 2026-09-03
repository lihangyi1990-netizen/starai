package handler

import (
	"testing"

	"github.com/starai/api/internal/service"
)

func TestAPITokenProtocolAllowsRequest(t *testing.T) {
	cases := []struct {
		name     string
		protocol string
		path     string
		allowed  bool
	}{
		{"universal can use OpenAI", service.ApiTokenProtocolUniversal, "/v1/chat/completions", true},
		{"universal can use Claude", service.ApiTokenProtocolUniversal, "/v1/messages", true},
		{"universal can use video", service.ApiTokenProtocolUniversal, "/v1/videos", true},
		{"universal can use audio", service.ApiTokenProtocolUniversal, "/v1/audio/speech", true},
		{"OpenAI can use image generation", service.ApiTokenProtocolOpenAI, "/v1/images/generations", true},
		{"OpenAI can use video generation", service.ApiTokenProtocolOpenAI, "/v1/videos", true},
		{"OpenAI cannot use Claude messages", service.ApiTokenProtocolOpenAI, "/v1/messages", false},
		{"Claude can discover models", service.ApiTokenProtocolAnthropic, "/v1/models", true},
		{"Claude cannot use OpenAI chat", service.ApiTokenProtocolAnthropic, "/v1/chat/completions", false},
		{"Gemini can generate content", service.ApiTokenProtocolGemini, "/v1beta/models/gemini-2.0:generateContent", true},
		{"Gemini cannot use OpenAI image", service.ApiTokenProtocolGemini, "/v1/images/generations", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := apiTokenProtocolAllowsRequest(tc.protocol, tc.path); got != tc.allowed {
				t.Fatalf("apiTokenProtocolAllowsRequest(%q, %q) = %v, want %v", tc.protocol, tc.path, got, tc.allowed)
			}
		})
	}
}

func TestApiTokenStoredScopesNeedRefresh(t *testing.T) {
	cases := []struct {
		name     string
		identity service.ApiTokenIdentity
		want     bool
	}{
		{
			name: "legacy vendor wildcard",
			identity: service.ApiTokenIdentity{
				ProductCode: "pico-openai",
				ModelScopes: []string{"gpt-*"},
			},
			want: true,
		},
		{
			name: "exact vendor scopes",
			identity: service.ApiTokenIdentity{
				ProductCode: "pico-openai",
				ModelScopes: []string{"gpt-5.6"},
			},
			want: false,
		},
		{
			name: "all product wildcard is intentional",
			identity: service.ApiTokenIdentity{
				ProductCode: "pico-all",
				ModelScopes: []string{"*"},
			},
			want: false,
		},
		{
			name: "legacy product without code",
			identity: service.ApiTokenIdentity{
				ModelScopes: []string{"gpt-*"},
			},
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := apiTokenStoredScopesNeedRefresh(tc.identity); got != tc.want {
				t.Fatalf("apiTokenStoredScopesNeedRefresh(%#v)=%v, want %v", tc.identity, got, tc.want)
			}
		})
	}
}

func TestApiTokenScopeDecisionDoesNotBroadenExactSelection(t *testing.T) {
	identity := service.ApiTokenIdentity{
		ProductCode: "pico-openai",
		ModelScopes: []string{"gpt-5.6"},
	}
	if allow, refresh := apiTokenScopeDecision(identity, "gpt-5.6"); !allow || refresh {
		t.Fatalf("selected model decision = allow:%v refresh:%v, want allow:true refresh:false", allow, refresh)
	}
	if allow, refresh := apiTokenScopeDecision(identity, "gpt-4.1"); allow || refresh {
		t.Fatalf("unselected model decision = allow:%v refresh:%v, want allow:false refresh:false", allow, refresh)
	}
}

func TestApiTokenScopeDecisionRefreshesOnlyLegacyWildcard(t *testing.T) {
	identity := service.ApiTokenIdentity{
		ProductCode: "pico-openai",
		ModelScopes: []string{"gpt-*"},
	}
	if allow, refresh := apiTokenScopeDecision(identity, "gpt-5.6"); allow || !refresh {
		t.Fatalf("legacy wildcard decision = allow:%v refresh:%v, want allow:false refresh:true", allow, refresh)
	}
}
