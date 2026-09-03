package service

import "testing"

func TestRedactSensitiveDetailHidesPrivateKeysRecursively(t *testing.T) {
	detail := map[string]interface{}{
		"waffo_pancake_private_key": "-----BEGIN PRIVATE KEY-----secret",
		"nested": map[string]interface{}{
			"private_key": "another-secret",
			"safe":        "visible",
		},
		"safe_value": "visible",
	}
	redacted, ok := redactSensitiveDetail(detail).(map[string]interface{})
	if !ok {
		t.Fatalf("redacted detail type = %T", redactSensitiveDetail(detail))
	}
	if redacted["waffo_pancake_private_key"] != "****" || redacted["safe_value"] != "visible" {
		t.Fatalf("unexpected top-level redaction: %#v", redacted)
	}
	nested, ok := redacted["nested"].(map[string]interface{})
	if !ok || nested["private_key"] != "****" || nested["safe"] != "visible" {
		t.Fatalf("unexpected nested redaction: %#v", redacted["nested"])
	}
}

func TestIsMaskedAdminSecretRecognizesOnlyGeneratedMasks(t *testing.T) {
	for _, value := range []string{"****", "abcd****wxyz", "前缀文字****后缀"} {
		if !isMaskedAdminSecret(value) {
			t.Errorf("isMaskedAdminSecret(%q) = false, want true", value)
		}
	}
	for _, value := range []string{"", "abc***xyz", "abcd****", "********", "a****b"} {
		if isMaskedAdminSecret(value) {
			t.Errorf("isMaskedAdminSecret(%q) = true, want false", value)
		}
	}
}

func TestMaskedAdminSecretMatchesCurrentValue(t *testing.T) {
	if !maskedAdminSecretMatches("abcdefghijk", "abcd****hijk") {
		t.Fatal("generated mask should match its current secret")
	}
	if maskedAdminSecretMatches("abcdefghijk", "abcd****x") {
		t.Fatal("lookalike mask for a different secret must be written")
	}
	if !maskedAdminSecretMatches("short", "****") {
		t.Fatal("short secret mask should match")
	}
	if maskedAdminSecretMatches("", "****") {
		t.Fatal("mask must not preserve an empty current value")
	}
}
