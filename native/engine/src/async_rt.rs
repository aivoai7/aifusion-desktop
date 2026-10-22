//! 引擎自带的全局 tokio 运行时。
//!
//! 原来这些调用是 `tauri::async_runtime::block_on`：同步上下文里等一个异步任务。
//! 引擎不能再依赖 Tauri，所以自带一个进程级多线程运行时，两个壳共用。
//!
//! 注意：不要在 tokio 执行线程里调用 `block_on`（和原来 tauri 的约束一样），
//! 引擎里这些点都在同步线程（命令处理、配置读写、iced 的 update）上。

use std::future::Future;
use std::sync::OnceLock;

use tokio::runtime::{Handle, Runtime};

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("启动 tokio 运行时失败")
    })
}

/// 等价于 `tauri::async_runtime::block_on`
///
/// 已经在 tokio 线程里时先 `block_in_place` 把线程挪出 worker 池，
/// 避免「在 async 上下文里 block」直接 panic。运行时是多线程的，
/// `block_in_place` 的前提成立。
pub fn block_on<F: Future>(future: F) -> F::Output {
    if Handle::try_current().is_ok() {
        return tokio::task::block_in_place(|| Handle::current().block_on(future));
    }
    runtime().block_on(future)
}

/// 等价于 `tauri::async_runtime::handle()`
pub fn handle() -> Handle {
    match Handle::try_current() {
        Ok(handle) => handle,
        Err(_) => runtime().handle().clone(),
    }
}

/// 等价于 `tauri::async_runtime::spawn`
pub fn spawn<F>(future: F) -> tokio::task::JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    handle().spawn(future)
}

/// 等价于 `tauri::async_runtime::spawn_blocking`：把同步阻塞的活儿丢给阻塞线程池。
///
/// 走 `handle()` 而不是裸的 `tokio::task::spawn_blocking`：后者要求调用点已经处在
/// 某个运行时上下文里，而同步线程（配置读写、iced 的 update）里常常不满足，
/// 会直接 panic「there is no reactor running」。
pub fn spawn_blocking<F, T>(f: F) -> tokio::task::JoinHandle<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    handle().spawn_blocking(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_on_resolves_a_future() {
        assert_eq!(block_on(async { 6 * 7 }), 42);
    }

    #[test]
    fn runtime_is_reused_across_calls() {
        // 两次调用必须落在同一个运行时上，否则连接池、定时器会各建一份。
        let first = block_on(async { tokio::runtime::Handle::current().id() });
        let second = block_on(async { tokio::runtime::Handle::current().id() });
        assert_eq!(first, second);
    }

    #[test]
    fn spawn_and_blocking_round_trip() {
        assert_eq!(block_on(spawn(async { 7 })).unwrap(), 7);
        assert_eq!(block_on(spawn_blocking(|| "同步线程".to_string())).unwrap(), "同步线程");
    }
}
