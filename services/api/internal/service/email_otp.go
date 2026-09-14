package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/starai/api/internal/mailer"
)

var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// ErrInvalidEmailCode marks a registration code that is missing, malformed,
// expired or mismatched, so handlers can answer 400 instead of a 500.
var ErrInvalidEmailCode = errors.New("邮箱验证码错误或已过期")

// ErrEmailCodeTooManyAttempts marks a registration code invalidated by repeated
// wrong guesses; the registrant must request a fresh one.
var ErrEmailCodeTooManyAttempts = errors.New("验证码错误次数过多，请重新获取验证码")

func registerCodeKey(email string) string     { return "email_otp:register:" + email }
func registerFailsKey(email string) string    { return "email_otp:register:fails:" + email }
func registerCooldownKey(email string) string { return "email_otp_cooldown:register:" + email }

// TempCache is the subset of cache.Client the OTP service needs; keeping it as
// an interface lets tests substitute an in-memory store.
type TempCache interface {
	SetTemp(ctx context.Context, key, value string, ttl time.Duration) error
	GetTemp(ctx context.Context, key string) (string, bool)
	DelTemp(ctx context.Context, key string)
}

type EmailOTPService struct {
	auth   *AuthService
	cache  TempCache
	mailer *mailer.Service
}

func NewEmailOTPService(auth *AuthService, cacheClient TempCache, mailerSvc *mailer.Service) *EmailOTPService {
	return &EmailOTPService{auth: auth, cache: cacheClient, mailer: mailerSvc}
}

type SendEmailCodeResult struct {
	Sent      bool   `json:"sent"`
	DebugCode string `json:"debug_code,omitempty"`
	Message   string `json:"message"`
}

// SendCode issues a registration code. Email codes only exist to prove
// ownership of an address at signup — login itself is password-only — so an
// already-registered address is rejected instead of being sent another code.
func (s *EmailOTPService) SendCode(ctx context.Context, email string) (*SendEmailCodeResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if !emailRe.MatchString(email) {
		return nil, errors.New("邮箱格式不正确")
	}
	exists, err := s.emailExists(ctx, email)
	cooldown := false
	if v, ok := s.cache.GetTemp(ctx, registerCooldownKey(email)); ok && v != "" {
		cooldown = true
	}
	// Pure policy call: lookup failure must not silently allow sending, an
	// already-registered address never gets a code, and the per-address
	// cooldown is checked last so it never masks the other rejections.
	if err := evaluateRegisterSend(exists, err, cooldown); err != nil {
		return nil, err
	}
	code := randomDigits(6)
	if err := s.cache.SetTemp(ctx, registerCodeKey(email), code, 10*time.Minute); err != nil {
		return nil, err
	}
	_ = s.cache.SetTemp(ctx, registerCooldownKey(email), "1", 60*time.Second)

	mailCfg := s.mailer.LoadConfig(ctx)
	debug := s.mailer.IsDebugOTP(ctx) || os.Getenv("EMAIL_OTP_DEBUG") == "true" || os.Getenv("APP_ENV") == "development"
	res := &SendEmailCodeResult{Sent: true, Message: "验证码已发送，请查收邮箱"}

	if mailCfg.Enabled {
		siteName := s.siteName(ctx)
		subject := fmt.Sprintf("%s 注册验证码", siteName)
		body := fmt.Sprintf("您好！\n\n您正在注册 %s，注册验证码是：%s\n有效期 10 分钟，请勿泄露给他人。如非本人操作请忽略此邮件。\n\n— %s", siteName, code, siteName)
		if err := s.mailer.Send(ctx, mailCfg, email, subject, body); err != nil {
			log.Printf("[email_otp] mail send failed provider=%s to=%s err=%v", mailCfg.Provider, email, err)
			if !debug {
				return nil, fmt.Errorf("邮件发送失败：%v", err)
			}
		}
	} else if !debug {
		return nil, errors.New("邮件服务未启用，请在后台「系统配置」中配置 SMTP 或 Resend，或开启「验证码调试模式」")
	}

	log.Printf("[email_otp] register to=%s code=%s provider=%s enabled=%v debug=%v", email, code, mailCfg.Provider, mailCfg.Enabled, debug)
	if debug {
		res.DebugCode = code
		if !mailCfg.Enabled {
			res.Message = "验证码已生成（调试模式，邮件服务未启用）"
		}
	}
	return res, nil
}

func (s *EmailOTPService) siteName(ctx context.Context) string {
	var raw []byte
	if err := s.auth.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='site_name'`).Scan(&raw); err != nil {
		return "tuna"
	}
	var name string
	if json.Unmarshal(raw, &name) != nil || name == "" {
		return "tuna"
	}
	return name
}

func (s *EmailOTPService) emailExists(ctx context.Context, email string) (bool, error) {
	var exists int
	err := s.auth.db.QueryRow(ctx,
		`SELECT 1 FROM auth_identities WHERE provider='email' AND LOWER(identifier)=LOWER($1) LIMIT 1`,
		email).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// VerifyRegistrationCode validates a registration code without issuing a
// session or creating an account; the register path creates the account itself
// only after this succeeds. Wrong guesses increment a per-email failure
// counter; after five mismatches the code is invalidated and the caller must
// request a fresh one.
func (s *EmailOTPService) VerifyRegistrationCode(ctx context.Context, email, code string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	code = strings.TrimSpace(code)
	if !emailRe.MatchString(email) || len(code) != 6 {
		return ErrInvalidEmailCode
	}
	stored, ok := s.cache.GetTemp(ctx, registerCodeKey(email))
	if !ok {
		return ErrInvalidEmailCode
	}
	if stored != code {
		// Increment the failure counter.  On the fifth wrong guess, delete
		// both the code and the counter so even the correct code is rejected
		// until a fresh one is issued.
		failsKey := registerFailsKey(email)
		fails := 1
		if raw, ok := s.cache.GetTemp(ctx, failsKey); ok {
			if n, err := strconv.Atoi(raw); err == nil && n > 0 {
				fails = n + 1
			}
		}
		if fails >= 5 {
			s.cache.DelTemp(ctx, registerCodeKey(email))
			s.cache.DelTemp(ctx, failsKey)
			return ErrEmailCodeTooManyAttempts
		}
		_ = s.cache.SetTemp(ctx, failsKey, strconv.Itoa(fails), 10*time.Minute)
		return ErrInvalidEmailCode
	}
	return nil
}

// evaluateRegisterSend is the pre-issue policy for a registration code.
// exists/existsErr come from the auth_identities lookup; cooldownActive
// reports whether the 60-second per-address cooldown is present. It is a pure
// function so the rejection ordering can be table-tested without a database.
func evaluateRegisterSend(exists bool, existsErr error, cooldownActive bool) error {
	if existsErr != nil {
		return existsErr
	}
	if exists {
		return errors.New("该邮箱已注册，请直接登录")
	}
	if cooldownActive {
		return errors.New("发送过于频繁，请稍后再试")
	}
	return nil
}

// ConsumeRegistrationCode invalidates a registration code after the account
// has been created. Register calls it only after the insert tx commits, so a
// transient database failure never burns a code the user already received.
// Also clears the failure counter so a fresh registration for the same
// address (should it ever be needed) starts clean.
func (s *EmailOTPService) ConsumeRegistrationCode(ctx context.Context, email string) {
	s.cache.DelTemp(ctx, registerCodeKey(email))
	s.cache.DelTemp(ctx, registerFailsKey(email))
}

func randomDigits(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		d, _ := rand.Int(rand.Reader, big.NewInt(10))
		b.WriteString(fmt.Sprintf("%d", d.Int64()))
	}
	return b.String()
}
