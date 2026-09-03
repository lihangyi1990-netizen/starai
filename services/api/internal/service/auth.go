package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/middleware"
	"github.com/starai/api/internal/util"
	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidCredentials = errors.New("invalid credentials")
var ErrUserExists = errors.New("user already exists")
var ErrInvalidEmail = errors.New("invalid email")
var ErrWeakPassword = errors.New("weak password")

// Registration accepts an address without sending a verification code, so these
// bounds are the only thing standing between the endpoint and junk rows.
const (
	// auth_identities.identifier is varchar(255); reject before the driver does
	// so the caller gets a readable message instead of a 500.
	maxIdentifierLen = 255
	minPasswordLen   = 6
	// bcrypt silently truncates beyond 72 bytes, which would make a longer
	// password compare equal to its 72-byte prefix. Reject instead.
	maxPasswordLen = 72
)

// validateEmailPassword guards the no-verification-code registration path.
// Deliberately permissive on the address shape — this is a spam/typo guard, not
// an RFC 5322 parser, and the address is never mailed during signup.
func validateEmailPassword(email, password string) error {
	if email == "" || len(email) > maxIdentifierLen {
		return ErrInvalidEmail
	}
	at := strings.IndexByte(email, '@')
	// Require something before the @ and a dotted domain after it.
	if at <= 0 || at == len(email)-1 {
		return ErrInvalidEmail
	}
	domain := email[at+1:]
	if strings.Contains(domain, "@") || !strings.Contains(domain, ".") ||
		strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") {
		return ErrInvalidEmail
	}
	if strings.ContainsAny(email, " \t\r\n") {
		return ErrInvalidEmail
	}
	if len(password) < minPasswordLen || len(password) > maxPasswordLen {
		return ErrWeakPassword
	}
	return nil
}

type AuthService struct {
	db        *pgxpool.Pool
	billing   *billing.Service
	jwtSecret string
}

// IsUserActive is used by the request middleware to honor an administrator's
// freeze/ban action immediately, including for sessions issued before the
// status change.
func (s *AuthService) IsUserActive(ctx context.Context, userID int64) (bool, error) {
	if s == nil || s.db == nil || userID <= 0 {
		return false, errors.New("无法验证用户状态")
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(status,'active') FROM users WHERE id=$1`, userID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(status), "active"), nil
}

func NewAuthService(db *pgxpool.Pool, billing *billing.Service, jwtSecret string) *AuthService {
	return &AuthService{db: db, billing: billing, jwtSecret: jwtSecret}
}

type AuthResult struct {
	Token string      `json:"token"`
	User  UserProfile `json:"user"`
}

type UserProfile struct {
	PublicID       string  `json:"public_id"`
	Email          string  `json:"email,omitempty"`
	AuthProvider   string  `json:"auth_provider,omitempty"`
	Nickname       string  `json:"nickname"`
	Avatar         *string `json:"avatar_url,omitempty"`
	Level          string  `json:"user_level"`
	MemberLevelID  int64   `json:"member_level_id,omitempty"`
	MemberLevel    string  `json:"member_level,omitempty"`
	ReferralCode   string  `json:"referral_code,omitempty"`
	ReferrerID     *int64  `json:"referrer_id,omitempty"`
	ReferrerPublic *string `json:"referrer_public_id,omitempty"`
	Locale         string  `json:"locale"`
}

func (s *AuthService) Register(ctx context.Context, email, password, nickname, referralCode string) (*AuthResult, error) {
	email = normalizeEmail(email)
	if err := validateEmailPassword(email, password); err != nil {
		return nil, err
	}
	var exists int
	err := s.db.QueryRow(ctx, `SELECT 1 FROM auth_identities WHERE provider='email' AND LOWER(identifier)=LOWER($1)`, email).Scan(&exists)
	if err == nil {
		return nil, ErrUserExists
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return nil, err
	}
	if nickname == "" {
		nickname = email
	}
	// users.nickname is varchar(64), and an email may be longer than that. Cut on
	// a rune boundary so a multi-byte nickname cannot be sliced mid-character.
	if r := []rune(nickname); len(r) > 64 {
		nickname = string(r[:64])
	}
	publicID := util.NewPublicID("usr")
	referral, err := s.NewReferralCode(ctx)
	if err != nil {
		return nil, err
	}
	referrerID, err := s.ResolveReferrer(ctx, referralCode)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var userID, memberLevelID int64
	err = tx.QueryRow(ctx,
		`INSERT INTO users (public_id, nickname, referral_code, referrer_id, member_level_id, user_level)
		 VALUES ($1,$2,$3,$4,(SELECT id FROM member_levels WHERE is_default=true LIMIT 1),'normal') RETURNING id, member_level_id`,
		publicID, nickname, referral, referrerID,
	).Scan(&userID, &memberLevelID)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO auth_identities (user_id, provider, identifier, credential_hash, verified) VALUES ($1,'email',$2,$3,true)`,
		userID, email, string(hash))
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO wallets (user_id) VALUES ($1)`, userID)
	if err != nil {
		return nil, err
	}
	if err = s.grantSignupBonusTx(ctx, tx, userID); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.issueToken(userID, publicID, nickname, nil, "normal", "普通会员", memberLevelID, referral, referrerID, nil, "zh-CN")
}

func (s *AuthService) grantSignupBonusTx(ctx context.Context, tx pgx.Tx, userID int64) error {
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='signup_bonus'`).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	var bonus float64
	if json.Unmarshal(raw, &bonus) != nil || bonus <= 0 {
		return nil
	}
	var balance float64
	if err := tx.QueryRow(ctx, `SELECT compute_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance); err != nil {
		return err
	}
	newBalance := balance + bonus
	if _, err := tx.Exec(ctx, `UPDATE wallets SET compute_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		VALUES ($1,'signup_bonus','in',$2,$3,'user',$4,'注册赠送算力')`,
		userID, bonus, newBalance, fmt.Sprintf("%d", userID))
	return err
}

func (s *AuthService) LoginPassword(ctx context.Context, email, password string) (*AuthResult, error) {
	email = normalizeEmail(email)
	var userID int64
	var publicID, nickname, level, memberLevel, referralCode, locale string
	var memberLevelID int64
	var referrerID *int64
	var referrerPublic *string
	var avatar *string
	var hashPtr *string
	err := s.db.QueryRow(ctx, `
		SELECT u.id, u.public_id, u.nickname, u.avatar_url, u.user_level,
		       COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.public_id,
		       u.locale, a.credential_hash
		FROM auth_identities a JOIN users u ON u.id = a.user_id
		LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		LEFT JOIN users ru ON ru.id = u.referrer_id
		WHERE a.provider='email' AND LOWER(a.identifier)=LOWER($1) AND u.status='active'`, email,
	).Scan(&userID, &publicID, &nickname, &avatar, &level, &memberLevelID, &memberLevel, &referralCode, &referrerID, &referrerPublic, &locale, &hashPtr)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if hashPtr == nil || *hashPtr == "" {
		return nil, errors.New("该账号尚未设置密码，请使用邮箱验证码登录")
	}
	hash := *hashPtr
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	return s.issueToken(userID, publicID, nickname, avatar, level, memberLevel, memberLevelID, referralCode, referrerID, referrerPublic, locale)
}

func (s *AuthService) issueToken(userID int64, publicID, nickname string, avatar *string, level, memberLevel string, memberLevelID int64, referralCode string, referrerID *int64, referrerPublic *string, locale string) (*AuthResult, error) {
	claims := middleware.UserClaims{
		UserID:   userID,
		PublicID: publicID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(72 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(s.jwtSecret))
	if err != nil {
		return nil, err
	}
	return &AuthResult{
		Token: signed,
		User: UserProfile{
			PublicID:       publicID,
			Nickname:       nickname,
			Avatar:         avatar,
			Level:          level,
			MemberLevelID:  memberLevelID,
			MemberLevel:    memberLevel,
			ReferralCode:   referralCode,
			ReferrerID:     referrerID,
			ReferrerPublic: referrerPublic,
			Locale:         locale,
		},
	}, nil
}

func (s *AuthService) NewReferralCode(ctx context.Context) (string, error) {
	const (
		minCode     = 100000
		codeSpan    = 900000
		maxAttempts = 20
	)
	for i := 0; i < maxAttempts; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(codeSpan))
		if err != nil {
			return "", err
		}
		code := fmt.Sprintf("%06d", n.Int64()+minCode)
		var exists int
		err = s.db.QueryRow(ctx, `SELECT 1 FROM users WHERE referral_code=$1`, code).Scan(&exists)
		if errors.Is(err, pgx.ErrNoRows) {
			return code, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", errors.New("生成随机推荐码失败，请重试")
}

func (s *AuthService) ResolveReferrer(ctx context.Context, referralCode string) (*int64, error) {
	code := strings.TrimSpace(referralCode)
	if code == "" {
		return nil, nil
	}
	var id int64
	err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE referral_code=$1 AND status='active'`, code).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("推荐码无效")
		}
		return nil, err
	}
	return &id, nil
}

type UpdateProfileInput struct {
	Nickname *string `json:"nickname"`
	Avatar   *string `json:"avatar_url"`
	Locale   *string `json:"locale"`
}

func (s *AuthService) UpdateProfile(ctx context.Context, userID int64, input UpdateProfileInput) (*UserProfile, error) {
	if input.Nickname != nil {
		nickname := strings.TrimSpace(*input.Nickname)
		if nickname == "" {
			return nil, errors.New("昵称不能为空")
		}
		if len([]rune(nickname)) > 64 {
			return nil, errors.New("昵称不能超过 64 个字符")
		}
		if _, err := s.db.Exec(ctx, `UPDATE users SET nickname=$1, updated_at=now() WHERE id=$2`, nickname, userID); err != nil {
			return nil, err
		}
	}
	if input.Avatar != nil {
		if _, err := s.db.Exec(ctx, `UPDATE users SET avatar_url=$1, updated_at=now() WHERE id=$2`, *input.Avatar, userID); err != nil {
			return nil, err
		}
	}
	if input.Locale != nil {
		locale := strings.TrimSpace(*input.Locale)
		if len(locale) > 16 {
			return nil, errors.New("语言代码无效")
		}
		if _, err := s.db.Exec(ctx, `UPDATE users SET locale=$1, updated_at=now() WHERE id=$2`, locale, userID); err != nil {
			return nil, err
		}
	}
	return s.GetMe(ctx, userID)
}

func (s *AuthService) ChangePassword(ctx context.Context, userID int64, oldPassword, newPassword string) error {
	if len(newPassword) < 6 {
		return errors.New("新密码至少 6 位")
	}
	var hash string
	err := s.db.QueryRow(ctx,
		`SELECT credential_hash FROM auth_identities WHERE user_id=$1 AND provider='email'`, userID,
	).Scan(&hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("该账号未设置密码")
		}
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(oldPassword)) != nil {
		return errors.New("原密码错误")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 10)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx,
		`UPDATE auth_identities SET credential_hash=$1 WHERE user_id=$2 AND provider='email'`,
		string(newHash), userID)
	return err
}

func (s *AuthService) GetMe(ctx context.Context, userID int64) (*UserProfile, error) {
	var p UserProfile
	var avatar *string
	err := s.db.QueryRow(ctx,
		`SELECT u.public_id, u.nickname, u.avatar_url, u.user_level,
		        COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.public_id, u.locale
		 FROM users u
		 LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		 LEFT JOIN users ru ON ru.id = u.referrer_id
		 WHERE u.id=$1`, userID,
	).Scan(&p.PublicID, &p.Nickname, &avatar, &p.Level, &p.MemberLevelID, &p.MemberLevel, &p.ReferralCode, &p.ReferrerID, &p.ReferrerPublic, &p.Locale)
	if err != nil {
		return nil, err
	}
	p.Avatar = avatar

	rows, err := s.db.Query(ctx, `SELECT provider, identifier FROM auth_identities WHERE user_id=$1 ORDER BY provider`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := map[string]bool{}
	for rows.Next() {
		var provider, identifier string
		if err := rows.Scan(&provider, &identifier); err != nil {
			return nil, err
		}
		providers[provider] = true
		if provider == "email" && p.Email == "" {
			p.Email = identifier
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	switch {
	case providers["google"]:
		p.AuthProvider = "google"
	case providers["github"]:
		p.AuthProvider = "github"
	default:
		p.AuthProvider = "email"
	}
	return &p, nil
}

type AdminAuthResult struct {
	Token string `json:"token"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

// AdminIdentity is the server-side link between a signed-in Tuna user and an
// active administrator account. The link is an explicit foreign-key relation
// managed by administrators; it does not rely on a mutable email/profile
// value matching by accident.
type AdminIdentity struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

var ErrAdminNotLinked = errors.New("当前用户不是有效的管理员账号")

// AdminForUser returns the active admin account explicitly linked to the Tuna
// user. A nullable link keeps existing administrator accounts independent until
// an operator deliberately associates one.
func (s *AuthService) AdminForUser(ctx context.Context, userID int64) (*AdminIdentity, error) {
	if userID <= 0 {
		return nil, ErrAdminNotLinked
	}
	var identity AdminIdentity
	err := s.db.QueryRow(ctx, `
		SELECT a.id, a.email, r.name
		FROM admin_users a
		JOIN admin_roles r ON r.id=a.role_id
		WHERE a.user_id=$1 AND a.status='active'
		ORDER BY a.id
		LIMIT 1`, userID).Scan(&identity.ID, &identity.Email, &identity.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAdminNotLinked
	}
	if err != nil {
		return nil, err
	}
	return &identity, nil
}

// IssueAdminTokenForID re-reads the administrator row before issuing a
// session.  This prevents a handoff created before a role/status change from
// becoming a stale elevated session.
func (s *AuthService) IssueAdminTokenForID(ctx context.Context, adminID int64, adminJWT string) (*AdminAuthResult, error) {
	var email, role, status string
	err := s.db.QueryRow(ctx, `
		SELECT a.email, r.name, a.status
		FROM admin_users a JOIN admin_roles r ON r.id=a.role_id
		WHERE a.id=$1`, adminID).Scan(&email, &role, &status)
	if errors.Is(err, pgx.ErrNoRows) || status != "active" {
		return nil, ErrAdminNotLinked
	}
	if err != nil {
		return nil, err
	}
	return s.issueAdminToken(adminID, email, role, adminJWT)
}

func (s *AuthService) issueAdminToken(adminID int64, email, role, adminJWT string) (*AdminAuthResult, error) {
	claims := middleware.AdminClaims{
		AdminID: adminID,
		Email:   email,
		Role:    role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(adminJWT))
	if err != nil {
		return nil, err
	}
	return &AdminAuthResult{Token: signed, Email: email, Role: role}, nil
}

func (s *AuthService) AdminLogin(ctx context.Context, email, password, adminJWT string) (*AdminAuthResult, error) {
	identity, err := s.AuthenticateAdmin(ctx, email, password)
	if err != nil {
		return nil, err
	}
	return s.issueAdminToken(identity.ID, identity.Email, identity.Role, adminJWT)
}

// AuthenticateAdmin verifies an active administrator without issuing a JWT.
// The web login flow uses this to create a short-lived handoff code; keeping
// token issuance separate ensures an admin JWT never enters the browser's
// JavaScript-visible response from the public login endpoint.
func (s *AuthService) AuthenticateAdmin(ctx context.Context, email, password string) (*AdminIdentity, error) {
	email = normalizeEmail(email)
	var identity AdminIdentity
	var hash string
	err := s.db.QueryRow(ctx, `
		SELECT a.id, a.email, r.name, a.password_hash
		FROM admin_users a JOIN admin_roles r ON r.id = a.role_id
		WHERE a.email=$1 AND a.status='active'`, email,
	).Scan(&identity.ID, &identity.Email, &identity.Role, &hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	return &identity, nil
}

func normalizeEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}
