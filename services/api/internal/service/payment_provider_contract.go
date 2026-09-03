package service

import "strings"

// PaymentProviderMatches reports whether a callback belongs to the provider
// currently selected in the payment configuration. It deliberately does not
// require payment_enabled: disabling new checkout sessions should not discard
// a payment that was already started and is still within its order lifetime.
//
// Keep provider-specific protocol validation in the provider adapter. In
// particular, this helper must not be used as a substitute for Pancake's
// signature verification or event validation.
func (c PaymentProviderConfig) PaymentProviderMatches(provider string) bool {
	want := strings.ToLower(strings.TrimSpace(provider))
	got := strings.ToLower(strings.TrimSpace(c.Provider))
	return want != "" && got == want
}
