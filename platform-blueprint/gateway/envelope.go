package main

import (
	"encoding/json"
	"net/http"
)

// 两个信封，一条分界线：/v1/* 是 API Key 网关，/api/v1/* 是控制台自己的 JWT 接口。
// 混用的后果是真实的：Claude Code / Codex 按 OpenAI 形状解析，收到 {"code":..,"message":..}
// 只能显示「API Error: 400」，中文原因全丢。

type gatewayErrorBody struct {
	Error gatewayError `json:"error"`
}

type gatewayError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Param   any    `json:"param"`
	Code    any    `json:"code"`
}

// GatewayErrorType 与各家 SDK 的错误分类对齐
func GatewayErrorType(status int) string {
	switch status {
	case http.StatusBadRequest, http.StatusRequestEntityTooLarge, http.StatusNotFound:
		return "invalid_request_error"
	case http.StatusUnauthorized:
		return "authentication_error"
	case http.StatusPaymentRequired:
		return "insufficient_quota"
	case http.StatusTooManyRequests:
		return "rate_limit_error"
	default:
		return "api_error"
	}
}

func writeGatewayError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, gatewayErrorBody{
		Error: gatewayError{Message: message, Type: GatewayErrorType(status)},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
