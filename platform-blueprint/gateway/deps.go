package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// ---------- 内存版 KeyStore：只演示「前缀定位 + 哈希校验」，真实现是 Postgres ----------

type memKey struct {
	userID, keyID, hash string
	revoked             bool
}

type MemKeyStore struct {
	mu       sync.RWMutex
	byPrefix map[string]memKey
	touched  []string
}

func NewMemKeyStore() *MemKeyStore { return &MemKeyStore{byPrefix: map[string]memKey{}} }

// AddKey 注册一把 Key：库里只留哈希，明文只在调用方手里
func (s *MemKeyStore) AddKey(plain, userID, keyID string) {
	sum := hashKey(plain)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byPrefix[plain[:7]] = memKey{userID: userID, keyID: keyID, hash: sum}
}

func (s *MemKeyStore) Revoke(plain string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := s.byPrefix[plain[:7]]
	k.revoked = true
	s.byPrefix[plain[:7]] = k
}

func (s *MemKeyStore) LookupByPrefix(prefix string) (string, string, string, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	k, ok := s.byPrefix[prefix]
	if !ok {
		return "", "", "", false, ErrBadKey
	}
	return k.userID, k.keyID, k.hash, k.revoked, nil
}

func (s *MemKeyStore) TouchKey(keyID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = append(s.touched, keyID)
}

// ---------- 静态价目：演示「缺价目不能悄悄算 0」 ----------

type staticPricing struct {
	slugByID map[string]string
	prices   map[string][4]Money // input / output / cacheRead / cacheWrite
}

func NewStaticPricing() *staticPricing {
	p := &staticPricing{slugByID: map[string]string{}, prices: map[string][4]Money{}}
	p.Add("glm-5.3-flash", "glm-5.3-flash", "1.00", "4.00", "0.20", "1.25")
	p.Add("deepseek-v4.1-flash", "deepseek-v4.1-flash", "0.28", "0.42", "0.028", "0")
	return p
}

func (p *staticPricing) Add(slug, alias, in, out, cr, cw string) {
	money := func(s string) Money {
		m, err := NewMoneyFromDollars(s)
		if err != nil {
			panic(err)
		}
		return m
	}
	p.slugByID[alias] = slug
	p.prices[slug] = [4]Money{money(in), money(out), money(cr), money(cw)}
}

func (p *staticPricing) ResolveSlug(requested string) (string, bool) {
	slug, ok := p.slugByID[requested]
	return slug, ok
}

func (p *staticPricing) PriceFor(slug string) (Money, Money, Money, Money, bool) {
	v, ok := p.prices[slug]
	if !ok {
		return 0, 0, 0, 0, false
	}
	return v[0], v[1], v[2], v[3], true
}

// Slugs 按字母序返回可见模型；库里模型会不断增加，顺序稳定才好比对与截图
func (p *staticPricing) Slugs() []string {
	out := make([]string, 0, len(p.prices))
	for slug := range p.prices {
		out = append(out, slug)
	}
	sort.Strings(out)
	return out
}

// ---------- 上游转发：SSE 也走同一条路，最后收敛成 ForwardResult ----------

// PassthroughForwarder 是最小可用形态：原样转发、原样回吐，再从响应里取 usage。
// 真网关还要做协议转换（Anthropic ↔ OpenAI）与流式 usage 拼装，接口不变。
func PassthroughForwarder(baseURL string) Forwarder {
	client := &http.Client{Timeout: 5 * time.Minute}
	return func(r *http.Request, slug string, body []byte) (ForwardResult, error) {
		if baseURL == "" {
			return ForwardResult{}, ErrNoUpstream
		}
		up, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
			strings.TrimRight(baseURL, "/")+"/chat/completions", bytes.NewReader(body))
		if err != nil {
			return ForwardResult{}, err
		}
		up.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(up)
		if err != nil {
			return ForwardResult{}, err
		}
		defer resp.Body.Close()
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			return ForwardResult{}, err
		}
		res := ForwardResult{Status: resp.StatusCode, Body: raw}
		var parsed struct {
			Usage struct {
				PromptTokens        int64 `json:"prompt_tokens"`
				CompletionTokens    int64 `json:"completion_tokens"`
				PromptTokensDetails *struct {
					CachedTokens int64 `json:"cached_tokens"`
				} `json:"prompt_tokens_details"`
			} `json:"usage"`
		}
		if err := json.Unmarshal(raw, &parsed); err == nil {
			res.InputTokens = parsed.Usage.PromptTokens
			res.OutputTokens = parsed.Usage.CompletionTokens
			if parsed.Usage.PromptTokensDetails != nil {
				res.CacheReadTokens = parsed.Usage.PromptTokensDetails.CachedTokens
			}
		}
		return res, nil
	}
}

var ErrNoUpstream = &upstreamError{"未配置 UPSTREAM_BASE_URL"}

type upstreamError struct{ msg string }

func (e *upstreamError) Error() string { return e.msg }
