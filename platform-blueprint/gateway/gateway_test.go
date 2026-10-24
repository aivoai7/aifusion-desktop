package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 这些用例是这套骨架的验收线：错误体形状、护栏只按体积、扣费与用量同事务、
// 用量接口与余额同口径。把它们跑绿，再往 Postgres 上换实现。

const (
	testKey    = "fk_test_0123456789abcdef"
	testPrefix = "fk_test"
	fixedNow   = "2026-10-23T12:00:00Z"
)

func newTestGateway(t *testing.T) (*Gateway, *MemoryLedger) {
	t.Helper()
	store := NewMemKeyStore()
	store.AddKey(testKey, "user-1", "key-1")
	ledger := NewMemoryLedger()
	ledger.TopUp("user-1", Money(5*MoneyScale)) // $5
	fixed, _ := time.Parse(time.RFC3339, fixedNow)
	return &Gateway{
		Store: store, Ledger: ledger, Pricing: NewStaticPricing(),
		Forward:      func(*http.Request, string, []byte) (ForwardResult, error) { return ForwardResult{}, ErrNoUpstream },
		MaxBody:      1024 * 1024,
		KeyPrefixLen: 7,
		Now:          func() time.Time { return fixed },
	}, ledger
}

func chatBody(messages int) string {
	items := make([]string, 0, messages)
	for i := 0; i < messages; i++ {
		items = append(items, `{"role":"user","content":"m"}`)
	}
	return `{"model":"glm-5.3-flash","messages":[` + strings.Join(items, ",") + `]}`
}

func do(t *testing.T, g *Gateway, method, path, body, auth string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	g.Handler().ServeHTTP(rec, req)
	return rec
}

// 网关错误必须是 {"error":{message,type}}，否则原生 SDK 只能显示「API Error: 400」
func decodeGatewayError(t *testing.T, rec *httptest.ResponseRecorder) gatewayError {
	t.Helper()
	var got gatewayErrorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("错误体不是合法 JSON：%s", rec.Body.String())
	}
	if got.Error.Message == "" {
		t.Fatalf("错误体缺 message：%s", rec.Body.String())
	}
	return got.Error
}

func TestMoneyNeverDrifts(t *testing.T) {
	m, err := NewMoneyFromDollars("0.0077")
	if err != nil {
		t.Fatal(err)
	}
	if m != 770000 {
		t.Fatalf("0.0077 = %d，期望 770000（1e-8 单位）", m)
	}
	// float 累加十次 0.01 会给出 0.09999999999999999；整数不会
	var sum Money
	for i := 0; i < 10; i++ {
		sum += Money(1000000) // $0.01
	}
	if sum.Dollars() != "0.10000000" {
		t.Fatalf("十次 $0.01 = %s", sum.Dollars())
	}
	if got := CostForTokens(1000, Money(1*MoneyScale)); got.Dollars() != "0.00100000" {
		t.Fatalf("1000 tokens × $1/M = %s", got.Dollars())
	}
	if _, err := NewMoneyFromDollars("0.000000001"); err == nil {
		t.Fatal("超过 8 位小数必须拒绝，否则与 numeric(18,8) 不一致")
	}
}

func TestAuthRejectsEveryBadKeyShape(t *testing.T) {
	g, _ := newTestGateway(t)
	cases := map[string]string{
		"没有 Authorization 头": "",
		"前缀不是 fk_":           "Bearer sk_something",
		"Key 太短":             "Bearer fk_a",
		"前缀对但哈希不匹配":          "Bearer " + testPrefix + "_wrongwrongwrong",
	}
	for name, auth := range cases {
		rec := do(t, g, http.MethodPost, "/v1/chat/completions", chatBody(1), auth)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s：%d，期望 401", name, rec.Code)
		}
		if got := decodeGatewayError(t, rec); got.Type != "authentication_error" {
			t.Fatalf("%s：type=%s", name, got.Type)
		}
	}
}

func TestRevokedKeyRejected(t *testing.T) {
	g, _ := newTestGateway(t)
	g.Store.(*MemKeyStore).Revoke(testKey)
	rec := do(t, g, http.MethodGet, "/v1/wallet/balance", "", "Bearer "+testKey)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("吊销后仍可用：%d", rec.Code)
	}
}

// 护栏按体积、不按条数：202 条消息必须能过
func TestGuardrailIsBodySizeOnly(t *testing.T) {
	g, _ := newTestGateway(t)
	g.Forward = func(*http.Request, string, []byte) (ForwardResult, error) {
		return ForwardResult{Status: 200, Body: []byte(`{"ok":true}`), InputTokens: 10, OutputTokens: 5}, nil
	}
	rec := do(t, g, http.MethodPost, "/v1/chat/completions", chatBody(202), "Bearer "+testKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("202 条被拦：%d %s", rec.Code, rec.Body.String())
	}

	g.MaxBody = 64
	rec = do(t, g, http.MethodPost, "/v1/chat/completions", chatBody(202), "Bearer "+testKey)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("超限未拒：%d", rec.Code)
	}
	if got := decodeGatewayError(t, rec); got.Type != "invalid_request_error" {
		t.Fatalf("413 的 type=%s", got.Type)
	}
}

func TestUnknownModelIsNotFound(t *testing.T) {
	g, _ := newTestGateway(t)
	body := `{"model":"nope-1","messages":[{"role":"user","content":"x"}]}`
	rec := do(t, g, http.MethodPost, "/v1/chat/completions", body, "Bearer "+testKey)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("%d", rec.Code)
	}
	if got := decodeGatewayError(t, rec); !strings.Contains(got.Message, "nope-1") {
		t.Fatalf("错误里应带上被拒的模型名：%s", got.Message)
	}
}

// 一次成功请求：余额扣减、用量行、流水快照同时发生
func TestSuccessfulRequestCommitsUsageAndDebit(t *testing.T) {
	g, ledger := newTestGateway(t)
	g.Forward = func(*http.Request, string, []byte) (ForwardResult, error) {
		return ForwardResult{
			Status: 200, Body: []byte(`{"id":"x"}`),
			InputTokens: 1_000_000, OutputTokens: 500_000, CacheReadTokens: 2_000_000,
		}, nil
	}
	before, _ := ledger.Balance("user-1")
	rec := do(t, g, http.MethodPost, "/v1/chat/completions", chatBody(2), "Bearer "+testKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	// $1/M 输入 + $4/M 输出 + $0.20/M 缓存读 = 1 + 2 + 0.4 = $3.40
	after, _ := ledger.Balance("user-1")
	if delta := before - after; delta.Dollars() != "3.40000000" {
		t.Fatalf("扣了 %s，期望 3.40000000", delta.Dollars())
	}
	reqs, tokens, cost, _ := ledger.Summary("user-1", time.Now().AddDate(0, 0, -1))
	if reqs != 1 || cost.Dollars() != "3.40000000" || tokens != 3_500_000 {
		t.Fatalf("用量对不上：%d 次 / %d tokens / %s", reqs, tokens, cost.Dollars())
	}
}

// 余额不足必须整个不写：既不能扣钱，也不能留下一条 success 用量
func TestInsufficientBalanceLeavesNoTrace(t *testing.T) {
	g, ledger := newTestGateway(t)
	g.Forward = func(*http.Request, string, []byte) (ForwardResult, error) {
		return ForwardResult{Status: 200, Body: []byte(`{}`), InputTokens: 10_000_000}, nil
	}
	before, _ := ledger.Balance("user-1")
	rec := do(t, g, http.MethodPost, "/v1/chat/completions", chatBody(1), "Bearer "+testKey)
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if got := decodeGatewayError(t, rec); got.Type != "insufficient_quota" {
		t.Fatalf("402 的 type=%s", got.Type)
	}
	after, _ := ledger.Balance("user-1")
	if before != after {
		t.Fatalf("余额被改了：%s -> %s", before.Dollars(), after.Dollars())
	}
	reqs, _, _, _ := ledger.Summary("user-1", time.Now().AddDate(-1, 0, 0))
	if reqs != 0 {
		t.Fatalf("留下了 %d 条用量，事务没有回滚", reqs)
	}
}

// 上游失败也要留 error 记录，否则排障时这段流量在账本里凭空消失
func TestUpstreamFailureIsLoggedAsError(t *testing.T) {
	g, ledger := newTestGateway(t)
	rec := do(t, g, http.MethodPost, "/v1/chat/completions", chatBody(1), "Bearer "+testKey)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("%d", rec.Code)
	}
	_, _, _, daily := ledger.Summary("user-1", time.Now().AddDate(-1, 0, 0))
	if len(daily) != 0 {
		t.Fatal("error 记录不该进 success 口径的聚合")
	}
	if n := len(ledger.usages); n != 1 || ledger.usages[0].Status != "error" {
		t.Fatalf("应留下 1 条 error 用量，实际 %d 条", n)
	}
}

func TestWalletUsageMatchesBalanceSource(t *testing.T) {
	g, ledger := newTestGateway(t)
	ledger.TopUp("user-2", Money(MoneyScale))
	if err := ledger.Commit(Usage{UserID: "user-2", Model: "glm-5.3-flash", Status: "success",
		InputTokens: 100, Cost: Money(12345)}, time.Now().AddDate(0, 0, -2)); err != nil {
		t.Fatal(err)
	}
	g.Store.(*MemKeyStore).AddKey("fk_user2_abcdefghijklmnop", "user-2", "key-2")

	rec := do(t, g, http.MethodGet, "/v1/wallet/usage?days=30", "", "Bearer fk_user2_abcdefghijklmnop")
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Totals struct {
			Requests int64  `json:"requests"`
			CostUSD  string `json:"cost_usd"`
		} `json:"totals"`
		Daily []struct {
			Date    string `json:"date"`
			CostUSD string `json:"cost_usd"`
		} `json:"daily"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Totals.Requests != 1 || got.Totals.CostUSD != "0.00012345" {
		t.Fatalf("totals 不对：%+v", got.Totals)
	}
	if len(got.Daily) != 1 {
		t.Fatalf("daily 应为 1 天：%+v", got.Daily)
	}
}

func TestWalletUsageValidatesDays(t *testing.T) {
	g, _ := newTestGateway(t)
	for _, q := range []string{"?days=0", "?days=366", "?days=abc", "?days=-1"} {
		rec := do(t, g, http.MethodGet, "/v1/wallet/usage"+q, "", "Bearer "+testKey)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s -> %d，期望 400", q, rec.Code)
		}
		if got := decodeGatewayError(t, rec); got.Type != "invalid_request_error" {
			t.Fatalf("%s type=%s", q, got.Type)
		}
	}
}

// /v1/models 是客户端模型下拉的唯一来源：没价目的模型不能出现，
// 否则用户选到一个必然 404 的 id，排障成本比少列一个模型高得多。
func TestModelsListsPricedSlugsOnly(t *testing.T) {
	g, _ := newTestGateway(t)
	rec := do(t, g, http.MethodGet, "/v1/models", "", "Bearer "+testKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Object string `json:"object"`
		Data   []struct {
			ID     string `json:"id"`
			Object string `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Object != "list" {
		t.Fatalf("object=%q，原生 SDK 按 list 解析", got.Object)
	}
	ids := make([]string, 0, len(got.Data))
	for _, m := range got.Data {
		if m.Object != "model" {
			t.Fatalf("object=%q", m.Object)
		}
		ids = append(ids, m.ID)
	}
	if strings.Join(ids, ",") != "deepseek-v4.1-flash,glm-5.3-flash" {
		t.Fatalf("模型列表 %+v，应只含有价目的 slug 且顺序稳定", ids)
	}

	// 未带 Key 同样要 401，不能泄露可用模型清单
	rec = do(t, g, http.MethodGet, "/v1/models", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("无 Key -> %d，期望 401", rec.Code)
	}
}
