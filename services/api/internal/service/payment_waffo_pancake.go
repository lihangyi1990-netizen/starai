package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	pancake "github.com/waffo-com/waffo-pancake-sdk-go"
)

const waffoPancakeProvider = "waffo_pancake"

var waffoPancakeShortIDPattern = regexp.MustCompile(`^[A-Z]{2,5}_[0-9A-Za-z]{22}$`)

const waffoPancakeMoneyTolerance = 0.000001

// createWaffoPancakeCheckout creates an authenticated hosted checkout. The
// local order number is sent as Pancake's merchant external id so a signed
// webhook can be mapped back without exposing any provider credentials.
func (s *PaymentService) createWaffoPancakeCheckout(ctx context.Context, cfg PaymentProviderConfig, orderNo string, userID int64, amount float64, expiresAt time.Time) (string, string, error) {
	client, err := s.newWaffoPancakeClient(cfg)
	if err != nil {
		return "", "", fmt.Errorf("build Waffo Pancake client: %w", err)
	}
	amountText, err := providerAmountString(amount, cfg.Currency)
	if err != nil {
		return "", "", err
	}
	taxCategory := strings.TrimSpace(cfg.WaffoPancakeTaxCategory)
	if taxCategory == "" {
		taxCategory = string(pancake.TaxCategorySaaS)
	}
	expiresIn := int(time.Until(expiresAt).Seconds())
	if expiresIn < 1 {
		expiresIn = 1
	}
	params := pancake.AuthenticatedCheckoutParams{
		CreateCheckoutSessionParams: pancake.CreateCheckoutSessionParams{
			ProductID:               strings.TrimSpace(cfg.WaffoPancakeProductID),
			Currency:                normalizeCurrency(cfg.Currency),
			PriceSnapshot:           &pancake.PriceInfo{Amount: amountText, TaxCategory: pancake.TaxCategory(taxCategory)},
			SuccessURL:              optionalWaffoURL(cfg.WaffoPancakeReturnURL, orderNo),
			ExpiresInSeconds:        pancake.Ptr(expiresIn),
			OrderMerchantExternalID: pancake.Ptr(orderNo),
		},
		BuyerIdentity: waffoPancakeBuyerIdentity(userID),
	}
	session, err := client.Checkout.Authenticated.Create(ctx, params)
	if err != nil {
		return "", "", fmt.Errorf("create Waffo Pancake checkout: %w", err)
	}
	if session == nil || strings.TrimSpace(session.SessionID) == "" || !validHTTPURL(session.CheckoutURL) {
		return "", "", errors.New("Waffo Pancake 返回的 Checkout Session 无效")
	}
	return session.CheckoutURL, session.SessionID, nil
}

func (s *PaymentService) newWaffoPancakeClient(cfg PaymentProviderConfig) (*pancake.Client, error) {
	keys := pancake.WebhookPublicKeys{
		Shared: strings.TrimSpace(cfg.WaffoPancakeWebhookPublicKey),
		Test:   strings.TrimSpace(cfg.WaffoPancakeWebhookTestKey),
		Prod:   strings.TrimSpace(cfg.WaffoPancakeWebhookProdKey),
	}
	clientCfg := pancake.Config{
		MerchantID:       strings.TrimSpace(cfg.WaffoPancakeMerchantID),
		PrivateKey:       cfg.WaffoPancakePrivateKey,
		HTTPClient:       s.httpClient,
		WebhookPublicKey: keys,
	}
	if strings.TrimSpace(s.waffoPancakeAPIBase) != "" {
		clientCfg.BaseURL = strings.TrimRight(strings.TrimSpace(s.waffoPancakeAPIBase), "/")
	}
	return pancake.New(clientCfg)
}

func optionalWaffoURL(template, orderNo string) *string {
	template = strings.TrimSpace(template)
	if template == "" {
		return nil
	}
	value := strings.ReplaceAll(template, "{order_no}", url.QueryEscape(orderNo))
	return &value
}

func waffoPancakeBuyerIdentity(userID int64) string {
	return fmt.Sprintf("pico-user-%d", userID)
}

// verifyWaffoPancakeWebhook performs all cryptographic and environment checks
// before any order lookup or wallet mutation. Keeping this boundary separate
// also makes it possible to exercise the security checks without a database.
func verifyWaffoPancakeWebhook(raw []byte, signature string, cfg PaymentProviderConfig, routeEnvironment string) (*pancake.TypedWebhookEvent[pancake.WebhookEventData], error) {
	if !cfg.WaffoPancakeWebhookReady() {
		return nil, errors.New("Waffo Pancake webhook 配置不完整")
	}
	routeEnvironment = strings.ToLower(strings.TrimSpace(routeEnvironment))
	configuredEnvironment := strings.ToLower(strings.TrimSpace(cfg.WaffoPancakeEnvironment))
	if routeEnvironment != "" && routeEnvironment != configuredEnvironment {
		return nil, errors.New("Waffo Pancake webhook 环境与当前支付渠道不一致")
	}
	var environment pancake.Environment
	switch routeEnvironment {
	case "":
		// The configured environment is authoritative for the unqualified
		// endpoint. Avoid SDK auto-detection here: a malformed or stale key for
		// the other environment must not prevent a valid event from verifying.
		environment = pancake.Environment(configuredEnvironment)
	case "test":
		environment = pancake.EnvironmentTest
	case "prod":
		environment = pancake.EnvironmentProd
	default:
		return nil, errors.New("Waffo Pancake webhook 环境无效")
	}
	keys := pancake.WebhookPublicKeys{
		Shared: cfg.WaffoPancakeWebhookPublicKey,
		Test:   cfg.WaffoPancakeWebhookTestKey,
		Prod:   cfg.WaffoPancakeWebhookProdKey,
	}
	verifyOpts := &pancake.VerifyWebhookOptions{Environment: environment}
	if !keys.IsZero() {
		verifyOpts.PublicKeys = &keys
	}
	event, err := pancake.VerifyWebhookTyped[pancake.WebhookEventData](string(raw), signature, verifyOpts)
	if err != nil {
		return nil, fmt.Errorf("Waffo Pancake webhook 验签失败: %w", err)
	}
	if event == nil {
		return nil, errors.New("Waffo Pancake webhook 事件为空")
	}
	eventEnvironment := strings.ToLower(strings.TrimSpace(string(event.Mode)))
	if eventEnvironment == "" || eventEnvironment != configuredEnvironment {
		return nil, errors.New("Waffo Pancake webhook 环境与当前支付渠道不一致")
	}
	if routeEnvironment != "" && eventEnvironment != routeEnvironment {
		return nil, errors.New("Waffo Pancake webhook 环境与回调地址不一致")
	}
	return event, nil
}

func validateWaffoPancakeCompletedEvent(event *pancake.TypedWebhookEvent[pancake.WebhookEventData], cfg PaymentProviderConfig) (pancake.WebhookEventData, error) {
	if event == nil {
		return pancake.WebhookEventData{}, errors.New("Waffo Pancake webhook 事件为空")
	}
	if strings.TrimSpace(event.StoreID) == "" || event.StoreID != strings.TrimSpace(cfg.WaffoPancakeStoreID) {
		return pancake.WebhookEventData{}, errors.New("Waffo Pancake webhook 商店与平台配置不一致")
	}
	data := event.Data
	if strings.TrimSpace(data.OrderID) == "" || data.OrderMerchantExternalID == nil || strings.TrimSpace(*data.OrderMerchantExternalID) == "" {
		return pancake.WebhookEventData{}, errors.New("Waffo Pancake webhook 缺少订单映射字段")
	}
	if data.OrderStatus != nil && !strings.EqualFold(strings.TrimSpace(*data.OrderStatus), "completed") {
		return pancake.WebhookEventData{}, errors.New("Waffo Pancake 订单状态未完成")
	}
	if data.PaymentStatus != nil && !strings.EqualFold(strings.TrimSpace(*data.PaymentStatus), "succeeded") {
		return pancake.WebhookEventData{}, errors.New("Waffo Pancake 付款状态未成功")
	}
	return data, nil
}

// CompleteWaffoPancakeWebhook verifies the provider's RSA signature and
// settles only order.completed events belonging to the configured store. The
// optional routeEnvironment is used by the separate /test and /prod webhook
// URLs to enforce the test/prod boundary before any wallet mutation.
func (s *PaymentService) CompleteWaffoPancakeWebhook(ctx context.Context, raw []byte, signature, routeEnvironment string) (*PaymentCompletion, bool, error) {
	cfg, err := s.ProviderConfig(ctx)
	if err != nil {
		return nil, false, err
	}
	event, err := verifyWaffoPancakeWebhook(raw, signature, cfg, routeEnvironment)
	if err != nil {
		return nil, false, err
	}
	if event.EventType != string(pancake.WebhookEventTypeOrderCompleted) {
		return nil, false, nil
	}
	data, err := validateWaffoPancakeCompletedEvent(event, cfg)
	if err != nil {
		return nil, false, err
	}
	orderNo := strings.TrimSpace(*data.OrderMerchantExternalID)
	userID, err := s.waffoPancakeOrderUser(ctx, orderNo)
	if err != nil {
		return nil, false, errors.New("Waffo Pancake 订单与平台订单不匹配")
	}
	if data.MerchantProvidedBuyerIdentity != nil {
		if got := strings.TrimSpace(*data.MerchantProvidedBuyerIdentity); got != "" && got != waffoPancakeBuyerIdentity(userID) {
			return nil, false, errors.New("Waffo Pancake 买家身份与平台订单不匹配")
		}
	}
	paidAmount, err := waffoPancakeCallbackAmount(data)
	if err != nil {
		return nil, false, err
	}
	paidCurrency := normalizeCurrency(data.Currency)
	if paidCurrency == "" {
		return nil, false, errors.New("Waffo Pancake webhook 币种无效")
	}
	digest := sha256.Sum256(raw)
	result, err := s.completeOrder(ctx, orderNo, waffoPancakeProvider, strings.TrimSpace(data.OrderID), paidAmount, paidCurrency, hex.EncodeToString(digest[:]))
	return result, true, err
}

func (s *PaymentService) waffoPancakeOrderUser(ctx context.Context, orderNo string) (int64, error) {
	var userID int64
	err := s.db.QueryRow(ctx, `SELECT user_id FROM orders WHERE order_no=$1 AND channel=$2`, orderNo, waffoPancakeProvider).Scan(&userID)
	return userID, err
}

// Waffo sends subtotal when tax is calculated and amount when it does not.
// Prefer subtotal so a jurisdictional tax does not change the platform's
// purchased credit package. Amount is required by the provider protocol even
// when subtotal is present, so validate both values before selecting one.
func waffoPancakeCallbackAmount(data pancake.WebhookEventData) (float64, error) {
	amount, err := parseWaffoPancakeMoney(data.Amount, "金额", false)
	if err != nil {
		return 0, err
	}

	selected := amount
	var subtotal float64
	hasSubtotal := false
	if data.Subtotal != nil && strings.TrimSpace(*data.Subtotal) != "" {
		parsedSubtotal, subtotalErr := parseWaffoPancakeMoney(*data.Subtotal, "小计", false)
		if subtotalErr != nil {
			return 0, subtotalErr
		}
		subtotal = parsedSubtotal
		selected = parsedSubtotal
		hasSubtotal = true
	}
	var taxAmount float64
	hasTaxAmount := strings.TrimSpace(data.TaxAmount) != ""
	if data.TaxAmount != "" {
		var taxErr error
		taxAmount, taxErr = parseWaffoPancakeMoney(data.TaxAmount, "税额", true)
		if taxErr != nil {
			return 0, taxErr
		}
	}
	if data.Total != nil && strings.TrimSpace(*data.Total) != "" {
		total, totalErr := parseWaffoPancakeMoney(*data.Total, "总金额", false)
		minimum := amount
		if selected > minimum {
			minimum = selected
		}
		if totalErr != nil || total+waffoPancakeMoneyTolerance < minimum {
			return 0, errors.New("Waffo Pancake webhook 总金额无效")
		}
		if hasSubtotal && hasTaxAmount && total+waffoPancakeMoneyTolerance < subtotal+taxAmount {
			return 0, errors.New("Waffo Pancake webhook 总金额与税额明细不一致")
		}
	}
	return selected, nil
}

func parseWaffoPancakeMoney(raw, label string, allowZero bool) (float64, error) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || (!allowZero && value == 0) {
		return 0, fmt.Errorf("Waffo Pancake webhook %s无效", label)
	}
	return value, nil
}

func validWaffoPancakeShortID(value, prefix string) bool {
	value = strings.TrimSpace(value)
	return waffoPancakeShortIDPattern.MatchString(value) && strings.HasPrefix(value, prefix+"_")
}
