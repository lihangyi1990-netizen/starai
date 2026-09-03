package handler

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/starai/api/internal/config"
)

func cookieContext(t *testing.T, method, target, remoteAddr, forwardedProto string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, target, nil)
	request.RemoteAddr = remoteAddr
	if forwardedProto != "" {
		request.Header.Set("X-Forwarded-Proto", forwardedProto)
	}
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = request
	return ctx, recorder
}

func TestRequestUsesHTTPS(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name           string
		requestTarget  string
		remoteAddr     string
		forwardedProto string
		trusted        string
		want           bool
	}{
		{name: "plain HTTP production does not force secure", requestTarget: "http://example.test/login", remoteAddr: "198.51.100.20:1234", trusted: "127.0.0.1", want: false},
		{name: "native TLS", requestTarget: "https://example.test/login", remoteAddr: "198.51.100.20:1234", trusted: "127.0.0.1", want: true},
		{name: "trusted proxy HTTPS", requestTarget: "http://api.internal/login", remoteAddr: "127.0.0.1:1234", forwardedProto: "https", trusted: "127.0.0.1", want: true},
		{name: "trusted proxy CIDR HTTPS", requestTarget: "http://api.internal/login", remoteAddr: "10.10.2.8:1234", forwardedProto: "https,http", trusted: "10.10.0.0/16", want: true},
		{name: "untrusted proxy cannot force HTTPS", requestTarget: "http://api.internal/login", remoteAddr: "198.51.100.20:1234", forwardedProto: "https", trusted: "127.0.0.1", want: false},
		{name: "forwarded HTTP", requestTarget: "http://api.internal/login", remoteAddr: "127.0.0.1:1234", forwardedProto: "http", trusted: "127.0.0.1", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, _ := cookieContext(t, "GET", tt.requestTarget, tt.remoteAddr, tt.forwardedProto)
			h := &Handler{cfg: &config.Config{AppEnv: "production", TrustedProxies: tt.trusted}}
			if got := h.requestUsesHTTPS(ctx); got != tt.want {
				t.Fatalf("requestUsesHTTPS() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSessionCookieSecureAttributeMatchesRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{cfg: &config.Config{AppEnv: "production", TrustedProxies: "127.0.0.1"}}

	t.Run("HTTP cookie is usable by HTTP browser", func(t *testing.T) {
		ctx, recorder := cookieContext(t, "GET", "http://example.test/login", "198.51.100.20:1234", "")
		h.setSessionCookie(ctx, "starai_session", "session-token", 3600)
		cookie := recorder.Header().Get("Set-Cookie")
		if strings.Contains(cookie, "; Secure") {
			t.Fatalf("HTTP cookie unexpectedly marked Secure: %q", cookie)
		}
		if !strings.Contains(cookie, "HttpOnly") || !strings.Contains(cookie, "SameSite=Lax") {
			t.Fatalf("cookie missing required attributes: %q", cookie)
		}
	})

	t.Run("trusted HTTPS proxy cookie is Secure", func(t *testing.T) {
		ctx, recorder := cookieContext(t, "GET", "http://api.internal/login", "127.0.0.1:1234", "https")
		h.setSessionCookie(ctx, "starai_session", "session-token", 3600)
		cookie := recorder.Header().Get("Set-Cookie")
		if !strings.Contains(cookie, "; Secure") {
			t.Fatalf("HTTPS proxy cookie is not Secure: %q", cookie)
		}
	})

	t.Run("clear uses same security mode", func(t *testing.T) {
		ctx, recorder := cookieContext(t, "GET", "http://example.test/logout", "198.51.100.20:1234", "")
		h.clearSessionCookie(ctx, "starai_session")
		cookie := recorder.Header().Get("Set-Cookie")
		if strings.Contains(cookie, "; Secure") {
			t.Fatalf("HTTP clearing cookie unexpectedly marked Secure: %q", cookie)
		}
		if !strings.Contains(cookie, "Max-Age=0") {
			t.Fatalf("clearing cookie missing Max-Age=0: %q", cookie)
		}
	})
}
