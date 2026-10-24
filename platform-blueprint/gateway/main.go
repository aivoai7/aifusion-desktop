package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// main 只做装配：依赖全部从构造函数进来，业务逻辑不在这里，
// 这样上面每个函数都能在单测里用内存实现跑通。
func main() {
	g := &Gateway{
		Store:        NewMemKeyStore(),   // 换 *PGKeyStore
		Ledger:       NewMemoryLedger(),  // 换 *PGLedger（Commit 里就是一个事务）
		Pricing:      NewStaticPricing(), // 换 *PGPricing（读 model_pricing 生效行）
		Forward:      PassthroughForwarder(os.Getenv("UPSTREAM_BASE_URL")),
		MaxBody:      int64(envInt("MAX_BODY_MB", 10)) * 1024 * 1024,
		KeyPrefixLen: envInt("KEY_PREFIX_LEN", 7),
		Now:          time.Now,
	}

	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           g.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// 长回复靠 SSE 持续写，这里不能设太短的 WriteTimeout
	}
	log.Printf("gateway listening on %s", addr)
	log.Fatal(srv.ListenAndServe())
}
