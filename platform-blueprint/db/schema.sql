-- 平台账本 + 网关元数据：Postgres 16 建表脚本
-- 三条硬规矩写在结构里，不靠约定：
--   1) 钱一律 numeric(18,8)，禁止 float/double
--   2) 用量、扣费流水、余额扣减必须在同一个事务里提交（见文件末尾的示例事务）
--   3) 对外只暴露 OpenAI 风格错误体，控制台内部信封不落在这层

BEGIN;

-- ========== 身份 ==========

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 网关侧 API Key：只存哈希，明文永不落库；key_prefix 用于「按前缀定位 + 常量时间比对哈希」
CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_prefix   text NOT NULL UNIQUE,            -- 形如 'fk_ab12'，可展示
  key_hash     text NOT NULL,                   -- sha256(hex)，绝不存明文
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id) WHERE status = 'active';

-- ========== 路由：模型 → 渠道 + 上游模型名 + 单价 ==========

CREATE TABLE IF NOT EXISTS channels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  base_url   text NOT NULL,
  secret_ref text NOT NULL,                     -- 指向密钥管理（env/KMS），不是明文 Key
  protocol   text NOT NULL CHECK (protocol IN ('openai_chat','openai_responses','anthropic','gemini')),
  status     text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  priority   int  NOT NULL DEFAULT 100,         -- 数字小者优先，用于 fallback 顺序
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,          -- 对外 /v1/models 暴露的 id
  display_name   text NOT NULL,
  provider       text NOT NULL,
  context_window int,
  status         text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_models (
  channel_id     uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  model_id       uuid NOT NULL REFERENCES models(id)   ON DELETE CASCADE,
  upstream_model text NOT NULL,                 -- 上游真实模型名，可能与 slug 不同
  weight         int  NOT NULL DEFAULT 1,
  PRIMARY KEY (channel_id, model_id)
);
-- 路由表按「模型」查，所以给 model_id 单独建索引
CREATE INDEX IF NOT EXISTS idx_channel_models_model ON channel_models(model_id, weight DESC);

-- 价目：同一模型可以有历史价，按 effective_from 取生效行
CREATE TABLE IF NOT EXISTS model_pricing (
  model_id         uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  effective_from   date NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'USD',
  input_per_m      numeric(18,8) NOT NULL DEFAULT 0,   -- 每百万 token 单价
  output_per_m     numeric(18,8) NOT NULL DEFAULT 0,
  cache_read_per_m numeric(18,8) NOT NULL DEFAULT 0,
  cache_write_per_m numeric(18,8) NOT NULL DEFAULT 0,
  PRIMARY KEY (model_id, effective_from)
);

-- ========== 账本（唯一真相源） ==========

CREATE TABLE IF NOT EXISTS wallets (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_usd numeric(18,8) NOT NULL DEFAULT 0 CHECK (balance_usd >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 缓存 token 必须落库，否则「命中率」只能客户端自己算，永远跟账本对不上
CREATE TABLE IF NOT EXISTS usage_records (
  id                 bigserial PRIMARY KEY,
  request_id         uuid NOT NULL UNIQUE,      -- 客户端可传，用于幂等
  user_id            uuid NOT NULL REFERENCES users(id),
  api_key_id         uuid REFERENCES api_keys(id),
  model_id           uuid NOT NULL REFERENCES models(id),
  channel_id         uuid REFERENCES channels(id),
  protocol           text NOT NULL,
  status             text NOT NULL CHECK (status IN ('success','error','canceled')),
  http_status        int,
  input_tokens       bigint NOT NULL DEFAULT 0 CHECK (input_tokens  >= 0),
  output_tokens      bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens  bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens  >= 0),
  cache_write_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_usd           numeric(18,8) NOT NULL DEFAULT 0,  -- 卖给用户的价格
  upstream_cost_usd  numeric(18,8) NOT NULL DEFAULT 0,  -- 上游成本，用于毛利核算
  latency_ms         int,
  first_token_ms     int,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage_records(user_id, created_at) WHERE status = 'success';
CREATE INDEX IF NOT EXISTS idx_usage_key_day  ON usage_records(api_key_id, created_at) WHERE status = 'success';
CREATE INDEX IF NOT EXISTS idx_usage_model    ON usage_records(model_id, created_at);

-- 每一分钱都要能追：流水 + 余额快照 + 幂等键
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users(id),
  kind              text NOT NULL CHECK (kind IN ('debit','topup','refund','adjust')),
  amount_usd        numeric(18,8) NOT NULL,     -- 支出为负、入账为正
  balance_after     numeric(18,8) NOT NULL,     -- 快照，便于对账时二分定位
  usage_record_id   bigint REFERENCES usage_records(id),
  idempotency_key   text UNIQUE,                -- 充值回调重复投递靠它去重
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user_day ON wallet_ledger(user_id, created_at);

-- ========== 对账视图：桌面端 /v1/wallet/usage 就是查它 ==========

CREATE OR REPLACE VIEW v_usage_daily AS
SELECT u.user_id,
       date_trunc('day', u.created_at)::date          AS day,
       count(*)                                       AS requests,
       coalesce(sum(u.input_tokens),0)                AS input_tokens,
       coalesce(sum(u.output_tokens),0)               AS output_tokens,
       coalesce(sum(u.cache_read_tokens),0)           AS cache_read_tokens,
       coalesce(sum(u.input_tokens + u.output_tokens),0) AS tokens,
       coalesce(sum(u.cost_usd),0)                    AS cost_usd
FROM usage_records u
WHERE u.status = 'success'
GROUP BY u.user_id, day;

COMMIT;

-- ========== 一次请求的写入必须是一个事务（应用侧伪代码） ==========
--
--   BEGIN;
--     INSERT INTO usage_records (...) VALUES (...) RETURNING id;
--     UPDATE wallets SET balance_usd = balance_usd - $cost, updated_at = now()
--       WHERE user_id = $uid AND balance_usd >= $cost;      -- 影响行数 0 即余额不足，整个事务回滚
--     INSERT INTO wallet_ledger (user_id, kind, amount_usd, balance_after, usage_record_id)
--       SELECT $uid, 'debit', -$cost, w.balance_usd, $usage_id FROM wallets w WHERE w.user_id = $uid;
--   COMMIT;
--
-- 反例（我们真踩过）：流水一张表、余额一次异步更新，中间任何一步失败就出现
-- 「用量看得到、钱没扣」或「扣了钱、明细为空」。宁可在事务里失败重试，也别拆开写。
