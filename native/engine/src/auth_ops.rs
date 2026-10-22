//! 认证中心里需要和「切换」互斥的两步操作。
//!
//! 为什么在引擎而不在壳层：这两步只做三件事——拿切换锁、动 OAuth 管理器、解绑供应商，
//! 全都在引擎的对象上（`AppState`、`ProxyService`、`Database`）。放在这里，壳层命令
//! 只剩参数转换；引擎自己的测试也能直接调，不用造一个 `AppHandle`。

use crate::app_config::AppType;
use crate::store::AppState;

/// 删除一个 Codex 托管账号。
///
/// 与受管供应商的增改删/切换/热切换串行：否则一个已经预检过配置包的切换
/// 可能在账号删除后把 `auth.json` 又写回来。
pub async fn remove_codex_oauth_account_with_switch_lock(
    app_state: &AppState,
    account_id: &str,
) -> Result<(), String> {
    let _switch_guard = app_state
        .proxy_service
        .lock_switch_for_app(AppType::Codex.as_str())
        .await;
    app_state
        .codex_oauth_manager
        .remove_account(account_id)
        .await
        .map_err(|error| error.to_string())?;
    app_state
        .db
        .unbind_codex_managed_accounts(&[account_id.to_string()])
        .map_err(|error| {
            format!("账号已删除，但 Codex 供应商解绑失败；请编辑供应商重新选择账号或切换供应商: {error}")
        })?;
    Ok(())
}

/// 登出本机全部 Codex 托管账号。
///
/// 只清本机的：从别的设备同步过来的账号还绑在那台的供应商上，这里不能动。
pub async fn logout_codex_oauth_with_switch_lock(
    app_state: &AppState,
) -> Result<(), String> {
    let _switch_guard = app_state
        .proxy_service
        .lock_switch_for_app(AppType::Codex.as_str())
        .await;
    let removed: Vec<String> = app_state
        .codex_oauth_manager
        .list_accounts()
        .await
        .into_iter()
        .map(|account| account.id)
        .collect();
    app_state
        .codex_oauth_manager
        .clear_auth()
        .await
        .map_err(|error| error.to_string())?;
    app_state
        .db
        .unbind_codex_managed_accounts(&removed)
        .map_err(|error| {
            format!("托管账号已登出，但 Codex 供应商解绑失败；请编辑供应商重新选择账号或切换供应商: {error}")
        })?;
    Ok(())
}
