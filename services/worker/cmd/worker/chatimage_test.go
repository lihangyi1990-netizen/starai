package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// 1x1 jpeg, base64
const tinyJPEG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNCwsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzMv/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A/v4oAKACgD//2Q=="

func TestChatCompletionImageExtraction(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"id": "chatcmpl-x", "object": "chat.completion", "model": "nano-banana-pro",
		"choices": []interface{}{map[string]interface{}{
			"index": 0, "finish_reason": "stop",
			"message": map[string]interface{}{
				"role":    "assistant",
				"content": "![image](data:image/jpeg;base64," + tinyJPEG + ")",
			},
		}},
		"usage": map[string]interface{}{"total_tokens": 1485},
	})
	items, upstreamID := parseUpstreamMedia(body)
	if len(items) != 1 {
		t.Fatalf("want 1 item, got %d", len(items))
	}
	// The chat completion id is picked up as an upstream id. That is harmless:
	// polling only starts when no media was extracted, so it stays metadata.
	if upstreamID != "chatcmpl-x" {
		t.Errorf("upstreamID = %q", upstreamID)
	}
	if items[0].URL != "" {
		t.Errorf("want inline base64, got URL=%q", items[0].URL)
	}
	if !strings.HasPrefix(items[0].B64JSON, "data:image/jpeg;base64,") {
		t.Errorf("B64JSON not a data URI: %.40q", items[0].B64JSON)
	}
	// The whole point: this must decode to real JPEG bytes.
	data, ct, err := decodeEncodedMedia(items[0].B64JSON, items[0].MimeType, "image")
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if ct != "image/jpeg" {
		t.Errorf("content type = %q, want image/jpeg", ct)
	}
	if !validDownloadedMedia("image", ct, data) {
		t.Errorf("decoded bytes rejected as image (%d bytes)", len(data))
	}
}

func TestChatCompletionImageExtractionVariants(t *testing.T) {
	cases := map[string]string{
		"bare data uri":  "data:image/png;base64," + tinyJPEG,
		"prose wrapped":  "Here you go!\n\ndata:image/png;base64," + tinyJPEG + "\n\nEnjoy.",
		"markdown angle": "![img](<data:image/jpeg;base64," + tinyJPEG + ">)",
		"http url":       "![img](https://cdn.example.com/a.png)",
	}
	for name, content := range cases {
		body, _ := json.Marshal(map[string]interface{}{
			"choices": []interface{}{map[string]interface{}{
				"message": map[string]interface{}{"role": "assistant", "content": content}}}})
		items, _ := parseUpstreamMedia(body)
		if len(items) != 1 {
			t.Errorf("%s: want 1 item, got %d", name, len(items))
			continue
		}
		if items[0].URL == "" && items[0].B64JSON == "" {
			t.Errorf("%s: empty media item", name)
		}
	}
}

func TestChatCompletionTextOnlyIsNotMedia(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"choices": []interface{}{map[string]interface{}{
			"message": map[string]interface{}{"role": "assistant",
				"content": "I cannot generate that image."}}}})
	if items, _ := parseUpstreamMedia(body); len(items) != 0 {
		t.Errorf("plain refusal text must not yield media, got %+v", items)
	}
}

func TestChatImagePayloadShape(t *testing.T) {
	ctx := context.Background()
	p := buildChatImagePayload(ctx, "nano-banana-pro", "fallback", "a red apple", map[string]interface{}{})
	if p["model"] != "nano-banana-pro" {
		t.Errorf("model = %v", p["model"])
	}
	msgs, ok := p["messages"].([]interface{})
	if !ok || len(msgs) != 1 {
		t.Fatalf("messages malformed: %#v", p["messages"])
	}
	m := msgs[0].(map[string]interface{})
	if m["role"] != "user" || m["content"] != "a red apple" {
		t.Errorf("message = %#v", m)
	}
	if _, hasPrompt := p["prompt"]; hasPrompt {
		t.Error("chat payload must not carry the images-API prompt field")
	}

	// With a reference image the content becomes multimodal parts.
	p2 := buildChatImagePayload(ctx, "nano-banana-pro", "fallback", "add a hat",
		map[string]interface{}{"reference_images": []interface{}{"https://cdn.example.com/cat.jpg"}})
	m2 := p2["messages"].([]interface{})[0].(map[string]interface{})
	parts, ok := m2["content"].([]interface{})
	if !ok || len(parts) != 2 {
		t.Fatalf("want 2 content parts, got %#v", m2["content"])
	}
	if parts[0].(map[string]interface{})["type"] != "text" {
		t.Errorf("part0 = %#v", parts[0])
	}
	if parts[1].(map[string]interface{})["type"] != "image_url" {
		t.Errorf("part1 = %#v", parts[1])
	}
}

func TestChatCompletionsEndpointSelection(t *testing.T) {
	if !isChatCompletionsImageAPI("/v1/chat/completions") {
		t.Error("/v1/chat/completions must select the chat wire format")
	}
	if isChatCompletionsImageAPI("/v1/images/generations") {
		t.Error("/v1/images/generations must not select the chat wire format")
	}
	if isChatCompletionsImageAPI("/v1/videos") {
		t.Error("/v1/videos must not select the chat wire format")
	}
}
