package handler

import "testing"

func TestMockPaymentAllowed(t *testing.T) {
	tests := []struct {
		env  string
		want bool
	}{
		{"development", true},
		{" DEVELOPMENT ", true},
		{"local", true},
		{"test", true},
		{"production", false},
		{"staging", false},
		{"prodution", false},
		{"", false},
	}
	for _, tt := range tests {
		if got := mockPaymentAllowed(tt.env); got != tt.want {
			t.Errorf("mockPaymentAllowed(%q) = %v, want %v", tt.env, got, tt.want)
		}
	}
}

func TestSupportedPaymentChannel(t *testing.T) {
	tests := []struct {
		channel string
		want    bool
	}{
		{channel: "", want: true},
		{channel: "generic", want: true},
		{channel: "stripe", want: true},
		{channel: "paypal", want: true},
		{channel: "waffo_pancake", want: true},
		{channel: " WAFFO_PANCAKE ", want: true},
		{channel: "mock", want: false},
		{channel: "alipay", want: false},
	}
	for _, tt := range tests {
		if got := supportedPaymentChannel(tt.channel); got != tt.want {
			t.Errorf("supportedPaymentChannel(%q) = %v, want %v", tt.channel, got, tt.want)
		}
	}
}
