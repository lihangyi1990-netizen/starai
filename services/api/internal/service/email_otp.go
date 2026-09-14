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
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/starai/api/internal/mailer"
)

var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// ErrInvalidEmailCode marks a registration code that is missing, malformed,
// expired or mismatched, so handlers can answer 400 instead of a 500.
var ErrInvalidEmailCode = errors.New("邮箱验证码错误或已过期")

// TempCache is the subset of cache.Client the OTP service needs; keeping it as
// an interface lets tests substitute an in-memory store.
type TempCache interface {
	SetTemp(ctx context.Context, key, value string, ttl time.Duration) error
	GetTemp(ctx context.Context, key string) (string, bool)
	DelTemp(ctx context.Context, key string)
}

type EmailOTPService struct {
	auth    *AuthService
	captcha *CaptchaService
	cache   TempCache
	mailer  *mailer.Service
}

func NewEmailOTPService(auth *AuthService, captcha *CaptchaService, cacheClient TempCache, mailerSvc *mailer.Service) *EmailOTPService {
	return &EmailOTPService{auth: auth, captcha: captcha, cache: cacheClient, mailer: mailerSvc}
}

type SendEmailCodeResult struct {
	Sent      bool   `json:"sent"`
	DebugCode string `json:"debug_code,omitempty"`
	Message   string `json:"message"`
}

// SendCode issues a registration code. Email codes only exist to prove
// ownership of an address at signup — login itself is password-only — so an
// already-registered address is rejected instead of being sent another code.
func (s *EmailOTPService) SendCode(ctx context.Context, email, captchaID, captchaCode string, captchaRequired bool) (*SendEmailCodeResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if !emailRe.MatchString(email) {
		return nil, errors.New("邮箱格式不正确")
	}
	if captchaRequired && !s.captcha.Verify(ctx, captchaID, captchaCode) {
		return nil, errors.New("图形验证码错误或已过期")
	}
	exists, err := s.emailExists(ctx, email)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, errors.New("该邮箱已注册，请直接登录")
	}
	// Rate limit: 60s between sends per email.
	if v, ok := s.cache.GetTemp(ctx, "email_otp_cooldown:"+email); ok && v != "" {
		return nil, errors.New("发送过于频繁，请稍后再试")
	}
	code := randomDigits(6)
	if err := s.cache.SetTemp(ctx, "email_otp:register:"+email, code, 10*time.Minute); err != nil {
		return nil, err
	}
	_ = s.cache.SetTemp(ctx, "email_otp_cooldown:"+email, "1", 60*time.Second)

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
// only after this succeeds.
func (s *EmailOTPService) VerifyRegistrationCode(ctx context.Context, email, code string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	code = strings.TrimSpace(code)
	if !emailRe.MatchString(email) || len(code) != 6 {
		return ErrInvalidEmailCode
	}
	stored, ok := s.cache.GetTemp(ctx, "email_otp:register:"+email)
	if !ok || stored != code {
		return ErrInvalidEmailCode
	}
	s.cache.DelTemp(ctx, "email_otp:register:"+email)
	return nil
}

func randomDigits(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		d, _ := rand.Int(rand.Reader, big.NewInt(10))
		b.WriteString(fmt.Sprintf("%d", d.Int64()))
	}
	return b.String()
}
