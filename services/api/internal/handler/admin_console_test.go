package handler

import "testing"

func TestSafeSub2APIAdminURL(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "local root", in: " http://localhost:8181/ ", want: "http://localhost:8181"},
		{name: "console path", in: "https://gateway.example.test/admin///", want: "https://gateway.example.test/admin"},
		{name: "reject credentials", in: "https://admin:secret@gateway.example.test", want: ""},
		{name: "reject query", in: "https://gateway.example.test/?next=/admin", want: ""},
		{name: "reject fragment", in: "https://gateway.example.test/#admin", want: ""},
		{name: "reject scheme", in: "javascript:alert(1)", want: ""},
		{name: "reject relative", in: "/admin", want: ""},
		{name: "reject empty", in: "", want: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := safeSub2APIAdminURL(tc.in); got != tc.want {
				t.Fatalf("safeSub2APIAdminURL(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
