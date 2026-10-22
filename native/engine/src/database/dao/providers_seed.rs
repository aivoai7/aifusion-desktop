//! AIFusion 平台供应商种子数据
//!
//! 本应用只对接 AIFusion 自有平台（OpenAI 兼容网关），启动时由
//! `Database::init_default_official_providers` 为每个客户端写入一条平台供应商，
//! 并（在应用尚无当前供应商时）把它设为当前，做到开箱即用、无第三方供应商。
//!
//! 字段与前端预设保持一致，参见 `src/config/aifusionPlatform.ts` 与各
//! `src/config/*ProviderPresets.ts`。

use crate::app_config::AppType;

pub const CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID: &str = "claude-desktop-official";
pub const CODEX_OFFICIAL_PROVIDER_ID: &str = "codex-official";
pub const GROKBUILD_OFFICIAL_PROVIDER_ID: &str = "grokbuild-official";

/// 平台统一展示名。
const PLATFORM_NAME: &str = "AIFusion";
/// 平台站点地址。
pub const PLATFORM_SITE: &str = "https://op.aifusion.sbs";

/// 平台密钥在 `settings` 表中的存储键（每用户独立，首次启动时由用户填写）。
pub const API_KEY_SETTING: &str = "aifusion_platform_api_key";

/// seed 模板中的密钥占位符；真实密钥只在运行时写入，不随安装包分发。
pub const API_KEY_PLACEHOLDER: &str = "__AIFUSION_API_KEY__";
/// seed 模板中的站点占位符；运行时替换，避免升级平台地址时到处改硬编码。
pub const SITE_PLACEHOLDER: &str = "__AIFUSION_SITE__";
/// seed 模板中的 API Base 占位符（站点根 + `/v1`）。
pub const BASE_PLACEHOLDER: &str = "__AIFUSION_BASE__";
/// seed 模板中的默认模型占位符；平台换默认模型时只改这里。
pub const MODEL_PLACEHOLDER: &str = "__AIFUSION_MODEL__";
/// 平台当前默认主模型。
pub const PLATFORM_DEFAULT_MODEL: &str = "claude-sonnet-5";
/// 已从平台下架的旧默认模型；启动迁移与原生导入都把它换成当前默认值。
pub const RETIRED_PLATFORM_MODELS: &[&str] = &["hy4-preview", "Hy4 preview"];
/// 旧版内置平台地址；升级时用它识别并迁移既有供应商行。
pub const LEGACY_PLATFORM_SITE: &str = "http://192.168.5.125:8788";

/// 渲染种子 JSON：注入本机密钥、当前平台地址与默认模型。
pub fn render_seed_config(seed: &OfficialProviderSeed, api_key: &str) -> String {
    seed.settings_config_json
        .replace(API_KEY_PLACEHOLDER, api_key)
        .replace(BASE_PLACEHOLDER, &format!("{PLATFORM_SITE}/v1"))
        .replace(SITE_PLACEHOLDER, PLATFORM_SITE)
        .replace(MODEL_PLACEHOLDER, PLATFORM_DEFAULT_MODEL)
}

/// 把供应商配置里残留的旧平台地址换成交付地址；返回是否有改动。
///
/// Pi 等客户端会从本地原生配置回灌，旧文件里可能仍写着局域网网关，
/// 下发新 Key 前必须先归一化，否则 Key 会跟着旧地址一起写进客户端。
pub fn replace_legacy_platform_site(value: &mut serde_json::Value) -> bool {
    fn replace(value: &mut serde_json::Value, from: &str, to: &str) -> bool {
        match value {
            serde_json::Value::String(text) => {
                if text.contains(from) {
                    *text = text.replace(from, to);
                    true
                } else {
                    false
                }
            }
            serde_json::Value::Array(items) => {
                let mut changed = false;
                for item in items {
                    changed |= replace(item, from, to);
                }
                changed
            }
            serde_json::Value::Object(map) => {
                let mut changed = false;
                for item in map.values_mut() {
                    changed |= replace(item, from, to);
                }
                changed
            }
            _ => false,
        }
    }

    replace(value, LEGACY_PLATFORM_SITE, PLATFORM_SITE)
}

/// 把平台已下架的默认模型换成当前默认值；返回是否有改动。
///
/// 平台改版会换掉默认可用模型（`hy4-preview` 已经从 `/v1/models` 下架），而
/// Codex / Grok 的模型名写在 TOML 文本里、Pi 又会从原生 models.json 回灌，
/// 所以种子导入、启动迁移和原生导入都要过一遍。只替换整个字段值或 TOML 里
/// 的 `model = "..."` 行，避免误改 `tencent/hy4-preview` 这类别家同名条目。
pub fn replace_retired_platform_model(value: &mut serde_json::Value) -> bool {
    fn rewrite_toml(text: &str) -> Option<String> {
        let mut changed = false;
        let next = text
            .lines()
            .map(|line| {
                let trimmed = line.trim();
                if trimmed.starts_with('#') {
                    return line.to_string();
                }
                let Some((key, raw_value)) = trimmed.split_once('=') else {
                    return line.to_string();
                };
                if key.trim() != "model" {
                    return line.to_string();
                }
                let current = raw_value.trim().trim_matches('"');
                if RETIRED_PLATFORM_MODELS.contains(&current) {
                    changed = true;
                    return format!("model = \"{PLATFORM_DEFAULT_MODEL}\"");
                }
                line.to_string()
            })
            .collect::<Vec<_>>()
            .join("\n");
        if changed {
            Some(next)
        } else {
            None
        }
    }

    fn walk(value: &mut serde_json::Value) -> bool {
        match value {
            serde_json::Value::String(text) => {
                if RETIRED_PLATFORM_MODELS.contains(&text.as_str()) {
                    *text = PLATFORM_DEFAULT_MODEL.to_string();
                    return true;
                }
                if text.contains("model") && text.contains('\n') {
                    if let Some(next) = rewrite_toml(text) {
                        *text = next;
                        return true;
                    }
                }
                false
            }
            serde_json::Value::Array(items) => {
                // 不能用 `any`：它短路，后面的字段就没机会被检查。
                let mut changed = false;
                for item in items {
                    changed |= walk(item);
                }
                changed
            }
            serde_json::Value::Object(map) => {
                let mut changed = false;
                // OpenCode / Mcode 这类模型表拿模型 id 当键，只改值会留下
                // `"hy4-preview": { "name": "claude-sonnet-5" }` 这种废键，
                // 客户端仍然会把下架模型当可选项列出来。
                for retired in RETIRED_PLATFORM_MODELS {
                    if let Some(entry) = map.remove(*retired) {
                        changed = true;
                        // 已经存在当前默认模型的条目时以现存的为准，废键直接丢弃。
                        map.entry(PLATFORM_DEFAULT_MODEL).or_insert(entry);
                    }
                }
                for item in map.values_mut() {
                    changed |= walk(item);
                }
                changed
            }
            _ => false,
        }
    }

    walk(value)
}

/// 单条平台供应商种子定义。
pub struct OfficialProviderSeed {
    pub id: &'static str,
    pub app_type: AppType,
    pub name: &'static str,
    pub website_url: &'static str,
    pub icon: &'static str,
    pub icon_color: &'static str,
    /// 供应商分类；平台属第三方语义，绝不可是 "official"（否则路由模式会拒切换）。
    pub category: &'static str,
    /// settings_config 的 JSON 字符串，每个 app 结构不同。
    pub settings_config_json: &'static str,
    /// 供应商 meta 的 JSON 字符串（可选）；承载 apiFormat / Claude Desktop 路由映射等。
    pub meta_json: Option<&'static str>,
}

/// 各客户端（claude / claude-desktop / codex / gemini / grokbuild / opencode /
/// openclaw / hermes / pi / mcode）的 AIFusion 平台供应商。
///
/// id 固定，便于幂等检查。`codex-official` / `claude-desktop-official` /
/// `grokbuild-official` 三个 id 沿用既有常量，供后端既有代码引用。
pub const PLATFORM_SEEDS: &[OfficialProviderSeed] = &[
    OfficialProviderSeed {
        id: "claude-official",
        app_type: AppType::Claude,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        // Claude Code 讲 Anthropic Messages，平台只提供 OpenAI 兼容端点，
        // 因此必须经本地代理转换（apiFormat = openai_chat）。
        settings_config_json: r#"{"env":{"ANTHROPIC_BASE_URL":"__AIFUSION_BASE__","ANTHROPIC_AUTH_TOKEN":"__AIFUSION_API_KEY__","ANTHROPIC_MODEL":"__AIFUSION_MODEL__","ANTHROPIC_DEFAULT_HAIKU_MODEL":"glm-5.3-flash","ANTHROPIC_DEFAULT_SONNET_MODEL":"__AIFUSION_MODEL__","ANTHROPIC_DEFAULT_OPUS_MODEL":"__AIFUSION_MODEL__","CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS":"1","CLAUDE_CODE_MAX_CONTEXT_TOKENS":"200000"}}"#,
        meta_json: Some(r#"{"apiFormat":"openai_chat"}"#),
    },
    OfficialProviderSeed {
        id: CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
        app_type: AppType::ClaudeDesktop,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        settings_config_json: r#"{"env":{"ANTHROPIC_BASE_URL":"__AIFUSION_BASE__","ANTHROPIC_AUTH_TOKEN":"__AIFUSION_API_KEY__"}}"#,
        meta_json: Some(
            r#"{"claudeDesktopMode":"proxy","apiFormat":"openai_chat","claudeDesktopModelRoutes":{"claude-sonnet-5":{"model":"__AIFUSION_MODEL__","labelOverride":"__AIFUSION_MODEL__"},"claude-opus-5":{"model":"__AIFUSION_MODEL__","labelOverride":"__AIFUSION_MODEL__"},"claude-haiku-4-5":{"model":"glm-5.3-flash","labelOverride":"GLM 5.3 Flash"}}}"#,
        ),
    },
    OfficialProviderSeed {
        id: CODEX_OFFICIAL_PROVIDER_ID,
        app_type: AppType::Codex,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        // Codex 讲 OpenAI Responses，平台 /v1/responses 可用，直接对接。
        settings_config_json: r#"{"auth":{"OPENAI_API_KEY":"__AIFUSION_API_KEY__"},"config":"model_provider = \"custom\"\nmodel = \"__AIFUSION_MODEL__\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = \"aifusion\"\nbase_url = \"__AIFUSION_BASE__\"\nwire_api = \"responses\"\nrequires_openai_auth = true"}"#,
        meta_json: Some(r#"{"apiFormat":"openai_responses"}"#),
    },
    OfficialProviderSeed {
        id: "gemini-official",
        app_type: AppType::Gemini,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        // 平台无 Gemini native 端点，此页签仅为占位（UI 会标注暂不可用）。
        settings_config_json: r#"{"env":{"GOOGLE_GEMINI_BASE_URL":"__AIFUSION_SITE__","GEMINI_API_KEY":"__AIFUSION_API_KEY__","GEMINI_MODEL":"__AIFUSION_MODEL__"}}"#,
        meta_json: None,
    },
    OfficialProviderSeed {
        id: GROKBUILD_OFFICIAL_PROVIDER_ID,
        app_type: AppType::GrokBuild,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        // Grok CLI 原生 config.toml 形状：[models].default + [model."<name>"] 表
        settings_config_json: r#"{"auth":{"OPENAI_API_KEY":"__AIFUSION_API_KEY__"},"config":"[models]\ndefault = \"aifusion\"\n\n[model.\"aifusion\"]\nmodel = \"__AIFUSION_MODEL__\"\nbase_url = \"__AIFUSION_BASE__\"\nname = \"aifusion\"\napi_key = \"__AIFUSION_API_KEY__\"\napi_backend = \"responses\"\ncontext_window = 960000\n"}"#,
        meta_json: Some(r#"{"apiFormat":"openai_responses"}"#),
    },
    OfficialProviderSeed {
        id: "opencode-official",
        app_type: AppType::OpenCode,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        settings_config_json: r#"{"npm":"@ai-sdk/openai-compatible","name":"aifusion","options":{"baseURL":"__AIFUSION_BASE__","apiKey":"__AIFUSION_API_KEY__","setCacheKey":true},"models":{"__AIFUSION_MODEL__":{"name":"__AIFUSION_MODEL__","reasoning":true},"glm-5.3-flash":{"name":"GLM 5.3 Flash","reasoning":true}}}"#,
        meta_json: None,
    },
    OfficialProviderSeed {
        id: "openclaw-official",
        app_type: AppType::OpenClaw,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        settings_config_json: r#"{"baseUrl":"__AIFUSION_BASE__","apiKey":"__AIFUSION_API_KEY__","api":"openai-completions","models":[{"id":"__AIFUSION_MODEL__","name":"__AIFUSION_MODEL__","reasoning":true,"input":["text","image"]},{"id":"glm-5.3-flash","name":"GLM 5.3 Flash","reasoning":true,"input":["text"]}]}"#,
        meta_json: None,
    },
    OfficialProviderSeed {
        id: "hermes-official",
        app_type: AppType::Hermes,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        settings_config_json: r#"{"name":"aifusion","base_url":"__AIFUSION_BASE__","api_key":"__AIFUSION_API_KEY__","api_mode":"chat_completions","models":[{"id":"__AIFUSION_MODEL__","name":"__AIFUSION_MODEL__"},{"id":"glm-5.3-flash","name":"GLM 5.3 Flash"}]}"#,
        meta_json: None,
    },
    OfficialProviderSeed {
        id: "pi-official",
        app_type: AppType::Pi,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        settings_config_json: r#"{"name":"aifusion","baseUrl":"__AIFUSION_BASE__","api":"openai-completions","apiKey":"__AIFUSION_API_KEY__","models":[{"id":"__AIFUSION_MODEL__","name":"__AIFUSION_MODEL__","reasoning":true,"input":["text","image"],"contextWindow":960000,"maxTokens":32000},{"id":"glm-5.3-flash","name":"GLM 5.3 Flash","reasoning":true,"input":["text"],"contextWindow":200000,"maxTokens":32000}]}"#,
        meta_json: None,
    },
    OfficialProviderSeed {
        id: "mcode-official",
        app_type: AppType::Mcode,
        name: PLATFORM_NAME,
        website_url: PLATFORM_SITE,
        icon: "openai",
        icon_color: "#6366F1",
        category: "third_party",
        settings_config_json: r#"{"name":"aifusion","kind":"custom","enabled":true,"api":"openai-completions","options":{"baseURL":"__AIFUSION_BASE__","apiKey":"__AIFUSION_API_KEY__"},"models":{"__AIFUSION_MODEL__":{"name":"__AIFUSION_MODEL__","reasoning":true},"glm-5.3-flash":{"name":"GLM 5.3 Flash","reasoning":true}}}"#,
        meta_json: None,
    },
];

/// 判断给定的 provider id 是否属于内置平台种子。
///
/// 单一事实源：直接扫描 `PLATFORM_SEEDS`，避免在多处重复维护 id 列表。
pub fn is_official_seed_id(id: &str) -> bool {
    PLATFORM_SEEDS.iter().any(|seed| seed.id == id)
}

/// 返回指定应用对应的平台供应商 id（种子 id）。
pub fn platform_seed_id_for(app: &AppType) -> Option<&'static str> {
    PLATFORM_SEEDS
        .iter()
        .find(|seed| &seed.app_type == app)
        .map(|seed| seed.id)
}

/// 把平台密钥写入某个应用的 `settings_config`。
///
/// 只改密钥字段，保留用户在该供应商行里的其他调整（模型、上下文等）。
/// 返回是否实际发生了修改（便于调用方跳过无意义的数据库写入）。
pub fn apply_api_key(
    app_type: &AppType,
    settings_config: &mut serde_json::Value,
    api_key: &str,
) -> bool {
    match app_type {
        // Claude Code / Claude Desktop：Anthropic 风格 env。
        AppType::Claude | AppType::ClaudeDesktop => {
            set_json_string(settings_config, &["env", "ANTHROPIC_AUTH_TOKEN"], api_key)
        }
        // Codex：auth.json 里的 OpenAI Key。
        AppType::Codex => set_json_string(settings_config, &["auth", "OPENAI_API_KEY"], api_key),
        // Gemini CLI：env 里的 Google 风格 Key。
        AppType::Gemini => set_json_string(settings_config, &["env", "GEMINI_API_KEY"], api_key),
        // Grok Build：auth.json + config.toml 的 `[model.*].api_key` 两处都要换。
        AppType::GrokBuild => {
            let mut changed =
                set_json_string(settings_config, &["auth", "OPENAI_API_KEY"], api_key);
            if let Some(config_text) = settings_config.get("config").and_then(|v| v.as_str()) {
                let updated = replace_toml_api_key(config_text, api_key);
                if updated != config_text {
                    settings_config["config"] = serde_json::Value::String(updated);
                    changed = true;
                }
            }
            changed
        }
        // OpenCode / MiniMax Code：`options.apiKey`。
        AppType::OpenCode | AppType::Mcode => {
            set_json_string(settings_config, &["options", "apiKey"], api_key)
        }
        // OpenClaw / Pi：顶层 `apiKey`。
        AppType::OpenClaw | AppType::Pi => set_json_string(settings_config, &["apiKey"], api_key),
        // Hermes：顶层 `api_key`。
        AppType::Hermes => set_json_string(settings_config, &["api_key"], api_key),
    }
}

/// 按路径写入字符串字段；中间对象不存在时自动补建。
fn set_json_string(value: &mut serde_json::Value, path: &[&str], new_value: &str) -> bool {
    let Some((last, parents)) = path.split_last() else {
        return false;
    };
    let mut current = value;
    for segment in parents {
        let Some(map) = current.as_object_mut() else {
            return false;
        };
        current = map
            .entry((*segment).to_string())
            .or_insert_with(|| serde_json::Value::Object(Default::default()));
    }
    let Some(map) = current.as_object_mut() else {
        return false;
    };
    let new_value = serde_json::Value::String(new_value.to_string());
    if map.get(*last) == Some(&new_value) {
        return false;
    }
    map.insert((*last).to_string(), new_value);
    true
}

/// 替换 Grok Build `config.toml` 里的 `api_key`，优先改 `[models].default` 指向的表。
fn replace_toml_api_key(text: &str, api_key: &str) -> String {
    let Ok(mut doc) = text.parse::<toml_edit::DocumentMut>() else {
        return text.to_string();
    };

    let default_model = doc
        .get("models")
        .and_then(|models| models.get("default"))
        .and_then(|value| value.as_str())
        .map(str::to_string);

    let mut changed = false;
    if let Some(model_tables) = doc.get_mut("model").and_then(|item| item.as_table_mut()) {
        if let Some(name) = default_model.filter(|name| model_tables.contains_key(name)) {
            if let Some(table) = model_tables
                .get_mut(&name)
                .and_then(|item| item.as_table_mut())
            {
                table.insert("api_key", toml_edit::value(api_key));
                changed = true;
            }
        } else {
            // 没有可用的 default 时，退化为替换所有已有的 api_key 表。
            for (_, item) in model_tables.iter_mut() {
                if let Some(table) = item.as_table_mut() {
                    if table.contains_key("api_key") {
                        table.insert("api_key", toml_edit::value(api_key));
                        changed = true;
                    }
                }
            }
        }
    }

    if changed {
        doc.to_string()
    } else {
        text.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_seeds_cover_all_apps() {
        for app in AppType::all() {
            assert!(
                PLATFORM_SEEDS.iter().any(|seed| seed.app_type == app),
                "missing platform seed for {}",
                app.as_str()
            );
        }
    }

    #[test]
    fn platform_seeds_never_use_official_category() {
        // 官方分类会在路由模式下被拒绝切换，平台必须保持第三方语义。
        for seed in PLATFORM_SEEDS {
            assert_ne!(seed.category, "official", "{}", seed.id);
            assert!(is_official_seed_id(seed.id));
        }
    }

    #[test]
    fn platform_seeds_include_claude_desktop_and_grokbuild_ids() {
        assert!(is_official_seed_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID));
        assert!(is_official_seed_id(GROKBUILD_OFFICIAL_PROVIDER_ID));
        assert!(PLATFORM_SEEDS
            .iter()
            .any(|seed| seed.app_type == AppType::ClaudeDesktop));
        assert!(PLATFORM_SEEDS
            .iter()
            .any(|seed| seed.app_type == AppType::GrokBuild));
    }

    fn seed_for(app: AppType) -> &'static OfficialProviderSeed {
        PLATFORM_SEEDS
            .iter()
            .find(|seed| seed.app_type == app)
            .expect("seed exists")
    }

    fn config_of(seed: &OfficialProviderSeed) -> serde_json::Value {
        serde_json::from_str(
            &seed
                .settings_config_json
                .replace(API_KEY_PLACEHOLDER, "initial-key"),
        )
        .expect("seed json")
    }

    /// 每个应用的密钥字段都能被替换，且不会残留旧值。
    #[test]
    fn apply_api_key_updates_every_app() {
        for seed in PLATFORM_SEEDS {
            let mut config = config_of(seed);
            assert!(
                apply_api_key(&seed.app_type, &mut config, "new-key"),
                "{} should report a change",
                seed.id
            );

            let serialized = serde_json::to_string(&config).unwrap();
            assert!(
                serialized.contains("new-key"),
                "{} missing new key: {serialized}",
                seed.id
            );
            assert!(
                !serialized.contains("initial-key"),
                "{} still contains old key: {serialized}",
                seed.id
            );

            // 重复写入同一密钥应被视为无变化。
            assert!(!apply_api_key(&seed.app_type, &mut config, "new-key"));
        }
    }

    #[test]
    fn apply_api_key_creates_missing_objects() {
        let mut config = serde_json::json!({});
        assert!(apply_api_key(&AppType::OpenCode, &mut config, "fresh-key"));
        assert_eq!(config["options"]["apiKey"], "fresh-key");
    }

    #[test]
    fn apply_api_key_only_touches_the_default_grok_model_table() {
        let seed = seed_for(AppType::GrokBuild);
        let mut config = config_of(seed);
        config["config"] = serde_json::Value::String(
            "[models]\ndefault = \"aifusion\"\n\n[model.\"aifusion\"]\napi_key = \"old-a\"\n\n[model.\"other\"]\napi_key = \"old-b\"\n"
                .to_string(),
        );

        assert!(apply_api_key(&seed.app_type, &mut config, "grok-key"));
        let text = config["config"].as_str().unwrap();
        assert!(text.contains("api_key = \"grok-key\""));
        assert!(
            text.contains("api_key = \"old-b\""),
            "other model table must stay untouched: {text}"
        );
        assert_eq!(config["auth"]["OPENAI_API_KEY"], "grok-key");
    }
    #[test]
    fn retired_platform_model_is_replaced_everywhere_it_appears() {
        use serde_json::json;

        // 角色环境变量、模型表、TOML 文本三种写法都要换掉。
        let mut claude = json!({"env": {"ANTHROPIC_MODEL": "hy4-preview"}});
        assert!(replace_retired_platform_model(&mut claude));
        assert_eq!(claude["env"]["ANTHROPIC_MODEL"], json!(PLATFORM_DEFAULT_MODEL));

        let mut table = json!({"models": [{"id": "hy4-preview", "name": "Hy4 preview"}]});
        assert!(replace_retired_platform_model(&mut table));
        assert_eq!(table["models"][0]["id"], json!(PLATFORM_DEFAULT_MODEL));
        assert_eq!(table["models"][0]["name"], json!(PLATFORM_DEFAULT_MODEL));

        let mut toml_text = json!({"config": "model_provider = \"custom\"
model = \"hy4-preview\"
model_reasoning_effort = \"high\"
"});
        assert!(replace_retired_platform_model(&mut toml_text));
        let text = toml_text["config"].as_str().expect("toml");
        assert!(text.contains(&format!("model = \"{PLATFORM_DEFAULT_MODEL}\"")), "{text}");
        assert!(text.contains("model_provider = \"custom\""), "{text}");
        assert!(text.contains("model_reasoning_effort"), "{text}");
    }

    #[test]
    fn retired_platform_model_key_is_renamed_in_model_tables() {
        use serde_json::json;

        // OpenCode 形状：模型 id 是键，只改值会留下废键。
        let mut keyed = json!({"models": {"hy4-preview": {"name": "claude-sonnet-5", "reasoning": true}}});
        assert!(replace_retired_platform_model(&mut keyed));
        let models = keyed["models"].as_object().expect("map");
        assert!(!models.contains_key("hy4-preview"), "{models:?}");
        assert_eq!(
            models[PLATFORM_DEFAULT_MODEL]["reasoning"],
            json!(true),
            "条目内容要跟着键一起搬过去: {models:?}"
        );

        // 同一张表里已有当前默认模型时，保留现存条目，废键丢弃。
        let mut dup = json!({"models": {
            "hy4-preview": {"name": "旧条目"},
            "claude-sonnet-5": {"name": "现条目"}
        }});
        assert!(replace_retired_platform_model(&mut dup));
        let models = dup["models"].as_object().expect("map");
        assert_eq!(models.len(), 1, "{models:?}");
        assert_eq!(models[PLATFORM_DEFAULT_MODEL]["name"], json!("现条目"));
    }

    #[test]
    fn other_vendors_retired_named_models_are_left_alone() {
        use serde_json::json;

        // 别家前缀的同名条目（tencent/hy4-preview）不是平台默认模型，不能改。
        let mut other = json!({"models": {"tencent/hy4-preview": {"name": "Hy4 别家"}}});
        assert!(!replace_retired_platform_model(&mut other));
        assert!(other["models"]
            .as_object()
            .expect("map")
            .contains_key("tencent/hy4-preview"));

        let mut kept = json!({"env": {"ANTHROPIC_MODEL": "glm-5.3-flash"}});
        assert!(!replace_retired_platform_model(&mut kept));
        assert_eq!(kept["env"]["ANTHROPIC_MODEL"], json!("glm-5.3-flash"));
    }
}
