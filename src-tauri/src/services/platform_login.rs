//! 网页登录：用系统默认浏览器打开 AIFusion 官网，在本地回环端口接收结果。
//!
//! 官网的登录态是 HttpOnly Cookie，桌面端读不到，也不应该去读。因此：
//! 1. 桌面端先启动一次性本地 HTTP 回调（127.0.0.1 随机端口），生成随机 state；
//! 2. 用系统浏览器打开 `{PLATFORM_SITE}/desktop/connect?state=…&redirect_uri=…`；
//! 3. 官网页面复用浏览器里的登录态，取一把可用 Key，再跳回本地回调；
//! 4. 桌面端校验 state、取出 Key，关闭回调服务，进入后续校验与下发流程。
//!
//! 不保存账号密码、不读取浏览器 Cookie、不把 Key 写进日志。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// 用户登录通常一分钟内完成；留足验证码、OAuth 等场景的时间。
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// 固定回调路径；官网端也会校验这个路径。
const CALLBACK_PATH: &str = "/platform/callback";

enum LoginSignal {
    Key(String),
    Cancelled,
    Failed(String),
}

struct PendingLogin {
    state: String,
    /// 回调处理与取消命令共享同一个发送端；谁先取到谁投递结果。
    result: Arc<Mutex<Option<oneshot::Sender<LoginSignal>>>>,
}

static PENDING_LOGIN: Mutex<Option<PendingLogin>> = Mutex::new(None);

fn pending_slot() -> std::sync::MutexGuard<'static, Option<PendingLogin>> {
    PENDING_LOGIN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone)]
struct CallbackState {
    state: String,
    result: Arc<Mutex<Option<oneshot::Sender<LoginSignal>>>>,
}

/// 用系统浏览器打开官网登录页，返回可用的 API Key。
///
/// `Ok(None)` 表示用户在桌面端点了取消；其余失败返回可直接展示的错误。
pub async fn open_login_in_browser(app: &AppHandle) -> Result<Option<String>, String> {
    let state = uuid::Uuid::new_v4().simple().to_string();
    let (result_tx, result_rx) = oneshot::channel::<LoginSignal>();
    let result_slot = Arc::new(Mutex::new(Some(result_tx)));

    // 同一时间只保留一个登录流程；旧流程（如果还在等待）直接按取消处理。
    {
        let mut slot = pending_slot();
        if let Some(previous) = slot.take() {
            if let Some(sender) = previous
                .result
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take()
            {
                let _ = sender.send(LoginSignal::Cancelled);
            }
        }
        *slot = Some(PendingLogin {
            state: state.clone(),
            result: result_slot.clone(),
        });
    }

    let listener = match TcpListener::bind(("127.0.0.1", 0)).await {
        Ok(listener) => listener,
        Err(error) => {
            clear_pending(&state);
            return Err(format!("无法启动本地登录回调：{error}"));
        }
    };
    let port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(error) => {
            clear_pending(&state);
            return Err(format!("无法启动本地登录回调：{error}"));
        }
    };
    let callback_url = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let connect_url = match build_connect_url(&state, &callback_url) {
        Ok(url) => url,
        Err(error) => {
            clear_pending(&state);
            return Err(error);
        }
    };

    let router = Router::new()
        .route(CALLBACK_PATH, get(handle_callback))
        .with_state(CallbackState {
            state: state.clone(),
            result: result_slot.clone(),
        });
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server_task = tokio::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });
        if let Err(error) = server.await {
            log::warn!("[PlatformLogin] 本地登录回调退出: {error}");
        }
    });

    log::info!("[PlatformLogin] 在系统浏览器打开平台登录页");
    if let Err(error) = app.opener().open_url(connect_url.as_str(), None::<String>) {
        clear_pending(&state);
        let _ = shutdown_tx.send(());
        let _ = tokio::time::timeout(Duration::from_secs(1), server_task).await;
        return Err(format!("无法打开系统浏览器：{error}"));
    }

    let signal = match tokio::time::timeout(LOGIN_TIMEOUT, result_rx).await {
        Ok(Ok(signal)) => signal,
        Ok(Err(_)) => LoginSignal::Cancelled,
        Err(_) => LoginSignal::Failed("登录超时，请重新在浏览器中完成登录".to_string()),
    };

    clear_pending(&state);
    let _ = shutdown_tx.send(());
    // 正常回调后浏览器已经拿到响应；这里只等连接收尾，不阻塞命令返回。
    let _ = tokio::time::timeout(Duration::from_secs(2), server_task).await;

    match signal {
        LoginSignal::Key(key) => {
            log::info!("[PlatformLogin] 已从官网取回 API Key");
            Ok(Some(key))
        }
        LoginSignal::Cancelled => {
            log::info!("[PlatformLogin] 登录已取消");
            Ok(None)
        }
        LoginSignal::Failed(message) => {
            log::warn!("[PlatformLogin] 登录失败: {message}");
            Err(message)
        }
    }
}

/// 取消当前等待中的登录（浏览器页面无法从桌面端关闭，用户点取消后不再等待）。
pub fn cancel_pending_login() -> bool {
    let pending = {
        let mut slot = pending_slot();
        slot.take()
    };
    let Some(pending) = pending else {
        return false;
    };
    let sender = pending
        .result
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(sender) = sender {
        let _ = sender.send(LoginSignal::Cancelled);
        true
    } else {
        false
    }
}

fn clear_pending(state: &str) {
    let mut slot = pending_slot();
    if slot.as_ref().is_some_and(|pending| pending.state == state) {
        *slot = None;
    }
}

fn build_connect_url(state: &str, redirect_uri: &str) -> Result<tauri::Url, String> {
    let mut url = tauri::Url::parse(crate::database::PLATFORM_SITE)
        .map_err(|error| format!("平台地址无效：{error}"))?;
    url.set_path("/desktop/connect");
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut()
        .append_pair("state", state)
        .append_pair("redirect_uri", redirect_uri);
    Ok(url)
}

async fn handle_callback(
    State(context): State<CallbackState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if params.get("state").map(String::as_str) != Some(context.state.as_str()) {
        log::warn!("[PlatformLogin] 忽略 state 不匹配的本地回调");
        return callback_page(
            StatusCode::BAD_REQUEST,
            "登录请求已失效",
            "请回到 AIFusion 桌面端重新发起登录。",
        );
    }

    let signal = if let Some(message) = params
        .get("error")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        LoginSignal::Failed(message.to_string())
    } else if let Some(key) = params
        .get("key")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        LoginSignal::Key(key.to_string())
    } else {
        LoginSignal::Failed("登录回调缺少 API Key，请重试".to_string())
    };

    let sender = {
        let mut slot = context
            .result
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slot.take()
    };
    if let Some(sender) = sender {
        let _ = sender.send(signal);
    } else {
        log::warn!("[PlatformLogin] 收到重复的本地登录回调，已忽略");
    }

    callback_page(
        StatusCode::OK,
        "登录成功",
        "已返回 AIFusion 桌面端，可以关闭此页面。",
    )
}

fn callback_page(status: StatusCode, title: &str, message: &str) -> Response {
    let html = format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>{title} · AIFusion</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #f5f4ef; color: #161616;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
  main {{ width: min(420px, calc(100vw - 48px)); padding: 40px 32px; background: #fff;
          border: 1px solid #e6e3da; text-align: center; }}
  h1 {{ margin: 0 0 10px; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }}
  p {{ margin: 0; color: #6b6b6b; font-size: 13px; line-height: 1.7; }}
  .mark {{ width: 36px; height: 36px; margin: 0 auto 18px; border-radius: 50%;
           background: #161616; color: #fff; display: grid; place-items: center;
           font: 600 16px/1 ui-monospace, monospace; }}
</style>
</head>
<body>
<main>
  <div class="mark">AI</div>
  <h1>{title}</h1>
  <p>{message}</p>
</main>
<script>window.setTimeout(function () {{ window.close(); }}, 800);</script>
</body>
</html>"#
    );
    (
        status,
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (
                header::HeaderName::from_static("referrer-policy"),
                "no-referrer",
            ),
        ],
        Html(html),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_url_points_at_the_official_desktop_callback_page() {
        let url = build_connect_url("abc123", "http://127.0.0.1:51234/platform/callback")
            .expect("url should parse");
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("op.aifusion.sbs"));
        assert_eq!(url.path(), "/desktop/connect");
        let params = url.query_pairs().into_owned().collect::<HashMap<_, _>>();
        assert_eq!(params.get("state").map(String::as_str), Some("abc123"));
        assert_eq!(
            params.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:51234/platform/callback")
        );
    }

    #[test]
    fn callback_page_never_contains_a_key() {
        let response = callback_page(
            StatusCode::OK,
            "登录成功",
            "已返回 AIFusion 桌面端，可以关闭此页面。",
        );
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|v| v.to_str().ok()),
            Some("no-store")
        );
        assert!(!format!("{:?}", response.headers()).contains("fk_"));
    }

    #[test]
    fn callback_path_is_loopback_friendly() {
        assert_eq!(CALLBACK_PATH, "/platform/callback");
    }

    #[tokio::test]
    async fn callback_rejects_a_mismatched_state_and_accepts_the_key() {
        let (sender, receiver) = oneshot::channel();
        let context = CallbackState {
            state: "expected-state".to_string(),
            result: Arc::new(Mutex::new(Some(sender))),
        };

        let rejected = handle_callback(
            State(context.clone()),
            Query(HashMap::from([
                ("state".to_string(), "wrong-state".to_string()),
                ("key".to_string(), "fk_test".to_string()),
            ])),
        )
        .await;
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);

        let accepted = handle_callback(
            State(context),
            Query(HashMap::from([
                ("state".to_string(), "expected-state".to_string()),
                ("key".to_string(), "fk_test".to_string()),
            ])),
        )
        .await;
        assert_eq!(accepted.status(), StatusCode::OK);
        match receiver.await.expect("callback signal") {
            LoginSignal::Key(key) => assert_eq!(key, "fk_test"),
            _ => panic!("expected the API key"),
        }
    }

    #[tokio::test]
    async fn callback_forwards_the_page_error() {
        let (sender, receiver) = oneshot::channel();
        let context = CallbackState {
            state: "expected-state".to_string(),
            result: Arc::new(Mutex::new(Some(sender))),
        };

        let response = handle_callback(
            State(context),
            Query(HashMap::from([
                ("state".to_string(), "expected-state".to_string()),
                ("error".to_string(), "no key available".to_string()),
            ])),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        match receiver.await.expect("callback signal") {
            LoginSignal::Failed(message) => assert_eq!(message, "no key available"),
            _ => panic!("expected a failure"),
        }
    }
}
