package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
)

// Principal 是鉴权之后挂在请求上的身份
type Principal struct {
	UserID   string
	APIKeyID string
}

type ctxKey int

const principalKey ctxKey = 1

// KeyStore 只按前缀定位、按哈希校验：库里永远没有明文 Key，日志里也不该出现。
type KeyStore interface {
	LookupByPrefix(prefix string) (userID, keyID, storedHash string, revoked bool, err error)
	TouchKey(keyID string)
}

func hashKey(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// ErrNoKey / ErrBadKey 让上层决定回什么状态码，中间件本身不写响应
var (
	ErrNoKey  = errors.New("missing api key")
	ErrBadKey = errors.New("invalid api key")
)

// ParseBearerKey 从 Authorization 头取 Bearer Key（大小写不敏感、容忍多余空格）
func ParseBearerKey(header string) (string, error) {
	const prefix = "Bearer "
	h := strings.TrimSpace(header)
	if len(h) < len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return "", ErrNoKey
	}
	key := strings.TrimSpace(h[len(prefix):])
	if key == "" {
		return "", ErrNoKey
	}
	return key, nil
}

// Authenticate 校验一把网关 Key。keyPrefixLen 建议 7（"fk_" + 4 位），
// 前缀太短会让一次查询命中大量行，太长又没必要。
func Authenticate(store KeyStore, keyPrefixLen int, header string) (Principal, error) {
	key, err := ParseBearerKey(header)
	if err != nil {
		return Principal{}, err
	}
	if !strings.HasPrefix(key, "fk_") {
		return Principal{}, ErrBadKey
	}
	if len(key) <= keyPrefixLen {
		return Principal{}, ErrBadKey
	}
	userID, keyID, storedHash, revoked, err := store.LookupByPrefix(key[:keyPrefixLen])
	if err != nil {
		return Principal{}, ErrBadKey
	}
	if revoked {
		return Principal{}, ErrBadKey
	}
	if subtle.ConstantTimeCompare([]byte(hashKey(key)), []byte(storedHash)) != 1 {
		return Principal{}, ErrBadKey
	}
	store.TouchKey(keyID)
	return Principal{UserID: userID, APIKeyID: keyID}, nil
}

func withPrincipal(r *http.Request, p Principal) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), principalKey, p))
}

func principalFrom(r *http.Request) (Principal, bool) {
	p, ok := r.Context().Value(principalKey).(Principal)
	return p, ok
}
