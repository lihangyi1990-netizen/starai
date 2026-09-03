package handler

import "testing"

func TestBuildOpenAIStreamPayloadPreservesReasoningDelta(t *testing.T) {
	payload := buildOpenAIStreamPayload("req_1", "nvidia/nemotron", map[string]interface{}{
		"reasoning_content": "Analyze the request first.",
		"content":           "Final answer.",
	}, "", nil)
	choices, ok := payload["choices"].([]interface{})
	if !ok || len(choices) != 1 {
		t.Fatalf("choices=%#v", payload["choices"])
	}
	choice := choices[0].(map[string]interface{})
	delta := choice["delta"].(map[string]interface{})
	if delta["reasoning_content"] != "Analyze the request first." {
		t.Fatalf("reasoning delta=%#v", delta)
	}
	if delta["content"] != "Final answer." {
		t.Fatalf("content delta=%#v", delta)
	}
}

func TestBuildOpenAIStreamPayloadIncludesConversationIDOnFinalChunk(t *testing.T) {
	payload := buildOpenAIStreamPayloadWithConversation("req_1", "gpt-test", map[string]interface{}{}, "stop", nil, "conv_123")
	if got := payload["conversation_id"]; got != "conv_123" {
		t.Fatalf("conversation_id=%#v, want conv_123", got)
	}
}
