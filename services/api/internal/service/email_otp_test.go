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

func TestVerifyRegistrationCodeTooManyAttempts(t *testing.T) {
	ctx := context.Background()
	const email = "newbie@example.com"
	c := newFakeTempCache()
	svc := &EmailOTPService{cache: c}
	// Seed the correct code.
	if err := c.SetTemp(ctx, registerCodeKey(email), "123456", 10*time.Minute); err != nil {
		t.Fatal(err)
	}

	// Four wrong guesses should each return ErrInvalidEmailCode and leave the
	// code intact so the correct code still works.
	for i := 0; i < 4; i++ {
		err := svc.VerifyRegistrationCode(ctx, email, "000000")
		if !errors.Is(err, ErrInvalidEmailCode) {
			t.Fatalf("attempt %d: err=%v want ErrInvalidEmailCode", i+1, err)
		}
	}
	// Code key must still be present after 4 wrong attempts.
	if _, ok := c.GetTemp(ctx, registerCodeKey(email)); !ok {
		t.Fatal("code key must survive 4 wrong guesses")
	}
	// Fails counter should be at "4".
	if raw, ok := c.GetTemp(ctx, registerFailsKey(email)); !ok || raw != "4" {
		t.Fatalf("fails counter after 4 wrong guesses = %q (ok=%v) want \"4\"", raw, ok)
	}
	// Correct code still verifies on the 5th try (attempts 1-4 were wrong).
	if err := svc.VerifyRegistrationCode(ctx, email, "123456"); err != nil {
		t.Fatalf("correct code must still verify after 4 wrong guesses: %v", err)
	}

	// Reset: issue the code again and exhaust all 5 attempts.
	c = newFakeTempCache()
	svc = &EmailOTPService{cache: c}
	if err := c.SetTemp(ctx, registerCodeKey(email), "123456", 10*time.Minute); err != nil {
		t.Fatal(err)
	}
	var finalErr error
	for i := 0; i < 5; i++ {
		finalErr = svc.VerifyRegistrationCode(ctx, email, "000000")
	}
	if !errors.Is(finalErr, ErrEmailCodeTooManyAttempts) {
		t.Fatalf("5th wrong guess err=%v want ErrEmailCodeTooManyAttempts", finalErr)
	}
	// After lockout, even the correct code is rejected (key was deleted).
	err := svc.VerifyRegistrationCode(ctx, email, "123456")
	if !errors.Is(err, ErrInvalidEmailCode) {
		t.Fatalf("correct code after lockout err=%v want ErrInvalidEmailCode", err)
	}
	// Fails counter must also be gone.
	if _, ok := c.GetTemp(ctx, registerFailsKey(email)); ok {
		t.Fatal("fails counter must be deleted after lockout")
	}
}

func TestConsumeRegistrationCode(t *testing.T) {
	ctx := context.Background()
	const email = "newbie@example.com"
	c := newFakeTempCache()
	svc := &EmailOTPService{cache: c}
	// Deleting an absent key is a no-op.
	svc.ConsumeRegistrationCode(ctx, email)
	if err := c.SetTemp(ctx, registerCodeKey(email), "123456", time.Minute); err != nil {
		t.Fatal(err)
	}
	// Also seed a fails counter to verify Consume clears it.
	if err := c.SetTemp(ctx, registerFailsKey(email), "2", time.Minute); err != nil {
		t.Fatal(err)
	}
	svc.ConsumeRegistrationCode(ctx, email)
	if _, present := c.GetTemp(ctx, registerCodeKey(email)); present {
		t.Fatal("ConsumeRegistrationCode must delete the registration code")
	}
	if _, present := c.GetTemp(ctx, registerFailsKey(email)); present {
		t.Fatal("ConsumeRegistrationCode must delete the fails counter")
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

func TestIssueRegistrationCodeResetsFailures(t *testing.T) {
	ctx := context.Background()
	const email = "newbie@example.com"
	c := newFakeTempCache()
	if err := c.SetTemp(ctx, registerFailsKey(email), "4", time.Minute); err != nil {
		t.Fatal(err)
	}
	svc := &EmailOTPService{cache: c}
	code, err := svc.issueRegistrationCode(ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Fatalf("code length=%d want 6", len(code))
	}
	if _, present := c.GetTemp(ctx, registerFailsKey(email)); present {
		t.Fatal("issuing a fresh code must reset the failed-attempt counter")
	}
	stored, ok := c.GetTemp(ctx, registerCodeKey(email))
	if !ok || stored != code {
		t.Fatal("issued code must be stored under the register key")
	}
}
