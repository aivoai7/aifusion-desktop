//! 应用配置目录覆盖：缓存 + `app_paths.json` 读写。
//!
//! Tauri 壳用 tauri-plugin-store 读写同一个 `app_paths.json`，读完把结果塞进这里的
//! 缓存；原生壳没有插件，直接 `load_app_paths_file` 读同一个文件。
//! 两个壳因此共用一个「配置目录在哪」的答案，不会出现一边读 `~/.claude`、
//! 另一边读别的目录。

use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

use serde_json::Value;

/// Store 中的键名
pub const STORE_KEY_APP_CONFIG_DIR: &str = "app_config_dir_override";

/// 缓存当前的 app_config_dir 覆盖路径，避免各处持有壳层句柄
static APP_CONFIG_DIR_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

fn override_cache() -> &'static RwLock<Option<PathBuf>> {
    APP_CONFIG_DIR_OVERRIDE.get_or_init(|| RwLock::new(None))
}

/// 获取缓存中的 app_config_dir 覆盖路径
pub fn get_app_config_dir_override() -> Option<PathBuf> {
    override_cache().read().ok()?.clone()
}

/// 写入缓存（壳层从自己的存储里读到之后调用）
pub fn set_app_config_dir_override(value: Option<PathBuf>) {
    if let Ok(mut guard) = override_cache().write() {
        *guard = value;
    }
}

/// 解析路径，支持 ~ 开头的相对路径
pub fn resolve_path(raw: &str) -> PathBuf {
    if raw == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    } else if let Some(stripped) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }

    PathBuf::from(raw)
}

/// 从 `app_paths.json` 里取覆盖路径（不校验存在性，交给调用方）
fn read_key(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    match value.get(STORE_KEY_APP_CONFIG_DIR)? {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        other => {
            log::warn!(
                "{path:?} 里的 {STORE_KEY_APP_CONFIG_DIR} 类型不正确，应为字符串（实际 {other:?}）"
            );
            None
        }
    }
}

/// 原生壳用：直接读壳层给的文件路径，刷新缓存并返回结果。
pub fn load_app_paths_file(path: &Path) -> Option<PathBuf> {
    let value = read_key(path).map(|raw| {
        let resolved = resolve_path(&raw);
        if !resolved.exists() {
            log::warn!(
                "app_paths.json 里配置的 app_config_dir 不存在: {resolved:?}\n将使用默认路径。"
            );
            return None;
        }
        log::info!("使用 app_paths.json 中的 app_config_dir: {resolved:?}");
        Some(resolved)
    })?;
    set_app_config_dir_override(value.clone());
    value
}

/// 原生壳用：把覆盖路径写回 `app_paths.json`（None = 删除该键）。
pub fn store_app_config_dir(path: &Path, value: Option<&str>) -> Result<(), String> {
    let mut root: serde_json::Map<String, Value> = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    match value {
        Some(raw) if !raw.trim().is_empty() => {
            root.insert(
                STORE_KEY_APP_CONFIG_DIR.to_string(),
                Value::String(raw.trim().to_string()),
            );
        }
        _ => {
            root.remove(STORE_KEY_APP_CONFIG_DIR);
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let rendered = serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(path, rendered).map_err(|e| format!("写入失败: {e}"))?;

    set_app_config_dir_override(read_key(path).map(|raw| resolve_path(&raw)));
    Ok(())
}
