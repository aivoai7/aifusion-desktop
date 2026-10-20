//! 平台密钥命令：状态查询、校验、保存与清除。

use std::str::FromStr;

use tauri::{AppHandle, Manager};

use crate::services::platform_key::{
    self, FetchedPlatformKey, PlatformKeyApplyResult, PlatformKeyStatus, PlatformKeyValidation,
    PlatformLoginResult,
};
use crate::services::platform_model;
use crate::store::AppState;

/// 当前平台密钥状态（脱敏，不回传明文）。
#[tauri::command]
pub async fn get_platform_api_key_status(
    state: tauri::State<'_, AppState>,
) -> Result<PlatformKeyStatus, String> {
    Ok(platform_key::status(state.db.as_ref()))
}

/// 在系统默认浏览器打开平台官网登录，登录成功后自动取 Key 并下发。
///
/// 用户在桌面端取消等待时返回 `None`；其余错误原样回传前端。
#[tauri::command]
pub async fn login_platform_web(
    app_handle: AppHandle,
) -> Result<Option<PlatformLoginResult>, String> {
    let Some(api_key) = crate::services::platform_login::open_login_in_browser(&app_handle).await?
    else {
        return Ok(None);
    };

    // 官网页面里已经用 /v1/models 验过一次；这里再验一次，避免中途被吊销。
    let validation = platform_key::validate(&api_key).await;
    if !validation.valid {
        return Err(validation.message);
    }

    let fetched = FetchedPlatformKey {
        key: api_key,
        name: "AIFusion".to_string(),
    };
    apply_fetched_key(&app_handle, fetched).await.map(Some)
}

/// 取消正在等待的浏览器登录。
#[tauri::command]
pub async fn cancel_platform_web_login() -> Result<bool, String> {
    Ok(crate::services::platform_login::cancel_pending_login())
}

/// 侧栏钱包余额（美元）；未登录或平台还没有钱包接口时返回 `None`。
#[tauri::command]
pub async fn get_platform_wallet_balance(
    state: tauri::State<'_, AppState>,
) -> Result<Option<f64>, String> {
    platform_key::fetch_wallet_balance(state.db.as_ref()).await
}

async fn apply_fetched_key(
    app_handle: &AppHandle,
    fetched: FetchedPlatformKey,
) -> Result<PlatformLoginResult, String> {
    let state = app_handle
        .try_state::<AppState>()
        .ok_or_else(|| "应用状态不可用".to_string())?;

    // Claude Desktop 的平台卡带模型映射，直连写不进去；先把 Desktop 切到本机路由，
    // 由本地代理做 Anthropic ↔ OpenAI 转换。这样下一步下发 Key 时走的是路由投影，
    // 不会先报一次「直连不支持」。
    let desktop_failure = match crate::mode::controller::enter_with_route(
        state.inner(),
        &crate::app_config::AppType::ClaudeDesktop,
        false,
        Some(crate::database::CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID),
    )
    .await
    {
        Ok(()) => None,
        Err(error) => Some(error),
    };

    let handle = app_handle.clone();
    let mut result =
        tauri::async_runtime::spawn_blocking(move || -> Result<PlatformLoginResult, String> {
            let state = handle
                .try_state::<AppState>()
                .ok_or_else(|| "应用状态不可用".to_string())?;
            let applied = platform_key::set_api_key(state.inner(), &fetched.key)
                .map_err(|e| e.to_string())?;
            Ok(PlatformLoginResult {
                updated_providers: applied.updated_providers,
                synced_apps: applied.synced_apps,
                sync_failures: applied.sync_failures,
                key_name: fetched.name,
                masked_key: platform_key::masked_key(&fetched.key),
            })
        })
        .await
        .map_err(|error| format!("保存平台密钥任务执行失败: {error}"))??;

    match desktop_failure {
        None => {
            if !result.synced_apps.iter().any(|app| app == "claude-desktop") {
                result.synced_apps.push("claude-desktop".to_string());
            }
        }
        Some(error) => {
            result.synced_apps.retain(|app| app != "claude-desktop");
            result
                .sync_failures
                .retain(|failure| !failure.starts_with("claude-desktop"));
            result
                .sync_failures
                .push(format!("claude-desktop: {error}"));
        }
    }

    Ok(result)
}

/// 校验平台密钥是否可用（GET /v1/models）。
#[tauri::command]
pub async fn validate_platform_api_key(api_key: String) -> Result<PlatformKeyValidation, String> {
    Ok(platform_key::validate(&api_key).await)
}

/// 保存平台密钥并下发到所有应用的平台供应商。
#[tauri::command]
pub async fn set_platform_api_key(
    app_handle: AppHandle,
    api_key: String,
) -> Result<PlatformKeyApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle
            .try_state::<AppState>()
            .ok_or_else(|| "应用状态不可用".to_string())?;
        platform_key::set_api_key(state.inner(), &api_key).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("保存平台密钥任务执行失败: {e}"))?
}

/// 清除本机保存的平台密钥。
#[tauri::command]
pub async fn clear_platform_api_key(
    app_handle: AppHandle,
) -> Result<PlatformKeyApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle
            .try_state::<AppState>()
            .ok_or_else(|| "应用状态不可用".to_string())?;
        platform_key::clear_api_key(state.inner()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("清除平台密钥任务执行失败: {e}"))?
}

/// 返回平台站点地址，供首次引导展示（避免前端再硬编码一份）。
#[tauri::command]
pub async fn get_platform_site() -> Result<String, String> {
    Ok(crate::database::PLATFORM_SITE.to_string())
}

/// 平台可用模型列表（密钥只在本机解析，不回传前端）。
#[tauri::command]
pub async fn get_platform_models(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<platform_model::PlatformModelOption>, String> {
    platform_model::fetch_models(state.db.as_ref()).await
}

/// 某个客户端当前的平台模型配置（主模型 / 轻量模型 / 可用模型列表）。
#[tauri::command]
pub async fn get_platform_model_config(
    app: String,
    app_handle: AppHandle,
) -> Result<platform_model::PlatformModelConfig, String> {
    let app_type = crate::app_config::AppType::from_str(&app).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle
            .try_state::<AppState>()
            .ok_or_else(|| "应用状态不可用".to_string())?;
        platform_model::current_config(state.inner(), &app_type).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("读取平台模型配置任务执行失败: {e}"))?
}

/// 保存平台模型选择：写入该客户端的平台供应商，并在正使用平台时立刻重投影 live。
#[tauri::command(rename_all = "camelCase")]
pub async fn set_platform_model(
    app: String,
    default_model: Option<String>,
    light_model: Option<String>,
    models: Option<Vec<String>>,
    app_handle: AppHandle,
) -> Result<platform_model::PlatformModelApplyResult, String> {
    let app_type = crate::app_config::AppType::from_str(&app).map_err(|e| e.to_string())?;
    let request = platform_model::PlatformModelRequest {
        default_model,
        light_model,
        models,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle
            .try_state::<AppState>()
            .ok_or_else(|| "应用状态不可用".to_string())?;
        platform_model::apply(state.inner(), &app_type, request).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("保存平台模型任务执行失败: {e}"))?
}
