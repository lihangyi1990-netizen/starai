package service

import "testing"

func TestNormalizeStoredApiTokenScopes(t *testing.T) {
	tests := []struct {
		name        string
		productCode string
		scopes      []string
		want        []string
		wantErr     bool
	}{
		{
			name:        "legacy all product defaults to wildcard",
			productCode: "pico-all",
			want:        []string{"*"},
		},
		{
			name:        "blank product keeps legacy all behavior",
			productCode: "",
			want:        []string{"*"},
		},
		{
			name:        "empty vendor scopes fail closed",
			productCode: "pico-openai",
			wantErr:     true,
		},
		{
			name:        "vendor scopes are exact and deduplicated",
			productCode: "pico-openai",
			scopes:      []string{" gpt-5.6 ", "gpt-5.6", ""},
			want:        []string{"gpt-5.6"},
		},
		{
			name:        "vendor wildcard is rejected",
			productCode: "pico-openai",
			scopes:      []string{"gpt-*"},
			wantErr:     true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeStoredApiTokenScopes(tc.productCode, tc.scopes)
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
