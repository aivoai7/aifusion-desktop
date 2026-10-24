package main

import (
	"errors"
	"sort"
	"sync"
	"time"
)

// Usage 是一次请求的计量结果。缓存 token 必须在结构里：
// 不落库的字段，迟早会变成「客户端自己算、跟账本永远对不上」的那个数。
type Usage struct {
	RequestID        string
	UserID           string
	APIKeyID         string
	Model            string
	Status           string // success / error / canceled
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	Cost             Money
	Latency          time.Duration
	CreatedAt        time.Time
}

func (u Usage) TotalTokens() int64 {
	return u.InputTokens + u.OutputTokens + u.CacheReadTokens + u.CacheWriteTokens
}

// Ledger 是账本的唯一写入口。
// 一次 Commit = 一个数据库事务：用量行、余额扣减、流水快照，要么全成，要么全无。
type Ledger interface {
	// Commit 记账；余额不足返回 ErrInsufficientBalance 且不留任何痕迹。
	Commit(u Usage, at time.Time) error
	Balance(userID string) (Money, bool)
	// Summary 按自然日聚合 success 记录，口径与 /v1/wallet/usage 一致
	Summary(userID string, from time.Time) (requests int64, tokens int64, cost Money, daily map[string]Money)
}

var ErrInsufficientBalance = errors.New("insufficient balance")

// MemoryLedger 是账本的参考实现，用来把「同一事务」这件事写成可测的代码。
// 真实现换成 Postgres：同样的接口，Commit 里 BEGIN/INSERT/UPDATE/INSERT/COMMIT。
type MemoryLedger struct {
	mu       sync.Mutex
	balance  map[string]Money
	usages   []Usage
	ledgerID int64
}

func NewMemoryLedger() *MemoryLedger {
	return &MemoryLedger{balance: map[string]Money{}}
}

func (l *MemoryLedger) TopUp(userID string, amount Money) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.balance[userID] += amount
}

func (l *MemoryLedger) Commit(u Usage, at time.Time) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if u.Cost.IsNegative() {
		return errors.New("cost must not be negative")
	}
	if l.balance[u.UserID] < u.Cost {
		// 关键：这里直接返回，不 append、不改余额，等价于事务回滚
		return ErrInsufficientBalance
	}
	if u.CreatedAt.IsZero() {
		u.CreatedAt = at
	}
	l.ledgerID++
	l.balance[u.UserID] -= u.Cost
	l.usages = append(l.usages, u)
	return nil
}

func (l *MemoryLedger) Balance(userID string) (Money, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.balance[userID]
	return b, ok
}

func (l *MemoryLedger) Summary(userID string, from time.Time) (int64, int64, Money, map[string]Money) {
	l.mu.Lock()
	defer l.mu.Unlock()
	daily := map[string]Money{}
	var requests, tokens int64
	var cost Money
	for _, u := range l.usages {
		if u.UserID != userID || u.Status != "success" || u.CreatedAt.Before(from) {
			continue
		}
		requests++
		tokens += u.TotalTokens()
		cost += u.Cost
		day := u.CreatedAt.Format("2006-01-02")
		daily[day] += u.Cost
	}
	return requests, tokens, cost, daily
}

// SortedDays 把按日聚合的结果排成升序，接口输出时用它补齐没有请求的日子
func SortedDays(daily map[string]Money) []string {
	keys := make([]string, 0, len(daily))
	for k := range daily {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
