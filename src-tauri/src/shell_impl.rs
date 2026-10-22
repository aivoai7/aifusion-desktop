//! Tauri 壳对引擎 `ShellEvents` 的实现。
//!
//! 引擎只问壳层要五件事：发事件、拿三个 OAuth 状态、拿全局状态、刷托盘，
//! 外加「跑本机工具命令」和「取本机工具版本」。这里把 `tauri::AppHandle`
//! 翻译成这些方法，引擎里就不该再出现任何 `tauri::` 类型。
//!
//! 注册点在 `lib.rs` 的 setup 里：`shell::set_global(Arc::new(TauriShell::new(app)))`。

use std::path::Path;
use std::process::Output;
use std::sync::Arc;
use std::time::Duration;

use aifusion_engine::shell::ShellEvents;
use aifusion_engine::{
    AppState, CodexOAuthState, CopilotAuthState, XaiOAuthState,
};
use serde_json::Value;
use tauri::{Emitter, Manager};

pub struct TauriShell {
    app: tauri::AppHandle,
}

impl TauriShell {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl ShellEvents for TauriShell {
    fn emit(&self, event: &str, payload: Value) -> Result<(), String> {
        self.app
            .emit(event, payload)
            .map_err(|error| error.to_string())
    }

    fn codex_oauth(&self) -> Option<Arc<CodexOAuthState>> {
        // 只克隆里面那个 Arc<CodexOAuthManager>，管理器本身仍然是同一份。
        self.app
            .try_state::<CodexOAuthState>()
            .map(|state| Arc::new(CodexOAuthState(state.0.clone())))
    }

    fn copilot_auth(&self) -> Option<Arc<CopilotAuthState>> {
        self.app
            .try_state::<CopilotAuthState>()
            .map(|state| Arc::new(CopilotAuthState(state.0.clone())))
    }

    fn xai_oauth(&self) -> Option<Arc<XaiOAuthState>> {
        self.app
            .try_state::<XaiOAuthState>()
            .map(|state| Arc::new(XaiOAuthState(state.0.clone())))
    }

    fn app_state(&self) -> Option<AppState> {
        // AppState 全是 Arc / Clone 字段，拿到的句柄和托管的那份指向同一套数据。
        self.app
            .try_state::<AppState>()
            .map(|state| state.inner().clone())
    }

    fn refresh_tray_menu(&self) {
        crate::tray::refresh_tray_menu(&self.app);
    }

    fn schedule_tray_status_check(&self) {
        crate::tray::schedule_tray_status_check(&self.app);
    }

    /// 转发给壳层那份 WSL 感知、npx 多版本的实现，行为与迁移前完全一致。
    fn run_tool_command(
        &self,
        tool: &str,
        args: &[&str],
        timeout: Option<Duration>,
        extra_env: &[(&str, String)],
        working_dir: &Path,
    ) -> Result<Output, String> {
        crate::commands::run_detected_tool_command_with_timeout(
            tool,
            args,
            timeout,
            extra_env,
            working_dir,
        )
    }

    fn tool_version(&self, tool: &str) -> Option<String> {
        crate::commands::local_tool_version(tool)
    }
}
