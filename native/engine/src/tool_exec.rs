//! 引擎调外部 CLI 的最小实现 + 从命令输出解码字节流的公共工具。
//!
//! 引擎里只有两处真的要跑外部命令（Codex 守护进程重启、探测本机 Codex 版本），
//! 但完整实现在壳层（Tauri 那份还处理 WSL、npx 多版本、PATH 大小写等历史包袱）。
//! 这里的做法是：
//! - `decode_command_output` 是引擎自己的唯一实现，壳层反过来用它，不重复一份。
//! - `run_*` / `version` 作为 `ShellEvents` 的默认实现，用 PATH 查找 + `--version`，
//!   够用且真实；Tauri 壳覆盖成它的 WSL 感知版本。

use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// 把命令输出解码成字符串：优先 UTF-8，Windows 下再按 OEM / ANSI 代码页兜底。
pub fn decode_command_output(bytes: &[u8]) -> String {
    #[cfg(target_os = "windows")]
    {
        decode_windows_command_output(bytes)
    }

    #[cfg(not(target_os = "windows"))]
    {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(target_os = "windows")]
fn decode_windows_command_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }

    use windows_sys::Win32::Globalization::{GetACP, GetOEMCP, MultiByteToWideChar};

    fn decode_codepage(bytes: &[u8], codepage: u32) -> Option<String> {
        if codepage == 0 {
            return None;
        }

        let input_len = i32::try_from(bytes.len()).ok()?;
        unsafe {
            let wide_len = MultiByteToWideChar(
                codepage,
                0,
                bytes.as_ptr(),
                input_len,
                std::ptr::null_mut(),
                0,
            );
            if wide_len <= 0 {
                return None;
            }

            let mut wide = vec![0u16; wide_len as usize];
            let written = MultiByteToWideChar(
                codepage,
                0,
                bytes.as_ptr(),
                input_len,
                wide.as_mut_ptr(),
                wide_len,
            );
            if written <= 0 {
                return None;
            }

            Some(String::from_utf16_lossy(&wide[..written as usize]))
        }
    }

    let oem_cp = unsafe { GetOEMCP() };
    if let Some(decoded) = decode_codepage(bytes, oem_cp) {
        return decoded;
    }

    let ansi_cp = unsafe { GetACP() };
    if ansi_cp != oem_cp {
        if let Some(decoded) = decode_codepage(bytes, ansi_cp) {
            return decoded;
        }
    }

    String::from_utf8_lossy(bytes).into_owned()
}

/// 工具可执行文件名（Windows 需要补 `.exe`，`.cmd`/`.ps1` 不算可执行文件）。
#[cfg(target_os = "windows")]
fn executable_candidates(tool: &str) -> Vec<String> {
    vec![format!("{tool}.exe")]
}

#[cfg(not(target_os = "windows"))]
fn executable_candidates(tool: &str) -> Vec<String> {
    vec![tool.to_string()]
}

fn extra_search_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join("bin"));
    }
    #[cfg(target_os = "windows")]
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let base = std::path::PathBuf::from(local_appdata);
        dirs.push(base.join("Programs").join("npm"));
        dirs.push(base.join("npm"));
    }
    #[cfg(target_os = "macos")]
    dirs.push(std::path::PathBuf::from("/opt/homebrew/bin"));
    dirs.push(std::path::PathBuf::from("/usr/local/bin"));
    dirs
}

/// 在 PATH 和几个常见 npm / brew 目录里找工具；找不到返回 None（不猜、不编造路径）。
pub fn locate_tool(tool: &str) -> Option<std::path::PathBuf> {
    let names = executable_candidates(tool);
    let path_var = std::env::var_os("PATH")?;
    let mut all: Vec<std::path::PathBuf> = std::env::split_paths(&path_var).collect();
    all.extend(extra_search_dirs());

    for dir in all {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 只允许安全字符的参数，避免把外面的字符串原样拼进子进程。
fn args_are_safe(args: &[&str]) -> bool {
    args.iter().all(|arg| {
        !arg.is_empty()
            && arg
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':'))
    })
}

/// 带超时地跑一条命令，回收 stdout/stderr。超时杀进程并返回 Err。
pub fn run_with_timeout(
    program: &Path,
    args: &[&str],
    timeout: Option<Duration>,
    extra_env: &[(&str, String)],
    working_dir: &Path,
) -> Result<Output, String> {
    if !args_are_safe(args) {
        return Err("Invalid tool command arguments".to_string());
    }

    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if working_dir.exists() {
        cmd.current_dir(working_dir);
    }
    for (key, value) in extra_env {
        cmd.env(key, value);
    }

    let mut child = cmd
        .spawn()
        .map_err(|error| format!("无法启动 {}: {error}", program.display()))?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    // 先把两个管道读完再 wait，否则输出超过管道缓冲区会把子进程卡死。
    let stdout_task = thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut pipe) = stdout_pipe {
            let _ = std::io::Read::read_to_end(&mut pipe, &mut buffer);
        }
        buffer
    });
    let stderr_task = thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = std::io::Read::read_to_end(&mut pipe, &mut buffer);
        }
        buffer
    });

    let deadline = timeout.map(|delay| Instant::now() + delay);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if deadline.is_some_and(|point| Instant::now() >= point) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "命令超时 ({}s): {}",
                        timeout
                            .map(|delay| delay.as_secs())
                            .unwrap_or_default(),
                        program.display()
                    ));
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(format!("等待子进程失败: {error}")),
        }
    };

    let stdout = stdout_task.join().unwrap_or_default();
    let stderr = stderr_task.join().unwrap_or_default();

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

/// 默认的工具命令执行器：PATH 查找 + 直跑，不感知 WSL / npx 多版本。
/// 壳层（Tauri）会覆盖成它的完整版；原生壳没有那些历史包袱，用这个就够。
pub fn run_detected_tool_command(
    tool: &str,
    args: &[&str],
    timeout: Option<Duration>,
    extra_env: &[(&str, String)],
    working_dir: &Path,
) -> Result<Output, String> {
    let program = locate_tool(tool)
        .ok_or_else(|| format!("本机找不到 {tool} 命令 (executable not found)"))?;
    run_with_timeout(
        &program,
        args,
        Some(timeout.unwrap_or(Duration::from_secs(30))),
        extra_env,
        working_dir,
    )
}

/// 本机工具版本：`<tool> --version` 的第一行；没装或跑不出来返回 None。
pub fn tool_version(tool: &str) -> Option<String> {
    let output = run_detected_tool_command(
        tool,
        &["--version"],
        Some(Duration::from_secs(8)),
        &[],
        Path::new("."),
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = decode_command_output(&output.stdout);
    text.lines().map(str::trim).find(|line| !line.is_empty()).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_arguments() {
        let error = run_with_timeout(
            Path::new("/bin/echo"),
            &["a b;rm"],
            Some(Duration::from_secs(1)),
            &[],
            Path::new("."),
        )
        .unwrap_err();
        assert!(error.contains("Invalid tool command arguments"));
    }

    #[test]
    fn decode_falls_back_for_invalid_utf8() {
        // 0xFF 不是合法 UTF-8 起始字节，任何平台都要走兜底路径而不是 panic。
        let decoded = decode_command_output(&[0xFF, 0xFE, b'o', b'k']);
        assert!(!decoded.is_empty());
    }

    #[test]
    fn locates_a_tool_that_is_not_installed() {
        assert!(locate_tool("definitely-not-installed-cli-xyz").is_none());
    }
}
