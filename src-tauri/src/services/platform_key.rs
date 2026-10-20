//! 平台密钥：登录平台后自动获取、下发与校验。
//!
//! 安装包不携带任何平台密钥。首次启动时客户端用平台面板账号登录，向平台
//! 自动取一把可用的 API Key，存进 SQLite `settings`，再写入十个客户端页签
//! 下的「AIFusion 平台」供应商行，并立即重投影当前供应商的 live 配置。
//! 用户不需要手动复制 Key。
//!
//! 设计要点：
//! - 数据库是唯一事实源；环境变量 `AIFUSION_API_KEY` 只作为托管部署的兜底，
//!   平台登录取到的密钥永远优先。
//! - 只改各供应商行里的密钥字段，保留用户对模型 / 上下文的调整。
//! - 保存成功后按应用重投影；Pi 走自己的 `models.json` 通道。

use serde::Serialize;

use crate::app_config::AppType;
use crate::database::{
    apply_api_key, replace_legacy_platform_site, replace_retired_platform_model, Database,
    API_KEY_SETTING, PLATFORM_SEEDS, PLATFORM_SITE,
};
use crate::error::AppError;
use crate::mode::current::{provider_for, Purpose};
use crate::services::provider::ProviderService;
use crate::store::AppState;

/// 平台密钥来源。
const SOURCE_USER: &str = "user";
const SOURCE_ENVIRONMENT: &str = "environment";

/// 平台密钥状态（不返回明文）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformKeyStatus {
    pub configured: bool,
    /// 形如 `abcd…wxyz` 的脱敏展示。
    pub masked_key: Option<String>,
    /// `user` / `environment`；未配置时为 `None`。
    pub source: Option<String>,
    pub base_url: String,
}

/// 保存密钥后的下发结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformKeyApplyResult {
    /// 实际改写密钥字段的供应商行数。
    pub updated_providers: usize,
    /// 成功重投影 live 配置的应用。
    pub synced_apps: Vec<String>,
    /// 重投影失败的应用及原因（密钥已保存，但不一定已生效）。
    pub sync_failures: Vec<String>,
}

/// 密钥校验结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformKeyValidation {
    pub valid: bool,
    pub message: String,
    pub http_status: Option<u16>,
}

/// 登录平台并自动取 Key、下发后的结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLoginResult {
    /// 实际改写密钥字段的供应商行数。
    pub updated_providers: usize,
    /// 成功重投影 live 配置的应用。
    pub synced_apps: Vec<String>,
    /// 重投影失败的应用及原因。
    pub sync_failures: Vec<String>,
    /// 取到的那把平台 API Key 的名称。
    pub key_name: String,
    /// 脱敏后的密钥，方便界面确认。
    pub masked_key: String,
}

/// 网页登录后取到的密钥（仅在后端内部流转）。
pub struct FetchedPlatformKey {
    pub key: String,
    pub name: String,
}

/// 读取本机保存的密钥（去空白）。
fn stored_api_key(db: &Database) -> Option<String> {
    db.get_setting(API_KEY_SETTING)
        .ok()
        .flatten()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

/// 环境变量兜底（托管 / CI 部署用）。
fn environment_api_key() -> Option<String> {
    std::env::var("AIFUSION_API_KEY")
        .ok()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

pub(crate) fn resolve_api_key(db: &Database) -> Option<(String, &'static str)> {
    if let Some(key) = stored_api_key(db) {
        return Some((key, SOURCE_USER));
    }
    environment_api_key().map(|key| (key, SOURCE_ENVIRONMENT))
}

fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "•".repeat(chars.len().max(4));
    }
    let prefix: String = chars.iter().take(4).collect();
    let suffix: String = chars.iter().skip(chars.len() - 4).collect();
    format!("{prefix}…{suffix}")
}

pub(crate) fn masked_key(key: &str) -> String {
    mask_key(key)
}

/// 当前平台密钥状态。
pub fn status(db: &Database) -> PlatformKeyStatus {
    match resolve_api_key(db) {
        Some((key, source)) => PlatformKeyStatus {
            configured: true,
            masked_key: Some(mask_key(&key)),
            source: Some(source.to_string()),
            base_url: PLATFORM_SITE.to_string(),
        },
        None => PlatformKeyStatus {
            configured: false,
            masked_key: None,
            source: None,
            base_url: PLATFORM_SITE.to_string(),
        },
    }
}

/// 校验密钥是否被平台接受。
///
/// 用 `GET /v1/models`（带 Bearer）做一次轻量鉴权探测：200/204 视为有效，
/// 401/403 视为密钥错误，其余状态与网络错误原样反馈给 UI。
pub async fn validate(api_key: &str) -> PlatformKeyValidation {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return PlatformKeyValidation {
            valid: false,
            message: "API Key 不能为空".to_string(),
            http_status: None,
        };
    }

    let url = format!("{}/v1/models", PLATFORM_SITE.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return PlatformKeyValidation {
                valid: false,
                message: format!("无法初始化网络请求：{error}"),
                http_status: None,
            }
        }
    };

    match client.get(&url).bearer_auth(api_key).send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                PlatformKeyValidation {
                    valid: true,
                    message: "密钥有效".to_string(),
                    http_status: Some(status.as_u16()),
                }
            } else if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                PlatformKeyValidation {
                    valid: false,
                    message: "密钥无效或已失效，请向平台管理员确认".to_string(),
                    http_status: Some(status.as_u16()),
                }
            } else {
                PlatformKeyValidation {
                    valid: false,
                    message: format!("平台返回异常状态：HTTP {}", status.as_u16()),
                    http_status: Some(status.as_u16()),
                }
            }
        }
        Err(_) => PlatformKeyValidation {
            valid: false,
            message: "无法连接平台，请检查网络后重试".to_string(),
            http_status: None,
        },
    }
}

/// 平台钱包余额（美元）。
///
/// 桌面端只有下发到的 API Key，没有浏览器会话 Cookie，所以走网关的
/// `GET /v1/wallet/balance`。未登录、或平台版本还没有这个接口时返回 `None`，
/// 侧栏保留占位；其余失败原样回传给前端展示。
pub async fn fetch_wallet_balance(db: &Database) -> Result<Option<f64>, String> {
    let Some((api_key, _)) = resolve_api_key(db) else {
        return Ok(None);
    };

    let url = format!("{}/v1/wallet/balance", PLATFORM_SITE.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|error| format!("无法初始化网络请求：{error}"))?;

    let response = match client.get(&url).bearer_auth(&api_key).send().await {
        Ok(response) => response,
        Err(_) => return Err("无法连接平台，请检查网络后重试".to_string()),
    };
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::METHOD_NOT_ALLOWED
    {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!("查询钱包余额失败：HTTP {}", status.as_u16()));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("平台返回的钱包余额无法解析：{error}"))?;
    match body.get("balance_usd").and_then(serde_json::Value::as_f64) {
        Some(balance) => Ok(Some(balance)),
        None => Err("平台返回的钱包余额格式不正确".to_string()),
    }
}

/// 保存密钥并下发到所有平台的供应商行，随后重投影当前供应商的 live 配置。
pub fn set_api_key(state: &AppState, api_key: &str) -> Result<PlatformKeyApplyResult, AppError> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(AppError::InvalidInput("API Key 不能为空".to_string()));
    }
    state.db.set_setting(API_KEY_SETTING, api_key)?;
    apply_to_all_seeds(state, api_key)
}

/// 清除本机密钥（供应商行里的密钥字段同步清空；托管环境仍保留环境变量兜底）。
pub fn clear_api_key(state: &AppState) -> Result<PlatformKeyApplyResult, AppError> {
    state.db.set_setting(API_KEY_SETTING, "")?;
    let effective = environment_api_key().unwrap_or_default();
    apply_to_all_seeds(state, &effective)
}

fn apply_to_all_seeds(state: &AppState, api_key: &str) -> Result<PlatformKeyApplyResult, AppError> {
    let mut updated_providers = 0_usize;

    for seed in PLATFORM_SEEDS {
        let app_type = &seed.app_type;
        let app = app_type.as_str();

        if state.db.get_provider_by_id(seed.id, app)?.is_none() {
            // 用户删过或被迁移清理过：补回平台行（会使用刚保存的密钥）。
            state
                .db
                .ensure_official_seed_by_id(seed.id, app_type.clone())?;
            updated_providers += 1;
            continue;
        }

        let Some(provider) = state.db.get_provider_by_id(seed.id, app)? else {
            continue;
        };
        let mut settings_config = provider.settings_config.clone();
        // 原生配置可能把旧版局域网地址回灌进数据库（Pi 每次列表刷新都会同步），
        // 下发 Key 前先归一化，避免新 Key 被写进旧网关。平台下架的旧模型同理。
        let endpoint_changed = replace_legacy_platform_site(&mut settings_config);
        let model_changed = replace_retired_platform_model(&mut settings_config);
        let key_changed = apply_api_key(app_type, &mut settings_config, api_key);
        if endpoint_changed || model_changed || key_changed {
            state
                .db
                .update_provider_settings_config(app, seed.id, &settings_config)?;
            updated_providers += 1;
            // Pi 的 live 是独立的 models.json：先改原生文件，否则下面切换时
            // 会拿旧的（空 Key）原生配置把数据库覆盖回去。
            if matches!(app_type, AppType::Pi) {
                if let Err(error) =
                    crate::pi_config::replace_pi_provider_if_present(seed.id, &settings_config)
                {
                    log::warn!("Pi models.json 同步平台密钥失败: {error}");
                }
            }
        }
    }

    // 只重投影「当前就是平台供应商」的应用：其余应用的 live 与这次改动无关，
    // 等用户切回平台供应商时自然会用上新密钥。
    let mut synced_apps = Vec::new();
    let mut sync_failures = Vec::new();

    for seed in PLATFORM_SEEDS {
        let app = &seed.app_type;
        let current = provider_for(state.db.as_ref(), app, Purpose::InUse).unwrap_or(None);
        if current.as_deref() != Some(seed.id) {
            continue;
        }

        // Pi 的 live 是独立的 models.json，只能通过它自己的启用流程写。
        let result = if matches!(app, AppType::Pi) {
            ProviderService::switch(state, app.clone(), seed.id).map(|_| ())
        } else {
            ProviderService::sync_current_provider_for_app(state, app.clone())
        };

        match result {
            Ok(()) => synced_apps.push(app.as_str().to_string()),
            Err(error) => {
                log::warn!("平台密钥写 live 失败（{}）: {error}", app.as_str());
                sync_failures.push(format!("{}: {error}", app.as_str()));
            }
        }
    }

    log::info!(
        "✓ Platform API key applied: providers={}, synced={}, failures={}",
        updated_providers,
        synced_apps.len(),
        sync_failures.len()
    );

    Ok(PlatformKeyApplyResult {
        updated_providers,
        synced_apps,
        sync_failures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_keeps_only_edges() {
        assert_eq!(mask_key("abcd1234efgh"), "abcd…efgh");
        assert_eq!(mask_key("short"), "•••••");
    }

    #[test]
    #[serial_test::serial]
    fn set_api_key_replaces_legacy_platform_endpoint_before_writing_key() {
        use crate::provider::Provider;
        use serde_json::json;

        let _agent = crate::pi_config::test_support::TestAgentDir::new();
        let state = AppState::new(std::sync::Arc::new(
            Database::memory().expect("create in-memory database"),
        ));
        let legacy_site = "http://192.168.5.125:8788";
        let provider = Provider::with_id(
            "pi-official".to_string(),
            "aifusion".to_string(),
            json!({
                "name": "aifusion",
                "baseUrl": format!("{legacy_site}/v1"),
                "api": "openai-completions",
                "apiKey": "old-key",
                "models": []
            }),
            Some(legacy_site.to_string()),
        );
        state
            .db
            .save_provider("pi", &provider)
            .expect("seed legacy Pi row");

        set_api_key(&state, "new-key").expect("apply platform key");

        let saved = state
            .db
            .get_provider_by_id("pi-official", "pi")
            .expect("read Pi row")
            .expect("Pi row exists");
        assert_eq!(
            saved
                .settings_config
                .get("baseUrl")
                .and_then(|v| v.as_str()),
            Some("https://op.aifusion.sbs/v1")
        );
        assert_eq!(
            saved.settings_config.get("apiKey").and_then(|v| v.as_str()),
            Some("new-key")
        );
    }
}
