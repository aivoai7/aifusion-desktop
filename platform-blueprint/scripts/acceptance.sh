#!/usr/bin/env bash
# 每阶段一条真实请求的验收脚本。原则：不用 mock，跑真接口，核对账本数字。
# 用法：BASE_URL=https://platform.example.com API_KEY=fk_xxx ./scripts/acceptance.sh [stage]
# Key 只从环境读，绝不打印；日志里出现的一律是脱敏形式。

set -uo pipefail

BASE_URL="${BASE_URL:?需要 BASE_URL，例如 https://platform.example.com}"
API_KEY="${API_KEY:?需要 API_KEY（网关 Key，fk_ 开头）}"
STAGE="${1:-all}"

masked_key() { printf '%s…%s' "${API_KEY:0:5}" "${API_KEY: -4}"; }

pass=0; fail=0
check() { # check <名称> <期望> <实际>
  if [ "$2" = "$3" ]; then printf '  ✅ %s\n' "$1"; pass=$((pass+1));
  else printf '  ❌ %s：期望 %s，实际 %s\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}
contains() { # contains <名称> <子串> <文本>
  case "$3" in *"$2"*) printf '  ✅ %s\n' "$1"; pass=$((pass+1));;
    *) printf '  ❌ %s：输出里没有 %s\n---\n%s\n---\n' "$1" "$2" "$3"; fail=$((fail+1));; esac
}

code_of() { curl -sS -o /tmp/acc.body -w '%{http_code}' "$@"; }

# ---------- 阶段 1：只读代理 + 请求日志 ----------
stage1() {
  echo "[1] 只读代理"
  c=$(code_of "$BASE_URL/healthz"); check "healthz 200" 200 "$c"
  c=$(code_of "$BASE_URL/v1/models"); check "无 Key 访问 /v1/models 401" 401 "$c"
  c=$(code_of -H "Authorization: Bearer $API_KEY" "$BASE_URL/v1/models"); check "带 Key 200" 200 "$c"
}

# ---------- 阶段 2：钱包与事务化扣费 ----------
stage2() {
  echo "[2] 扣费与账本"
  b1=$(curl -sS -H "Authorization: Bearer $API_KEY" "$BASE_URL/v1/wallet/balance" | jq -r .balance_usd)
  curl -sS -o /tmp/acc.body -X POST -H "Authorization: Bearer $API_KEY" \
    -H 'Content-Type: application/json' -d "$CHAT_BODY" "$BASE_URL/v1/chat/completions" >/dev/null
  b2=$(curl -sS -H "Authorization: Bearer $API_KEY" "$BASE_URL/v1/wallet/balance" | jq -r .balance_usd)
  printf '  ℹ️  余额 %s -> %s（Key %s）\n' "$b1" "$b2" "$(masked_key)"
  [ "$b1" != "$b2" ] && { printf '  ✅ 请求后余额发生变化\n'; pass=$((pass+1)); } \
                     || { printf '  ❌ 余额没动：扣费没进事务\n'; fail=$((fail+1)); }

  # 用量与余额必须同口径：同一天、同一个 status='success'
  cost=$(curl -sS -H "Authorization: Bearer $API_KEY" "$BASE_URL/v1/wallet/usage?days=1" | jq -r .totals.cost_usd)
  printf '  ℹ️  当日账本成本 %s\n' "$cost"
  [ "$cost" != "0.00000000" ] && { printf '  ✅ 用量接口有成本（价目命中）\n'; pass=$((pass+1)); } \
                              || { printf '  ❌ 成本为 0：模型没进 model_pricing，别让它悄悄算成 0\n'; fail=$((fail+1)); }
}

# ---------- 阶段 3：控制台 ----------
stage3() {
  echo "[3] 控制台"
  c=$(code_of "$BASE_URL/api/v1/admin/usage/summary"); check "未登录管理端 401" 401 "$c"
}

# ---------- 阶段 4：多协议、护栏、错误体 ----------
stage4() {
  echo "[4] 护栏与错误体"
  # 202 条消息必须能过：Agent 客户端每轮重放整段历史，一次 tool_call 拆两条
  big=$(MODEL="$CHAT_MODEL" python3 -c 'import json,os;print(json.dumps({"model":os.environ["MODEL"],"messages":[{"role":"user","content":"x"}]*202}))')
  c=$(code_of -X POST -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' -d "$big" "$BASE_URL/v1/chat/completions")
  check "202 条消息不被条数护栏拦" 200 "$c"

  # 网关错误必须是 OpenAI 形状，否则原生 SDK 只能显示「API Error: 400」
  body=$(curl -sS -X POST -H "Authorization: Bearer fk_bogus_bogus_bogus" -H 'Content-Type: application/json' \
    -d "$CHAT_BODY" "$BASE_URL/v1/chat/completions")
  contains "401 错误体是 {\"error\":{\"message\",\"type\"}}" '"type":"authentication_error"' "$body"

  body=$(curl -sS -X POST -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
    -d '{"model":"nope-not-here","messages":[{"role":"user","content":"x"}]}' "$BASE_URL/v1/chat/completions")
  contains "未知模型回 invalid_request_error 且带模型名" '"type":"invalid_request_error"' "$body"
}

# ---------- 阶段 5：桌面分发 ----------
stage5() {
  echo "[5] 桌面分发（浏览器回环）"
  # 未登录时应 302 去登录页，绝不能 500；state 缺失时应明确拒绝
  c=$(code_of -o /dev/null "$BASE_URL/desktop/connect?state=abc123&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2Fcb")
  case "$c" in
    302|200) printf '  ✅ 回环入口可访问（%s）\n' "$c"; pass=$((pass+1));;
    4*) printf '  ✅ 回环入口按预期拒绝（%s）\n' "$c"; pass=$((pass+1));;
    *) printf '  ❌ 回环入口返回 %s，检查登录页路由\n' "$c"; fail=$((fail+1));;
  esac
}

# ---------- 阶段 6：可观测与对账 ----------
stage6() {
  echo "[6] 对账"
  curl -sS -H "Authorization: Bearer $API_KEY" "$BASE_URL/v1/wallet/usage?days=7" \
    | jq -e '(.totals.cost_usd|type=="string") and (.daily|type=="array")' >/dev/null \
    && { printf '  ✅ 用量接口形状稳定（金额为字符串，避免 float）\n'; pass=$((pass+1)); } \
       || { printf '  ❌ 用量接口形状变了\n'; fail=$((fail+1)); }
}

CHAT_MODEL="${CHAT_MODEL:-glm-5.3-flash}"
CHAT_BODY="{\"model\":\"$CHAT_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}"

case "$STAGE" in
  1) stage1 ;; 2) stage2 ;; 3) stage3 ;; 4) stage4 ;; 5) stage5 ;; 6) stage6 ;;
  all) stage1; stage2; stage3; stage4; stage5; stage6 ;;
  *) echo "未知阶段：$STAGE"; exit 2 ;;
esac

printf '\n通过 %d，失败 %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
