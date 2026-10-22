//! AIFusion 引擎：读写各家 CLI 的配置、跑 15721 本地代理、切换路由/直连。
//!
//! 这一层原来整个长在 `src-tauri/src` 里，靠 `tauri::AppHandle` 到处发事件、
//! 拿状态。搬进独立 crate 后，壳层（Tauri 版和原生 iced 版）通过 [`shell::ShellEvents`]
//! 提供「发事件、OAuth 状态、托盘刷新、跑外部命令」四类能力，引擎不再知道对面是谁。
//!
//! 模块边界：
//! - [`config`] / 各 `*_config`：磁盘上真实配置文件的读写口径（TOML/JSONC/YAML）。
//! - [`database`]：SQLite 单一事实来源（供应商、档案、MCP、技能、用量）。
//! - [`mode`]：路由 / 直连模式控制器。
//! - [`proxy`]：`127.0.0.1:15721` 转发服务与各家 provider 适配。
//! - [`services`]：面向界面的业务服务层，壳层命令基本只做参数转换再调这里。
//! - [`session_manager`]：会话读取与终端启动。
//! - [`log_safe`]：日志脱敏，密钥只在已知值上做精确替换。

pub mod app_config;
pub mod async_rt;
pub mod auth_ops;
pub mod auto_launch;
pub mod claude_desktop_config;
pub mod claude_mcp;
pub mod claude_plugin;
pub mod codex_config;
pub mod codex_history_migration;
pub mod codex_rollout_file;
pub mod codex_state_db;
pub mod config;
pub mod database;
pub mod deeplink;
pub mod error;
pub mod gemini_config;
pub mod gemini_mcp;
pub mod grok_config;
pub mod hermes_config;
pub mod init_status;
pub mod jsonc_document;
pub mod live;
pub mod mcode_config;
pub mod mcp;
pub mod mode;
pub mod model_capabilities;
pub mod oauth_state;
pub mod openclaw_config;
pub mod opencode_config;
pub mod panic_hook;
pub mod pi_config;
pub mod prompt;
pub mod prompt_files;
pub mod provider;
pub mod proxy;
pub mod paths;
pub mod services;
pub mod session_manager;
pub mod settings;
pub mod store;
pub mod tool_exec;
pub mod usage_events;
pub mod usage_script;

pub mod log_safe;
pub mod shell;

pub use app_config::{AppType, InstalledSkill, McpApps, McpServer, MultiAppConfig, SkillApps};
pub use async_rt::{block_on, spawn};
pub use codex_config::{
    extract_codex_experimental_bearer_token, get_codex_auth_path, get_codex_config_path,
    read_codex_live_settings, write_codex_live_atomic,
};
pub use config::{
    get_app_config_path, get_claude_mcp_path, get_claude_settings_path, read_json_file,
};
pub use database::{Database, Profile};
pub use deeplink::{import_provider_from_deeplink, parse_deeplink_url, DeepLinkImportRequest};
pub use error::AppError;
pub use grok_config::get_grok_config_path;
pub use log_safe::*;
pub use mcp::{
    import_from_claude, import_from_codex, import_from_gemini, import_from_grokbuild,
    remove_server_from_claude, remove_server_from_codex, remove_server_from_gemini,
    remove_server_from_grokbuild, sync_enabled_to_claude, sync_enabled_to_codex,
    sync_enabled_to_gemini, sync_single_server_to_claude, sync_single_server_to_codex,
    sync_single_server_to_gemini, sync_single_server_to_grokbuild,
};
pub use oauth_state::{CodexOAuthState, CopilotAuthState, XaiOAuthState};
pub use prompt::Prompt;
pub use provider::{Provider, ProviderMeta};
pub use services::{
    profile::{ProfilePayload, ProfileScope, ProfileService},
    provider::{reapply_current_codex_official_live, EditorSave, EditorView},
    skill::{migrate_skills_to_ssot, ImportSkillSelection},
    ConfigService, EndpointLatency, McpService, PromptService, ProviderService, ProxyService,
    SkillService, SpeedtestService,
};
pub use settings::{update_settings, AppSettings};
pub use shell::{emit_json, NullShell, ShellEvents};
pub use store::AppState;
pub use tool_exec::{decode_command_output, locate_tool, run_detected_tool_command, tool_version};

/// 从干净的 live 配置里自动抽取「通用配置片段」，并把老版本的遗留用法迁移掉。
///
/// 必须在启动时重新挂代理之前跑：否则读到的是代理占位配置而不是用户的真实设置；
/// 更新重启后仍挂在代理上的客户端也跳过。
pub fn initialize_common_config_snippets(state: &store::AppState) {
    for app_type in AppType::all() {
        if !state
            .db
            .should_auto_extract_config_snippet(app_type.as_str())
            .unwrap_or(false)
        {
            continue;
        }
        if state.proxy_service.live_has_proxy_placeholder(&app_type) {
            continue;
        }

        let settings = match services::provider::ProviderService::read_live_settings(
            app_type.clone(),
        ) {
            Ok(current) => current,
            Err(_) => continue,
        };

        match services::provider::ProviderService::extract_common_config_snippet_from_settings(
            app_type.clone(),
            &settings,
        ) {
            Ok(snippet) if !snippet.is_empty() && snippet != "{}" => {
                match state.db.set_config_snippet(app_type.as_str(), Some(snippet)) {
                    Ok(()) => {
                        let _ = state
                            .db
                            .set_config_snippet_cleared(app_type.as_str(), false);
                        log::info!(
                            "✓ Auto-extracted common config snippet for {}",
                            app_type.as_str()
                        );
                    }
                    Err(e) => log::warn!(
                        "✗ Failed to save config snippet for {}: {e}",
                        app_type.as_str()
                    ),
                }
            }
            Ok(_) => log::debug!(
                "○ Live config for {} has no extractable common fields",
                app_type.as_str()
            ),
            Err(e) => log::warn!(
                "✗ Failed to extract config snippet for {}: {e}",
                app_type.as_str()
            ),
        }
    }

    let should_run_legacy_migration = state
        .db
        .is_legacy_common_config_migrated()
        .map(|done| !done)
        .unwrap_or(true);

    if should_run_legacy_migration {
        for app_type in [AppType::Claude, AppType::Codex, AppType::Gemini] {
            if let Err(e) =
                services::provider::ProviderService::migrate_legacy_common_config_usage_if_needed(
                    state,
                    app_type.clone(),
                )
            {
                log::warn!(
                    "✗ Failed to migrate legacy common-config usage for {}: {e}",
                    app_type.as_str()
                );
            }
        }

        if let Err(e) = state.db.set_legacy_common_config_migrated(true) {
            log::warn!("✗ Failed to persist legacy common-config migration flag: {e}");
        }
    }
}
