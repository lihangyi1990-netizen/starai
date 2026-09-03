package main

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
)

func TestResolveImageGenerationInputFallsBackUnsupportedBananaRatio(t *testing.T) {
	input := map[string]interface{}{
		"aspect_ratio": "4:5",
		"image_size":   "4K",
	}

	resolveImageGenerationInput(input, nil, "/v1/videos", "nano_banana_pro-2K")

	if got := input["aspect_ratio"]; got != "1:1" {
		t.Fatalf("aspect_ratio = %v, want 1:1", got)
	}
	if got := input["image_size"]; got != "4K" {
		t.Fatalf("image_size = %v, want 4K", got)
	}
	if got := input["size"]; got != "2880x2880" {
		t.Fatalf("size = %v, want 2880x2880", got)
	}
}

func TestResolveImageGenerationInputMapsOpenAICompatibleSizes(t *testing.T) {
	tests := []struct {
		name             string
		ratio            string
		tier             string
		wantUpstreamSize string
		wantResolvedSize string
	}{
		{name: "square 4k", ratio: "1:1", tier: "4K", wantUpstreamSize: "1024x1024", wantResolvedSize: "2880x2880"},
		{name: "landscape 4k", ratio: "16:9", tier: "4K", wantUpstreamSize: "1536x1024", wantResolvedSize: "3840x2160"},
		{name: "portrait 2k", ratio: "9:16", tier: "2K", wantUpstreamSize: "1024x1536", wantResolvedSize: "1440x2560"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := map[string]interface{}{"aspect_ratio": tt.ratio, "image_size": tt.tier}
			resolveImageGenerationInput(input, nil, "/v1/images/generations", "gpt-image-2")
			if got := input["size"]; got != tt.wantUpstreamSize {
				t.Fatalf("size = %v, want upstream %s", got, tt.wantUpstreamSize)
			}
			if got := input["upstream_size"]; got != tt.wantUpstreamSize {
				t.Fatalf("upstream_size = %v, want %s", got, tt.wantUpstreamSize)
			}
			if got := input["resolved_size"]; got != tt.wantResolvedSize {
				t.Fatalf("resolved_size = %v, want %s", got, tt.wantResolvedSize)
			}
		})
	}
}

func TestResolveImageGenerationInputKeepsNativeAndBananaContracts(t *testing.T) {
	tests := []struct {
		name, endpoint, model, wantSize string
	}{
		{name: "gemini native", endpoint: "/v1beta/models/gemini-3.1-flash-image:generateContent", model: "gemini-3.1-flash-image", wantSize: "3840x2160"},
		{name: "nano banana video", endpoint: "/v1/videos", model: "nano_banana_pro-4K", wantSize: "3840x2160"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := map[string]interface{}{"aspect_ratio": "16:9", "image_size": "4K"}
			resolveImageGenerationInput(input, nil, tt.endpoint, tt.model)
			if got := input["size"]; got != tt.wantSize {
				t.Fatalf("size = %v, want %s", got, tt.wantSize)
			}
			if got := input["resolved_size"]; got != tt.wantSize {
				t.Fatalf("resolved_size = %v, want %s", got, tt.wantSize)
			}
		})
	}
}

func TestResolveImageGenerationInputPreservesCustomDimensions(t *testing.T) {
	input := map[string]interface{}{
		"aspect_ratio": "1:1",
		"image_size":   "2K",
		"width":        float64(1600),
		"height":       float64(900),
	}

	resolveImageGenerationInput(input, nil, "/v1/images/generations", "gpt-image-2")

	if got := input["resolved_size"]; got != "1600x900" {
		t.Fatalf("resolved_size = %v, want 1600x900", got)
	}
	if got := input["size"]; got != "1536x1024" {
		t.Fatalf("upstream size = %v, want 1536x1024", got)
	}
	if got := input["aspect_ratio"]; got != "16:9" {
		t.Fatalf("aspect_ratio = %v, want closest 16:9", got)
	}
	if got := input["width"]; got != 1600 {
		t.Fatalf("width = %v, want canonical integer 1600", got)
	}
}

func TestResolveImageGenerationInputAcceptsCustomSizeString(t *testing.T) {
	input := map[string]interface{}{
		"size": "1000x800",
	}

	resolveImageGenerationInput(input, nil, "/v1beta/models/gemini-3.1-flash-image:generateContent", "gemini-3.1-flash-image")

	if got := input["resolved_size"]; got != "1000x800" {
		t.Fatalf("resolved_size = %v, want 1000x800", got)
	}
	if got := input["width"]; got != 1000 {
		t.Fatalf("width = %v, want 1000", got)
	}
	if got := input["height"]; got != 800 {
		t.Fatalf("height = %v, want 800", got)
	}
}

func TestCustomImageDimensionsRejectOutOfBounds(t *testing.T) {
	for name, input := range map[string]map[string]interface{}{
		"too small":       {"width": float64(32), "height": float64(512)},
		"too large":       {"width": float64(4097), "height": float64(512)},
		"too many pixels": {"width": float64(4096), "height": float64(4096)},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, ok := customImageDimensions(input); ok {
				t.Fatalf("customImageDimensions accepted invalid input: %#v", input)
			}
		})
	}
}

func TestBuildOpenAIImagePayloadOmitsUIOnlyParameters(t *testing.T) {
	payload := buildOpenAIImagePayload(nil, "gpt-image-2", "", "draw a lighthouse", "1536x1024", nil)
	for _, key := range []string{"n", "count", "aspect_ratio", "ratio", "image_size", "quality"} {
		if _, ok := payload[key]; ok {
			t.Fatalf("payload contains UI-only field %q: %#v", key, payload)
		}
	}
	if got := payload["size"]; got != "1536x1024" {
		t.Fatalf("size = %v, want 1536x1024", got)
	}
}

func TestImageModelForSizeMapsAsyncImageFamilies(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		model    string
		tier     string
		want     string
	}{
		{name: "banana 1k", endpoint: "/v1/videos", model: "nano_banana_2", tier: "1K", want: "nano_banana_pro-1K"},
		{name: "banana 4k", endpoint: "/v1/videos", model: "nano_banana_pro-1K", tier: "4K", want: "nano_banana_pro-4K"},
		{name: "gpt image 2k", endpoint: "/v1/videos", model: "gpt-image-2", tier: "2K", want: "gpt-image-2-2K"},
		{name: "gpt image 4k", endpoint: "/v1/videos", model: "gpt-image-2-2K", tier: "4K", want: "gpt-image-2-4K"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := imageModelForSize(nil, tt.endpoint, tt.model, "", tt.tier); got != tt.want {
				t.Fatalf("model = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestImageModelForSizePrefersRuntimeRule(t *testing.T) {
	rule := map[string]interface{}{
		"image": map[string]interface{}{
			"model_by_size": map[string]interface{}{
				"2K": "custom-image-2k",
			},
		},
	}

	if got := imageModelForSize(rule, "/v1/videos", "gpt-image-2", "", "2K"); got != "custom-image-2k" {
		t.Fatalf("model = %s, want custom-image-2k", got)
	}
}

func TestGeminiNativePayloadImageSizeForSupportedModels(t *testing.T) {
	input := map[string]interface{}{
		"aspect_ratio": "16:9",
		"image_size":   "4K",
	}

	for _, model := range []string{"gemini-3.1-flash-image-preview", "gemini-3.1-flash-image", "nano-banana-pro"} {
		payload := buildGeminiNativeImagePayload(nil, model, "", "prompt", input)
		cfg := payload["generationConfig"].(map[string]interface{})["imageConfig"].(map[string]interface{})
		if got := cfg["imageSize"]; got != "4K" {
			t.Fatalf("%s imageSize = %v, want 4K", model, got)
		}
	}

	pro := buildGeminiNativeImagePayload(nil, "gemini-3-pro-image-preview", "", "prompt", input)
	proCfg := pro["generationConfig"].(map[string]interface{})["imageConfig"].(map[string]interface{})
	if _, ok := proCfg["imageSize"]; ok {
		t.Fatalf("pro payload should not include imageSize: %#v", proCfg)
	}
}

func TestParseUpstreamMediaGeminiSSE(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("image-bytes-", 32)))
	event := `data: {"responseId":"resp_123","candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"` + encoded + `"}}]}}]}`
	body := []byte("event: message\n" + event + "\n\n" + event + "\n\ndata: [DONE]\n")

	items, upstreamID := parseUpstreamMedia(body)
	if upstreamID != "resp_123" {
		t.Fatalf("upstreamID = %q, want resp_123", upstreamID)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want one deduplicated image", len(items))
	}
	if items[0].B64JSON != encoded || items[0].MimeType != "image/png" {
		t.Fatalf("unexpected media item: %#v", items[0])
	}
}

func TestBuildVideoImagePayloadIncludesBananaReferenceImages(t *testing.T) {
	input := map[string]interface{}{
		"reference_images": []string{
			"data:image/png;base64,Zmlyc3Q=",
			"data:image/jpeg;base64,c2Vjb25k",
		},
	}

	payload := buildVideoImagePayload(context.Background(), nil, "/v1/videos", "nano_banana_2", "", "prompt", input)
	images, ok := payload["images"].([]string)
	if !ok {
		t.Fatalf("images type = %T, want []string; payload=%#v", payload["images"], payload)
	}
	if len(images) != 2 || images[0] != "data:image/png;base64,Zmlyc3Q=" || images[1] != "data:image/jpeg;base64,c2Vjb25k" {
		t.Fatalf("images = %#v, want both uploaded references", images)
	}
}

func TestBuildVideoImagePayloadFallsBackToImageURL(t *testing.T) {
	input := map[string]interface{}{
		"image_url": "data:image/png;base64,cGhvbmU=",
	}

	payload := buildVideoImagePayload(context.Background(), nil, "/v1/videos", "nano_banana_2", "", "prompt", input)
	images, ok := payload["images"].([]string)
	if !ok || len(images) != 1 || images[0] != "data:image/png;base64,cGhvbmU=" {
		t.Fatalf("image_url was not forwarded as Nano Banana images: %#v", payload)
	}
}

func TestAgentPromptLocksUploadedReferenceSubject(t *testing.T) {
	prompt := agentPromptWithScene("create a premium product shot", map[string]interface{}{
		"image_url": "https://cdn.example/phone.png",
	})

	for _, required := range []string{"REFERENCE IMAGE HARD REQUIREMENT", "authoritative subject", "never turn a phone into a drone"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("prompt does not contain %q: %s", required, prompt)
		}
	}
}

func TestAgentPromptDoesNotAddReferenceLockWithoutReference(t *testing.T) {
	prompt := agentPromptWithScene("create a premium product shot", map[string]interface{}{})
	if strings.Contains(prompt, "REFERENCE IMAGE HARD REQUIREMENT") {
		t.Fatalf("reference lock added without a reference: %s", prompt)
	}
}

func TestAgentPromptDoesNotTreatComicStyleCoverAsSubjectReference(t *testing.T) {
	prompt := agentPromptWithScene("create a premium product shot", map[string]interface{}{
		"comic_style": map[string]interface{}{"cover_url": "https://cdn.example/style-cover.png"},
	})
	if strings.Contains(prompt, "REFERENCE IMAGE HARD REQUIREMENT") {
		t.Fatalf("style cover incorrectly locked as the generated subject: %s", prompt)
	}
}
