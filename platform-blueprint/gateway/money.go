package main

import (
	"fmt"
	"strconv"
	"strings"
)

// Money 用「1e-8 美元」的整数表示，和库里 numeric(18,8) 一一对应。
// 全程不用 float：0.1 + 0.2 在账本里是 bug，在对账时是事故。
type Money int64

const (
	MoneyScale      = 100_000_000
	MoneyPerMillion = 1_000_000
)

// NewMoneyFromDollars 解析 "0.0077" 这类十进制字符串。
func NewMoneyFromDollars(s string) (Money, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty amount")
	}
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(strings.TrimPrefix(s, "-"), "+")
	parts := strings.SplitN(s, ".", 2)
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("bad amount %q: %w", s, err)
	}
	frac := int64(0)
	if len(parts) == 2 {
		d := parts[1]
		if len(d) > 8 {
			return 0, fmt.Errorf("amount %q exceeds 8 decimal places", s)
		}
		d += strings.Repeat("0", 8-len(d))
		frac, err = strconv.ParseInt(d, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("bad amount %q: %w", s, err)
		}
	}
	m := Money(whole*MoneyScale + frac)
	if neg {
		m = -m
	}
	return m, nil
}

// CostForTokens 按「每百万 token 单价」算一段 token 的钱，向下取整到 1e-8。
// tokens * pricePerMillion / 1e6，两个因子都是整数，中间乘积不溢出（token < 2^31）。
func CostForTokens(tokens int64, pricePerMillion Money) Money {
	return Money(tokens * int64(pricePerMillion) / MoneyPerMillion)
}

func (m Money) Dollars() string {
	sign := ""
	v := int64(m)
	if v < 0 {
		sign, v = "-", -v
	}
	return fmt.Sprintf("%s%d.%08d", sign, v/MoneyScale, v%MoneyScale)
}

func (m Money) IsNegative() bool { return m < 0 }
