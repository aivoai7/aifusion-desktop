package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"
)

// Pricing 把 slug 映射到单价。真实现读 model_pricing 的生效行；
// 缺价目必须显式报错或按 0 计费并打点，别悄悄算成 0 —— 那正是「总成本 $0.01」的由来。
type Pricing interface {
	PriceFor(slug string) (input, output, cacheRead, cacheWrite Money, ok bool)
	ResolveSlug(requested string) (string, bool)
	// Slugs 是「当前对该 Key 可见」的模型清单；真实现按 channel_models 授权过滤，
	// 客户端的模型下拉完全靠它，所以不能把库里所有模型都吐出去。
	Slugs() []string
}

// ForwardResult 是一次上游调用的结果（流式与否都在这里收敛成同一形状）
type ForwardResult struct {
	Status           int
	Body             []byte
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
}

// Forwarder 是真正的上游调用（含 SSE 透传）。抽成接口，网关的计量与鉴权逻辑才可测。
type Forwarder func(r *http.Request, slug string, body []byte) (ForwardResult, error)

type Gateway struct {
	Store        KeyStore
	Ledger       Ledger
	Pricing      Pricing
	Forward      Forwarder
	MaxBody      int64
	KeyPrefixLen int
	Now          func() time.Time
}

func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/chat/completions", g.requireKey(g.chatCompletions))
	mux.HandleFunc("GET /v1/models", g.requireKey(g.models))
	mux.HandleFunc("GET /v1/wallet/balance", g.requireKey(g.walletBalance))
	mux.HandleFunc("GET /v1/wallet/usage", g.requireKey(g.walletUsage))
	return mux
}

// models 是客户端模型下拉的唯一来源：只报有价目、对该 Key 可见的模型。
// 报了一个实际调不通的模型，比少报一个更难排查。
func (g *Gateway) models(w http.ResponseWriter, r *http.Request) {
	type modelView struct {
		ID     string `json:"id"`
		Object string `json:"object"`
	}
	data := make([]modelView, 0)
	for _, slug := range g.Pricing.Slugs() {
		data = append(data, modelView{ID: slug, Object: "model"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": data})
}

// requireKey 只负责鉴权与错误体形状，不掺业务
func (g *Gateway) requireKey(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := Authenticate(g.Store, g.KeyPrefixLen, r.Header.Get("Authorization"))
		if err != nil {
			status := http.StatusUnauthorized
			msg := "缺少 API Key"
			if err == ErrBadKey {
				msg = "API Key 无效或已吊销"
			}
			writeGatewayError(w, status, msg)
			return
		}
		next(w, r.WithContext(withPrincipal(r, p).Context()))
	}
}

// chatCompletions 的顺序就是网关的骨架：护栏 → 路由 → 转发 → 计量 → 一个事务落账 → 回吐
func (g *Gateway) chatCompletions(w http.ResponseWriter, r *http.Request) {
	p, ok := principalFrom(r)
	if !ok {
		writeGatewayError(w, http.StatusUnauthorized, "API Key 无效或已吊销")
		return
	}

	// 护栏只按请求体大小设，不按消息条数：Agent 客户端每轮重放整段历史，
	// 且一次 tool_call 在 OpenAI 形状下拆成 assistant + tool 两条，条数上限必然误伤。
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, g.MaxBody))
	if err != nil {
		writeGatewayError(w, http.StatusRequestEntityTooLarge, "请求体超过上限（MAX_BODY_MB）")
		return
	}

	var req struct {
		Model    string `json:"model"`
		Stream   bool   `json:"stream"`
		Messages []struct {
			Role    string `json:"role"`
			Content any    `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &req); err != nil || len(req.Messages) == 0 {
		writeGatewayError(w, http.StatusBadRequest, "请求体不是合法的 chat/completions JSON")
		return
	}
	slug, ok := g.Pricing.ResolveSlug(req.Model)
	if !ok {
		writeGatewayError(w, http.StatusNotFound, "Model '"+req.Model+"' not found or unavailable.")
		return
	}

	started := g.Now()
	res, err := g.Forward(r, slug, body)
	if err != nil {
		// 上游炸了也要留一条 error 记录，否则排障时这段流量在账本里凭空消失
		_ = g.Ledger.Commit(Usage{
			UserID: p.UserID, APIKeyID: p.APIKeyID, Model: slug, Status: "error",
			Latency: g.Now().Sub(started),
		}, started)
		writeGatewayError(w, http.StatusBadGateway, "上游不可用")
		return
	}

	status := "success"
	if res.Status >= 400 {
		status = "error"
	}
	inP, outP, crP, cwP, _ := g.Pricing.PriceFor(slug)
	cost := CostForTokens(res.InputTokens, inP) +
		CostForTokens(res.OutputTokens, outP) +
		CostForTokens(res.CacheReadTokens, crP) +
		CostForTokens(res.CacheWriteTokens, cwP)

	if err := g.Ledger.Commit(Usage{
		UserID: p.UserID, APIKeyID: p.APIKeyID, Model: slug, Status: status,
		InputTokens: res.InputTokens, OutputTokens: res.OutputTokens,
		CacheReadTokens: res.CacheReadTokens, CacheWriteTokens: res.CacheWriteTokens,
		Cost: cost, Latency: g.Now().Sub(started),
	}, started); err != nil {
		if err == ErrInsufficientBalance {
			writeGatewayError(w, http.StatusPaymentRequired, "Insufficient balance. Please recharge your account.")
			return
		}
		writeGatewayError(w, http.StatusInternalServerError, "记账失败")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(res.Status)
	_, _ = io.Copy(w, bytes.NewReader(res.Body))
}

func (g *Gateway) walletBalance(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFrom(r)
	balance, ok := g.Ledger.Balance(p.UserID)
	if !ok {
		writeGatewayError(w, http.StatusNotFound, "钱包不存在")
		return
	}
	type balanceView struct {
		BalanceUSD   float64 `json:"-"`
		BalanceText  string  `json:"balance_usd"`
		CurrencyCode string  `json:"currency_code"`
		LowBalance   bool    `json:"low_balance"`
	}
	v := balanceView{BalanceText: balance.Dollars(), CurrencyCode: "USD", LowBalance: balance < MoneyScale}
	writeJSON(w, http.StatusOK, v)
}

// walletUsage 与余额同口径：同一个 user、同一个 status='success'、同一套自然日。
// 客户端拿到的是「平台真数」，不需要自己再估一遍价。
func (g *Gateway) walletUsage(w http.ResponseWriter, r *http.Request) {
	p, _ := principalFrom(r)
	days, err := strconv.Atoi(queryOr(r, "days", "30"))
	if err != nil || days < 1 || days > 365 {
		writeGatewayError(w, http.StatusBadRequest, "days 必须是 1..365 的整数")
		return
	}
	from := g.Now().AddDate(0, 0, -(days - 1))
	from = time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, from.Location())

	requests, tokens, cost, daily := g.Ledger.Summary(p.UserID, from)
	type dayRow struct {
		Date     string `json:"date"`
		Requests int64  `json:"requests"`
		CostUSD  string `json:"cost_usd"`
	}
	rows := make([]dayRow, 0, len(daily))
	for _, d := range SortedDays(daily) {
		rows = append(rows, dayRow{Date: d, CostUSD: daily[d].Dollars()})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"currency_code": "USD",
		"range":         map[string]any{"days": days, "from": from.Format("2006-01-02")},
		"totals": map[string]any{
			"requests": requests,
			"tokens":   tokens,
			"cost_usd": cost.Dollars(),
		},
		"daily": rows,
	})
}

func queryOr(r *http.Request, key, def string) string {
	if v := r.URL.Query().Get(key); v != "" {
		return v
	}
	return def
}
