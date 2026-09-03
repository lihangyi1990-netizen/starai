package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/starai/api/internal/config"
	"github.com/starai/api/internal/runtime"
)

func TestRefreshGatewayCatalogForRequestFailsSoftWhenGatewayIsUnconfigured(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{cfg: &config.Config{NewAPIModelCatalogSync: true}}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	h.refreshGatewayCatalogForRequest(c)
	if got := c.Writer.Header().Get("X-Pico-Model-Catalog"); got != "stale" {
		t.Fatalf("catalog header = %q, want stale", got)
	}
}

func TestGatewayModelTransport(t *testing.T) {
	cases := []struct {
		model    string
		category string
		endpoint string
		mode     string
	}{
		{"gpt-5.6", "chat", "/v1/chat/completions", "chat_completions"},
		{"gpt-image-1", "image", "/v1/images/generations", "images"},
		{"sora-2", "video", "/v1/videos", "video"},
		{"tts-1-hd", "audio", "/v1/audio/speech", "audio"},
		{"seedance-2.0", "video", "/v1/videos", "video"},
		{"sd_2.0_mini_special", "video", "/v1/videos", "video"},
		{"kling-v2", "video", "/v1/videos", "video"},
		{"suno-v4", "audio", "/v1/audio/speech", "audio"},
		{"hailuo-speech-2.8", "audio", "/v1/audio/speech", "audio"},
		{"grok-imagine-video-with-audio", "video", "/v1/videos", "video"},
		{"grok-imagine-audio", "audio", "/v1/audio/speech", "audio"},
		{"flux-1.1-pro", "image", "/v1/images/generations", "images"},
		// Audio-preview chat models are still invoked through chat completions.
		{"gpt-4o-audio-preview", "chat", "/v1/chat/completions", "chat_completions"},
	}
	for _, tc := range cases {
		category, endpoint, mode := gatewayModelTransport(tc.model)
		if category != tc.category || endpoint != tc.endpoint || mode != tc.mode {
			t.Fatalf("%s: got (%s, %s, %s)", tc.model, category, endpoint, mode)
		}
	}
}

func TestGatewayCatalogEntriesSkipsDuplicatesAndLongCodes(t *testing.T) {
	entries := gatewayCatalogEntries([]runtime.UpstreamModel{
		{ID: "gpt-5.6", OwnedBy: "openai"},
		{ID: "gpt-5.6"},
		{ID: "gpt-image-1"},
		{ID: string(make([]byte, 65))},
	})
	if len(entries) != 2 {
		t.Fatalf("entry count = %d, want 2", len(entries))
	}
	if entries[0].Code != "gpt-5.6" || entries[0].SortOrder != 1 {
		t.Fatalf("first entry = %#v", entries[0])
	}
	if entries[0].Provider != "openai" {
		t.Fatalf("first provider = %q, want openai", entries[0].Provider)
	}
	if entries[1].Category != "image" || entries[1].SortOrder != 2 {
		t.Fatalf("second entry = %#v", entries[1])
	}
}

func TestGatewayCatalogEntriesDoesNotPersistGenericOwnerHints(t *testing.T) {
	entries := gatewayCatalogEntries([]runtime.UpstreamModel{
		{ID: "gpt-5.6", OwnedBy: "starai"},
		{ID: "claude-sonnet-4-6", OwnedBy: "sub2api"},
		{ID: "vendor/model", OwnedBy: "Relay B"},
		{ID: "grok-4"},
	})
	if len(entries) != 4 {
		t.Fatalf("entry count = %d, want 4", len(entries))
	}
	if entries[0].Provider != "openai" || entries[1].Provider != "anthropic" {
		t.Fatalf("generic owners should fall back to model ids: %#v, %#v", entries[0], entries[1])
	}
	if entries[0].ProviderSource != "inferred" || entries[1].ProviderSource != "inferred" {
		t.Fatalf("generic owners should be marked inferred: %q, %q", entries[0].ProviderSource, entries[1].ProviderSource)
	}
	if entries[2].Provider != "relay b" || entries[2].ProviderSource != "catalog" {
		t.Fatalf("custom owner = %q, want relay b", entries[2].Provider)
	}
	if entries[3].Provider != "grok" || entries[3].ProviderSource != "inferred" {
		t.Fatalf("missing owner should fall back to model id: %#v", entries[3])
	}
}
