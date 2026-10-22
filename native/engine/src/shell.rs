//! 引擎对壳层的要求：只有三件事——发事件、拿 OAuth 状态、刷托盘。
//!
//! 引擎里原来到处传 `tauri::AppHandle`，那是把整个 Tauri 壳拖进了不该依赖它的层。
//! 换成这个 trait 后：Tauri 壳用一小段 impl 适配（`emit` 转 `Emitter::emit`），
//! 原生 iced 壳用 mpsc 通道适配，两边都不需要引擎知道对方是谁。

use std::path::Path;
use std::process::Output;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::oauth_state::{CodexOAuthState, CopilotAuthState, XaiOAuthState};

/// 壳层能力集合。实现者必须 `Send + Sync`，因为代理在 tokio 多线程运行时里调用它。
pub trait ShellEvents: Send + Sync {
    /// 向前端 / 界面推一个事件。原生壳里就是往 iced 的订阅通道塞一条消息。
    fn emit(&self, event: &str, payload: Value) -> Result<(), String>;

    /// Codex OAuth 状态；没注册就返回 None（调用方按「不可用」处理）。
    fn codex_oauth(&self) -> Option<Arc<CodexOAuthState>> {
        None
    }

    /// GitHub Copilot 认证状态。
    fn copilot_auth(&self) -> Option<Arc<CopilotAuthState>> {
        None
    }

    /// xAI OAuth 状态。
    fn xai_oauth(&self) -> Option<Arc<XaiOAuthState>> {
        None
    }

    /// 托盘菜单需要重建（切换供应商之后角标变了）。没有托盘的壳保持空实现。
    fn refresh_tray_menu(&self) {}

    /// 让壳层自己复查一次托盘上的运行状态。
    fn schedule_tray_status_check(&self) {}

    /// 壳层托管的全局状态（数据库 + 各服务）。
    ///
    /// Tauri 版里它就是 `app.state::<AppState>()` 的一份句柄拷贝（AppState 全是 Arc /
    /// Clone 字段，克隆出来的和托管的那份指向同一套数据）；原生版由 iced 的 boot 建好后
    /// 直接返回。拿不到就返回 None，调用方按「无壳层状态可用」降级，不能 panic。
    fn app_state(&self) -> Option<crate::store::AppState> {
        None
    }

    /// 跑一次已安装工具的命令。默认走 [`crate::tool_exec`]：PATH 查找 + 直跑。
    /// Tauri 壳覆盖成它原本那份 WSL 感知、npx 多版本的实现。
    fn run_tool_command(
        &self,
        tool: &str,
        args: &[&str],
        timeout: Option<Duration>,
        extra_env: &[(&str, String)],
        working_dir: &Path,
    ) -> Result<Output, String> {
        crate::tool_exec::run_detected_tool_command(
            tool,
            args,
            timeout,
            extra_env,
            working_dir,
        )
    }

    /// 本机工具版本；拿不到返回 None（不编造版本号）。
    fn tool_version(&self, tool: &str) -> Option<String> {
        crate::tool_exec::tool_version(tool)
    }
}

/// 序列化后推事件。调用点原来直接 `app.emit(name, struct)`，这里补上序列化。
pub fn emit_json<S: Serialize>(
    events: &(dyn ShellEvents + '_),
    event: &str,
    payload: &S,
) -> Result<(), String> {
    match serde_json::to_value(payload) {
        Ok(value) => events.emit(event, value),
        Err(error) => Err(format!("事件 {event} 序列化失败: {error}")),
    }
}

/// 没有壳层时的占位实现：事件丢弃、OAuth 一律不可用。
///
/// 用在单元测试和「引擎先起来、壳层后接上」的启动窗口里，
/// 免得为了跑一段逻辑非得造一个 AppHandle。
#[derive(Debug, Default, Clone, Copy)]
pub struct NullShell;

impl ShellEvents for NullShell {
    fn emit(&self, event: &str, _payload: Value) -> Result<(), String> {
        log::debug!("NullShell 丢弃事件 {event}");
        Ok(())
    }
}

static GLOBAL_SHELL: OnceLock<RwLock<Arc<dyn ShellEvents>>> = OnceLock::new();

fn global_slot() -> &'static RwLock<Arc<dyn ShellEvents>> {
    GLOBAL_SHELL.get_or_init(|| RwLock::new(Arc::new(NullShell)))
}

/// 壳层启动时登记自己；之后引擎里任何角落（包括没有 AppHandle 的纯函数和单元测试）
/// 都能通过 [`global`] 发事件、拿 OAuth 状态。重复调用以最后一次为准。
pub fn set_global(shell: Arc<dyn ShellEvents>) {
    if let Ok(mut guard) = global_slot().write() {
        *guard = shell;
    }
}

/// 当前壳层；未登记时是 [`NullShell`]（事件丢弃、OAuth 不可用、工具走默认 PATH 查找）。
pub fn global() -> Arc<dyn ShellEvents> {
    if let Ok(guard) = global_slot().read() {
        return guard.clone();
    }
    Arc::new(NullShell)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingShell {
        events: Mutex<Vec<String>>,
    }

    impl ShellEvents for RecordingShell {
        fn emit(&self, event: &str, _payload: Value) -> Result<(), String> {
            self.events
                .lock()
                .unwrap()
                .push(event.to_string());
            Ok(())
        }

        fn refresh_tray_menu(&self) {}
    }

    #[test]
    fn emit_json_serializes_before_delivery() {
        let shell = RecordingShell::default();
        emit_json(&shell, "proxy-status", &vec!["a", "b"]).unwrap();
        assert_eq!(shell.events.lock().unwrap().as_slice(), ["proxy-status"]);
    }

    #[test]
    fn default_shell_has_no_oauth_state() {
        let shell = NullShell;
        assert!(shell.codex_oauth().is_none());
        assert!(shell.copilot_auth().is_none());
        assert!(shell.xai_oauth().is_none());
    }

    #[test]
    fn tool_defaults_are_reachable_without_a_shell_impl() {
        let shell = NullShell;
        // 没装的工具必须返回 None，而不是凭空编一个版本号。
        assert!(shell
            .tool_version("definitely-not-installed-cli-xyz")
            .is_none());
    }
}
