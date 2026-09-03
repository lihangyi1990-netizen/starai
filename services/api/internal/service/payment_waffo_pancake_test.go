package service

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	pancake "github.com/waffo-com/waffo-pancake-sdk-go"
)

const (
	testWaffoMerchant = "MER_AbCdEfGhIjKlMnOpQrStUv"
	testWaffoStore    = "STO_AbCdEfGhIjKlMnOpQrStUv"
	testWaffoProduct  = "PROD_AbCdEfGhIjKlMnOpQrStUv"
)

func waffoTestPrivateKey(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal RSA key: %v", err)
	}
	return key, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func waffoTestPublicKey(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}

func TestWaffoPancakeProviderReadiness(t *testing.T) {
	privateKey := "-----BEGIN PRIVATE KEY----- test -----END PRIVATE KEY-----"
	cfg := PaymentProviderConfig{
		Enabled: true, Provider: waffoPancakeProvider, Currency: "usd",
		WaffoPancakeMerchantID: testWaffoMerchant, WaffoPancakePrivateKey: privateKey,
		WaffoPancakeStoreID: testWaffoStore, WaffoPancakeProductID: testWaffoProduct,
		WaffoPancakeEnvironment: "prod",
	}
	if !cfg.Ready() || !cfg.WaffoPancakeReady() || !cfg.WaffoPancakeCheckoutReady() || !cfg.WaffoPancakeWebhookReady() {
		t.Fatal("complete Waffo Pancake configuration should be ready")
	}
	badCfg := PaymentProviderConfig{Provider: waffoPancakeProvider, Currency: "USD", WaffoPancakeMerchantID: "MER_bad", WaffoPancakePrivateKey: privateKey, WaffoPancakeStoreID: testWaffoStore, WaffoPancakeProductID: testWaffoProduct, WaffoPancakeEnvironment: "prod"}
	if badCfg.WaffoPancakeWebhookReady() {
		t.Fatal("malformed merchant id must not be accepted")
	}
	webhookOnly := cfg
	webhookOnly.WaffoPancakePrivateKey = ""
	webhookOnly.WaffoPancakeProductID = ""
	if webhookOnly.WaffoPancakeCheckoutReady() || !webhookOnly.WaffoPancakeWebhookReady() {
		t.Fatal("webhook readiness must not depend on checkout private key or product")
	}
	cfg.Enabled = false
	if cfg.Ready() || cfg.WaffoPancakeReady() {
		t.Fatal("disabled Waffo Pancake checkout must not be ready")
	}
	if !cfg.WaffoPancakeWebhookReady() {
		t.Fatal("disabling new checkout must not disable an otherwise configured webhook")
	}
}

func TestCreateWaffoPancakeCheckout(t *testing.T) {
	_, privateKey := waffoTestPrivateKey(t)
	var mu sync.Mutex
	type request struct {
		path    string
		body    []byte
		headers http.Header
	}
	var requests []request
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		requests = append(requests, request{path: r.URL.Path, body: body, headers: r.Header.Clone()})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/actions/auth/issue-session-token":
			_, _ = io.WriteString(w, `{"data":{"token":"jwt-test","expiresAt":"2099-01-01T00:00:00Z"}}`)
		case "/v1/actions/checkout/create-session":
			_, _ = io.WriteString(w, `{"data":{"sessionId":"SES_123","checkoutUrl":"https://checkout.waffo.test/session/123","expiresAt":"2099-01-01T00:00:00Z"}}`)
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"data":null,"errors":[{"message":"not found"}]}`)
		}
	}))
	defer server.Close()

	svc := &PaymentService{httpClient: server.Client(), waffoPancakeAPIBase: server.URL}
	cfg := PaymentProviderConfig{
		Provider: waffoPancakeProvider, Currency: "USD",
		WaffoPancakeMerchantID: testWaffoMerchant, WaffoPancakePrivateKey: privateKey,
		WaffoPancakeStoreID: testWaffoStore, WaffoPancakeProductID: testWaffoProduct,
		WaffoPancakeTaxCategory: "saas",
		WaffoPancakeReturnURL:   "https://tuna.example/app/wallet?order={order_no}",
	}
	checkoutURL, sessionID, err := svc.createWaffoPancakeCheckout(context.Background(), cfg, "ord_test_123", 42, 12.34, time.Now().Add(5*time.Minute))
	if err != nil {
		t.Fatalf("create checkout: %v", err)
	}
	if sessionID != "SES_123" || !strings.HasPrefix(checkoutURL, "https://checkout.waffo.test/session/123#token=jwt-test") {
		t.Fatalf("unexpected checkout result: %q / %q", checkoutURL, sessionID)
	}

	mu.Lock()
	got := append([]request(nil), requests...)
	mu.Unlock()
	if len(got) != 2 {
		t.Fatalf("expected authenticated checkout to issue two requests, got %d", len(got))
	}
	for _, req := range got {
		if req.headers.Get("X-Merchant-Id") != testWaffoMerchant || req.headers.Get("X-Signature") == "" || req.headers.Get("X-Idempotency-Key") == "" {
			t.Errorf("missing signed request headers on %s: %v", req.path, req.headers)
		}
	}
	var checkoutBody struct {
		ProductID     string `json:"productId"`
		Currency      string `json:"currency"`
		PriceSnapshot struct {
			Amount      string `json:"amount"`
			TaxCategory string `json:"taxCategory"`
		} `json:"priceSnapshot"`
		OrderExternalID string `json:"orderMerchantExternalId"`
		SuccessURL      string `json:"successUrl"`
	}
	for _, req := range got {
		if req.path == "/v1/actions/checkout/create-session" {
			if err := json.Unmarshal(req.body, &checkoutBody); err != nil {
				t.Fatalf("decode checkout request: %v", err)
			}
		}
	}
	if checkoutBody.ProductID != testWaffoProduct || checkoutBody.Currency != "USD" || checkoutBody.PriceSnapshot.Amount != "12.34" || checkoutBody.PriceSnapshot.TaxCategory != "saas" || checkoutBody.OrderExternalID != "ord_test_123" || !strings.Contains(checkoutBody.SuccessURL, "ord_test_123") {
		t.Fatalf("unexpected checkout body: %+v", checkoutBody)
	}
}

func TestVerifyWaffoPancakeWebhookSecurityBoundary(t *testing.T) {
	privateKey, _ := waffoTestPrivateKey(t)
	publicKey := waffoTestPublicKey(t, privateKey)
	externalID := "ord_test_123"
	payload := map[string]any{
		"id": "evt_1", "timestamp": "2099-01-01T00:00:00Z", "eventType": "order.completed",
		"eventId": "PAY_AbCdEfGhIjKlMnOpQrStUv", "storeId": testWaffoStore,
		"storeName": "tuna", "mode": "prod", "data": map[string]any{
			"orderId": "ORD_AbCdEfGhIjKlMnOpQrStUv", "orderStatus": "completed", "paymentStatus": "succeeded",
			"orderMerchantExternalId": externalID, "amount": "12.34", "subtotal": "12.34", "total": "12.34", "currency": "USD",
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	timestamp := fmt.Sprintf("%d", time.Now().UnixMilli())
	hash := sha256.Sum256([]byte(timestamp + "." + string(raw)))
	signed, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hash[:])
	if err != nil {
		t.Fatal(err)
	}
	signature := "t=" + timestamp + ",v1=" + base64.StdEncoding.EncodeToString(signed)
	cfg := PaymentProviderConfig{
		Provider: waffoPancakeProvider, Currency: "USD", WaffoPancakeEnvironment: "prod",
		WaffoPancakeMerchantID: testWaffoMerchant, WaffoPancakePrivateKey: "configured",
		WaffoPancakeStoreID: testWaffoStore, WaffoPancakeProductID: testWaffoProduct,
		WaffoPancakeWebhookPublicKey: publicKey,
	}
	event, err := verifyWaffoPancakeWebhook(raw, signature, cfg, "prod")
	if err != nil || event.EventType != "order.completed" {
		t.Fatalf("valid webhook rejected: event=%v err=%v", event, err)
	}
	if _, err := verifyWaffoPancakeWebhook(raw, "t="+timestamp+",v1=bad", cfg, "prod"); err == nil {
		t.Fatal("invalid webhook signature accepted")
	}
	if _, err := verifyWaffoPancakeWebhook(raw, signature, cfg, "test"); err == nil {
		t.Fatal("test route accepted while provider is configured for prod")
	}
	payload["mode"] = "test"
	wrongModeRaw, _ := json.Marshal(payload)
	wrongHash := sha256.Sum256([]byte(timestamp + "." + string(wrongModeRaw)))
	wrongSigned, _ := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, wrongHash[:])
	wrongSignature := "t=" + timestamp + ",v1=" + base64.StdEncoding.EncodeToString(wrongSigned)
	if _, err := verifyWaffoPancakeWebhook(wrongModeRaw, wrongSignature, cfg, "prod"); err == nil {
		t.Fatal("wrong event environment accepted")
	}

	// An unqualified endpoint must use the configured environment directly;
	// an unrelated malformed key must not make a valid test event fail.
	testPayload := map[string]any{}
	if err := json.Unmarshal(raw, &testPayload); err != nil {
		t.Fatal(err)
	}
	testPayload["mode"] = "test"
	testRaw, _ := json.Marshal(testPayload)
	testHash := sha256.Sum256([]byte(timestamp + "." + string(testRaw)))
	testSigned, _ := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, testHash[:])
	testSignature := "t=" + timestamp + ",v1=" + base64.StdEncoding.EncodeToString(testSigned)
	testCfg := cfg
	testCfg.WaffoPancakeEnvironment = "test"
	testCfg.WaffoPancakeWebhookTestKey = publicKey
	testCfg.WaffoPancakeWebhookPublicKey = ""
	testCfg.WaffoPancakeWebhookProdKey = "malformed"
	if _, err := verifyWaffoPancakeWebhook(testRaw, testSignature, testCfg, ""); err != nil {
		t.Fatalf("configured test webhook should ignore unrelated prod key: %v", err)
	}
}

func TestValidateWaffoPancakeCompletedEvent(t *testing.T) {
	orderNo := "ord_test_123"
	completed := "completed"
	succeeded := "succeeded"
	externalID := orderNo
	event := &pancake.TypedWebhookEvent[pancake.WebhookEventData]{
		EventType: string(pancake.WebhookEventTypeOrderCompleted), StoreID: testWaffoStore,
		Data: pancake.WebhookEventData{OrderID: "ORD_AbCdEfGhIjKlMnOpQrStUv", OrderMerchantExternalID: &externalID, OrderStatus: &completed, PaymentStatus: &succeeded},
	}
	cfg := PaymentProviderConfig{WaffoPancakeStoreID: testWaffoStore}
	data, err := validateWaffoPancakeCompletedEvent(event, cfg)
	if err != nil || *data.OrderMerchantExternalID != orderNo {
		t.Fatalf("valid completed event rejected: %+v / %v", data, err)
	}
	for name, mutate := range map[string]func(*pancake.TypedWebhookEvent[pancake.WebhookEventData]){
		"store":          func(e *pancake.TypedWebhookEvent[pancake.WebhookEventData]) { e.StoreID = "STO_other" },
		"order status":   func(e *pancake.TypedWebhookEvent[pancake.WebhookEventData]) { v := "pending"; e.Data.OrderStatus = &v },
		"payment status": func(e *pancake.TypedWebhookEvent[pancake.WebhookEventData]) { v := "failed"; e.Data.PaymentStatus = &v },
	} {
		t.Run(name, func(t *testing.T) {
			copy := *event
			copy.Data = event.Data
			mutate(&copy)
			if _, err := validateWaffoPancakeCompletedEvent(&copy, cfg); err == nil {
				t.Fatal("invalid event accepted")
			}
		})
	}
}

func TestWaffoPancakeCallbackAmount(t *testing.T) {
	subtotal := "12.34"
	total := "13.57"
	amount, err := waffoPancakeCallbackAmount(pancake.WebhookEventData{Amount: "13.57", Subtotal: &subtotal, Total: &total})
	if err != nil || amount != 12.34 {
		t.Fatalf("subtotal should be used: amount=%v err=%v", amount, err)
	}
	for _, data := range []pancake.WebhookEventData{
		{Amount: "nan"}, {Amount: "0"}, {Amount: "-1"}, {Amount: "1", Total: func() *string { v := "0.5"; return &v }()},
		{Amount: "nan", Subtotal: &subtotal},
		{Amount: "13.57", Subtotal: func() *string { v := "bad"; return &v }()},
		{Amount: "13.57", TaxAmount: "oops"},
		{Amount: "13.57", Subtotal: &subtotal, Total: func() *string { v := "13"; return &v }()},
		{Amount: "12.00", Subtotal: func() *string { v := "12.00"; return &v }(), TaxAmount: "2.00", Total: func() *string { v := "13.99"; return &v }()},
	} {
		if _, err := waffoPancakeCallbackAmount(data); err == nil {
			t.Errorf("invalid callback amount accepted: %+v", data)
		}
	}
	validWithTax := pancake.WebhookEventData{
		Amount: "12.00", Subtotal: func() *string { v := "12.00"; return &v }(),
		TaxAmount: "2.00", Total: func() *string { v := "14.00"; return &v }(),
	}
	if amount, err := waffoPancakeCallbackAmount(validWithTax); err != nil || amount != 12 {
		t.Fatalf("consistent subtotal/tax/total should be accepted: amount=%v err=%v", amount, err)
	}
}
