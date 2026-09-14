package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeTempCache is an in-memory TempCache for code-issuance tests; no database
// or redis is required, matching the package's existing test style.
type fakeTempCache struct {
	mu     sync.Mutex
	values map[string]string
}

func newFakeTempCache() *fakeTempCache {
	return &fakeTempCache{values: map[string]string{}}
}

func (f *fakeTempCache) SetTemp(_ context.Context, key, value string, _ time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.values[key] = value
	return nil
}

func (f *fakeTempCache) GetTemp(_ context.Context, key string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.values[key]
	return v, ok
}

func (f *fakeTempCache) DelTemp(_ context.Context, key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.values, key)
}

func TestVerifyRegistrationCode(t *testing.T) {
	ctx := context.Background()
	const email = "newbie@example.com"
	key := "email_otp:register:" + email

	tests := []struct {
		name    string
		email   string
		code    string
		seed    bool
		wantErr error
	}{{
		name: "malformed email", email: "not-an-email", code: "123456", wantErr: ErrInvalidEmailCode,
	}, {
		name: "code too short", email: email, code: "1234", wantErr: ErrInvalidEmailCode,
	}, {
		name: "code never sent", email: email, code: "123456", wantErr: ErrInvalidEmailCode,
	}, {
		name: "wrong code is rejected without consuming", email: email, code: "000000", seed: true, wantErr: ErrInvalidEmailCode,
	}, {
		name: "correct code passes without consuming yet", email: email, code: "123456", seed: true,
	}}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newFakeTempCache()
			if tt.seed {
				if err := c.SetTemp(ctx, key, "123456", time.Minute); err != nil {
					t.Fatal(err)
				}
			}
			svc := &EmailOTPService{cache: c}
			err := svc.VerifyRegistrationCode(ctx, tt.email, tt.code)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("VerifyRegistrationCode() err=%v want %v", err, tt.wantErr)
			}
			// Verify never consumes the code: a failed later insert lets the
			// user retry with the same code; consumption is Register's job,
			// after the account row is committed.
			_, present := c.GetTemp(ctx, key)
			if tt.seed && !present {
				t.Fatal("VerifyRegistrationCode must not delete the code")
			}
		})
	}
}

func TestConsumeRegistrationCode(t *testing.T) {
	ctx := context.Background()
	const email = "newbie@example.com"
	key := "email_otp:register:" + email
	c := newFakeTempCache()
	svc := &EmailOTPService{cache: c}
	// Deleting an absent key is a no-op.
	svc.ConsumeRegistrationCode(ctx, email)
	if err := c.SetTemp(ctx, key, "123456", time.Minute); err != nil {
		t.Fatal(err)
	}
	svc.ConsumeRegistrationCode(ctx, email)
	if _, present := c.GetTemp(ctx, key); present {
		t.Fatal("ConsumeRegistrationCode must delete the registration code")
	}
}

func TestEvaluateRegisterSend(t *testing.T) {
	dbErr := errors.New("db unavailable")
	tests := []struct {
		name        string
		exists      bool
		existsErr   error
		cooldown    bool
		wantErr     bool
		wantMessage string
	}{{
		name: "fresh address, no cooldown", wantErr: false,
	}, {
		name: "already registered", exists: true, wantErr: true, wantMessage: "该邮箱已注册",
	}, {
		name: "cooldown active", cooldown: true, wantErr: true, wantMessage: "发送过于频繁",
	}, {
		name: "registered beats cooldown", exists: true, cooldown: true, wantErr: true, wantMessage: "该邮箱已注册",
	}, {
		name: "lookup error beats everything", exists: true, existsErr: dbErr, cooldown: true, wantErr: true, wantMessage: "db unavailable",
	}}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := evaluateRegisterSend(tt.exists, tt.existsErr, tt.cooldown)
			if (err != nil) != tt.wantErr {
				t.Fatalf("evaluateRegisterSend() err=%v wantErr=%v", err, tt.wantErr)
			}
			if err != nil && !strings.Contains(err.Error(), tt.wantMessage) {
				t.Fatalf("err message=%q want substring %q", err.Error(), tt.wantMessage)
			}
		})
	}
}
