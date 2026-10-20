//! AIFusion 平台供应商种子数据
//!
//! 本应用只对接 AIFusion 自有平台（OpenAI 兼容网关），启动时由
//! `Database::init_default_official_providers` 为每个客户端写入一条平台供应商，
//! 并（在应用尚无当前供应商时）把它设为当前，做到开箱即用、无第三方供应商。
//!
//! 字段与前端预设保持一致，参见 `src/config/aifusionPlatform.ts` 与各
//! `src/config/*ProviderPresets.ts`。

use crate::app_config::AppType;

pub(crate) const CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID: &str = "claude-desktop-official";
pub(crate) const CODEX_OFFICIAL_PROVIDER_ID: &str = "codex-official";
pub(crate) const GROKBUILD_OFFICIAL_PROVIDER_ID: &str = "grokbuild-official";

/// 平台统一展示名。
const PLATFORM_NAME: &str = "AIFusion";
/// 平台站点地址。
const PLATFORM_SITE: &str = "http://192.168.5.125:8788";

/// ?????????????????????????????? `AIFUSION_API_KEY` ??????????????????????????????????????????????????????
pub(crate) const API_KEY_PLACEHOLDER: &str = "__AIFUSION_API_KEY__";

/// 单条平台供应商种子定义。
pub(crate) struct OfficialProviderSeed {
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
pub(crate) const PLATFORM_SEEDS: &[OfficialProviderSeed] = &[
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
        settings_config_json: r#"{"env":{"ANTHROPIC_BASE_URL":"http://192.168.5.125:8788/v1","ANTHROPIC_AUTH_TOKEN":"__AIFUSION_API_KEY__","ANTHROPIC_MODEL":"hy4-preview","ANTHROPIC_DEFAULT_HAIKU_MODEL":"glm-5.3-flash","ANTHROPIC_DEFAULT_SONNET_MODEL":"hy4-preview","ANTHROPIC_DEFAULT_OPUS_MODEL":"hy4-preview","CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS":"1","CLAUDE_CODE_MAX_CONTEXT_TOKENS":"200000"}}"#,
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
        settings_config_json: r#"{"env":{"ANTHROPIC_BASE_URL":"http://192.168.5.125:8788/v1","ANTHROPIC_AUTH_TOKEN":"__AIFUSION_API_KEY__"}}"#,
        meta_json: Some(
            r#"{"claudeDesktopMode":"proxy","apiFormat":"openai_chat","claudeDesktopModelRoutes":{"claude-sonnet-5":{"model":"hy4-preview","labelOverride":"Hy4 preview"},"claude-opus-5":{"model":"hy4-preview","labelOverride":"Hy4 preview"},"claude-haiku-4-5":{"model":"glm-5.3-flash","labelOverride":"GLM 5.3 Flash"}}}"#,
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
        settings_config_json: r#"{"auth":{"OPENAI_API_KEY":"__AIFUSION_API_KEY__"},"config":"model_provider = \"custom\"\nmodel = \"hy4-preview\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = \"aifusion\"\nbase_url = \"http://192.168.5.125:8788/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true"}"#,
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
        settings_config_json: r#"{"env":{"GOOGLE_GEMINI_BASE_URL":"http://192.168.5.125:8788","GEMINI_API_KEY":"__AIFUSION_API_KEY__","GEMINI_MODEL":"hy4-preview"}}"#,
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
        settings_config_json: r#"{"auth":{"OPENAI_API_KEY":"__AIFUSION_API_KEY__"},"config":"[models]\ndefault = \"aifusion\"\n\n[model.\"aifusion\"]\nmodel = \"hy4-preview\"\nbase_url = \"http://192.168.5.125:8788/v1\"\nname = \"aifusion\"\napi_key = \"__AIFUSION_API_KEY__\"\napi_backend = \"responses\"\ncontext_window = 960000\n"}"#,
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
        settings_config_json: r#"{"npm":"@ai-sdk/openai-compatible","name":"aifusion","options":{"baseURL":"http://192.168.5.125:8788/v1","apiKey":"__AIFUSION_API_KEY__","setCacheKey":true},"models":{"hy4-preview":{"name":"Hy4 preview","reasoning":true},"glm-5.3-flash":{"name":"GLM 5.3 Flash","reasoning":true}}}"#,
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
        settings_config_json: r#"{"baseUrl":"http://192.168.5.125:8788/v1","apiKey":"__AIFUSION_API_KEY__","api":"openai-completions","models":[{"id":"hy4-preview","name":"Hy4 preview","reasoning":true,"input":["text","image"]},{"id":"glm-5.3-flash","name":"GLM 5.3 Flash","reasoning":true,"input":["text"]}]}"#,
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
        settings_config_json: r#"{"name":"aifusion","base_url":"http://192.168.5.125:8788/v1","api_key":"__AIFUSION_API_KEY__","api_mode":"chat_completions","models":[{"id":"hy4-preview","name":"Hy4 preview"},{"id":"glm-5.3-flash","name":"GLM 5.3 Flash"}]}"#,
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
        settings_config_json: r#"{"name":"aifusion","baseUrl":"http://192.168.5.125:8788/v1","api":"openai-completions","apiKey":"__AIFUSION_API_KEY__","models":[{"id":"hy4-preview","name":"Hy4 preview","reasoning":true,"input":["text","image"],"contextWindow":960000,"maxTokens":32000},{"id":"glm-5.3-flash","name":"GLM 5.3 Flash","reasoning":true,"input":["text"],"contextWindow":200000,"maxTokens":32000}]}"#,
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
        settings_config_json: r#"{"name":"aifusion","kind":"custom","enabled":true,"api":"openai-completions","options":{"baseURL":"http://192.168.5.125:8788/v1","apiKey":"__AIFUSION_API_KEY__"},"models":{"hy4-preview":{"name":"Hy4 preview","reasoning":true},"glm-5.3-flash":{"name":"GLM 5.3 Flash","reasoning":true}}}"#,
        meta_json: None,
    },
];

/// 判断给定的 provider id 是否属于内置平台种子。
///
/// 单一事实源：直接扫描 `PLATFORM_SEEDS`，避免在多处重复维护 id 列表。
pub(crate) fn is_official_seed_id(id: &str) -> bool {
    PLATFORM_SEEDS.iter().any(|seed| seed.id == id)
}

/// 返回指定应用对应的平台供应商 id（种子 id）。
pub(crate) fn platform_seed_id_for(app: &AppType) -> Option<&'static str> {
    PLATFORM_SEEDS
        .iter()
        .find(|seed| &seed.app_type == app)
        .map(|seed| seed.id)
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
}
