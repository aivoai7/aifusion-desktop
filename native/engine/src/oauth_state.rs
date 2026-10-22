//! 三个 OAuth 管理器的状态包装。
//!
//! 原来定义在 `commands/` 里、由 Tauri 的 `State<'_>` 注入；代理转发器也要用它们，
//! 于是引擎反过来依赖了壳层。现在挪进引擎，`commands/` 只是重新导出一次，
//! 壳层继续用 `app.manage(...)` 注册。

use std::sync::Arc;

use tokio::sync::RwLock;

use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::proxy::providers::copilot_auth::CopilotAuthManager;
use crate::proxy::providers::xai_oauth_auth::XaiOAuthManager;

/// Codex OAuth 认证状态
///
/// `CodexOAuthManager` 内部已使用细粒度锁且所有方法均为 `&self`，因此这里
/// 直接持有 `Arc`，不再包一层 `RwLock`——避免任一命令持有粗粒度锁跨网络刷新
/// 时阻塞其他命令（切换 / 认证中心操作 / token 读取）。
pub struct CodexOAuthState(pub Arc<CodexOAuthManager>);

/// Copilot 认证状态
pub struct CopilotAuthState(pub Arc<RwLock<CopilotAuthManager>>);

/// xAI（SuperGrok 反代）认证状态
pub struct XaiOAuthState(pub Arc<RwLock<XaiOAuthManager>>);
