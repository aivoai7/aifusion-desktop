//! 平台模型选择：读取平台可用模型，并把用户选定的模型写回各客户端的平台供应商。
//!
//! 这个构建不展示供应商卡片，所以「用哪个模型」只能在这里改：界面给出一份
//! 平台实时模型列表，后端按每个客户端各自的配置形状落库，再重投影 live 文件。
//! 设计约束：
//! - API Key 只在本机解析，绝不回传前端；返回给 UI 的只有模型 ID 与所属厂商。
//! - 各客户端能表达模型的方式不同（Claude 系是角色环境变量，Codex / Grok 是
//!   TOML 一行 `model =`，附加型客户端是一张模型表），所以按 app 分支写入。
//! - 模型 ID 会进 TOML / JSON 文本，先做字符合法性校验，避免写出破配置。

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::app_config::AppType;
use crate::database::{platform_seed_id_for, Database, PLATFORM_SITE};
use crate::error::AppError;
use crate::mode::current::{provider_for, Purpose};
use crate::provider::{ClaudeDesktopModelRoute, Provider};
use crate::services::platform_key::resolve_api_key;
use crate::services::provider::ProviderService;
use crate::store::AppState;

/// 平台上一个可选模型（只带展示需要的字段）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformModelOption {
    pub id: String,
    /// 所属厂商（网关 `owned_by`），用于界面分组。
    pub provider: String,
}

/// 某客户端当前的模型配置形态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformModelConfig {
    /// 该客户端是否支持指定一个主模型（切换型客户端）。
    pub supports_default: bool,
    /// 是否支持单独的轻量模型槽位（Claude Code / Claude Desktop 的 haiku 角色）。
    pub supports_light: bool,
    /// 是否支持勾选一批可用模型（附加型客户端各自维护模型表）。
    pub supports_list: bool,
    pub default_model: Option<String>,
    pub light_model: Option<String>,
    pub models: Vec<String>,
    /// 该客户端当前是否就在用平台供应商；否则改动要等切回平台才生效。
    pub using_platform: bool,
    /// 平台供应商行是否存在。
    pub connected: bool,
}

/// 界面提交的模型选择。
#[derive(Debug, Clone, Default)]
pub struct PlatformModelRequest {
    pub default_model: Option<String>,
    pub light_model: Option<String>,
    /// `None` 表示不改模型表；`Some(list)` 表示整表替换。
    pub models: Option<Vec<String>>,
}

/// 写入结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformModelApplyResult {
    pub app: String,
    /// 是否已把新配置写进该客户端的 live 文件。
    pub synced: bool,
    /// 未同步或同步失败时的原因（已落库，切换客户端后立即生效）。
    pub message: Option<String>,
}

/// 模型 ID 允许的字符：字母数字与常见分隔符，长度受限。
fn is_valid_model_id(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 128
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '/' | '[' | ']' | '+' | ' '))
        && !trimmed.starts_with('-')
}

fn normalized_model(value: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if !is_valid_model_id(raw) {
        return Err(AppError::InvalidInput(format!("模型名称不合法：{raw}")));
    }
    Ok(Some(raw.to_string()))
}

fn normalized_models(values: Option<&[String]>) -> Result<Option<Vec<String>>, AppError> {
    let Some(list) = values else { return Ok(None) };
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for raw in list {
        let Some(model) = normalized_model(Some(raw))? else {
            return Err(AppError::InvalidInput("模型名称不能为空".to_string()));
        };
        if seen.insert(model.clone()) {
            out.push(model);
        }
    }
    if out.is_empty() {
        return Err(AppError::InvalidInput("请至少选择一个模型".to_string()));
    }
    Ok(Some(out))
}

fn app_capabilities(app: &AppType) -> (bool, bool, bool) {
    match app {
        // 角色环境变量：主模型 + haiku 轻量槽
        AppType::Claude | AppType::ClaudeDesktop => (true, true, false),
        // 一个 model 字段
        AppType::Codex | AppType::Gemini | AppType::GrokBuild => (true, false, false),
        // 模型表
        AppType::OpenCode | AppType::OpenClaw | AppType::Hermes | AppType::Pi | AppType::Mcode => {
            (false, false, true)
        }
    }
}

/// 列出平台可用模型（`GET /v1/models`）。未登录时返回空列表。
pub async fn fetch_models(db: &Database) -> Result<Vec<PlatformModelOption>, String> {
    let Some((api_key, _)) = resolve_api_key(db) else {
        return Ok(Vec::new());
    };

    let url = format!("{}/v1/models", PLATFORM_SITE.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("无法初始化网络请求：{error}"))?;

    let response = match client.get(&url).bearer_auth(&api_key).send().await {
        Ok(response) => response,
        Err(_) => return Err("无法连接平台，请检查网络后重试".to_string()),
    };
    let status = response.status();
    if !status.is_success() {
        return Err(format!("获取平台模型列表失败：HTTP {}", status.as_u16()));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("平台返回的模型列表无法解析：{error}"))?;

    let mut out: Vec<PlatformModelOption> = body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| items.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?.trim();
            if id.is_empty() {
                return None;
            }
            Some(PlatformModelOption {
                id: id.to_string(),
                provider: item
                    .get("owned_by")
                    .and_then(Value::as_str)
                    .unwrap_or("平台")
                    .to_string(),
            })
        })
        .collect();

    out.sort_by(|a, b| a.provider.cmp(&b.provider).then_with(|| a.id.cmp(&b.id)));
    out.dedup_by(|a, b| a.id == b.id);
    Ok(out)
}

fn platform_seed_id(app: &AppType) -> Result<&'static str, AppError> {
    platform_seed_id_for(app).ok_or_else(|| AppError::Config("该平台客户端不存在".to_string()))
}

fn platform_provider(state: &AppState, app: &AppType) -> Result<Option<Provider>, AppError> {
    let seed_id = platform_seed_id(app)?;
    state.db.get_provider_by_id(seed_id, app.as_str())
}

/// 读取某客户端当前的平台模型配置。
pub fn current_config(state: &AppState, app: &AppType) -> Result<PlatformModelConfig, AppError> {
    let (supports_default, supports_light, supports_list) = app_capabilities(app);
    let provider = platform_provider(state, app)?;
    let Some(provider) = provider else {
        return Ok(PlatformModelConfig {
            supports_default,
            supports_light,
            supports_list,
            default_model: None,
            light_model: None,
            models: Vec::new(),
            using_platform: false,
            connected: false,
        });
    };

    let (default_model, light_model, models) = read_models(app, &provider);
    let seed_id = platform_seed_id(app)?;
    let in_use = provider_for(state.db.as_ref(), app, Purpose::InUse).unwrap_or(None);

    Ok(PlatformModelConfig {
        supports_default,
        supports_light,
        supports_list,
        default_model,
        light_model,
        models,
        using_platform: in_use.as_deref() == Some(seed_id),
        connected: true,
    })
}

/// 从供应商配置里读出模型形状（与写入逻辑一一对应）。
fn read_models(app: &AppType, provider: &Provider) -> (Option<String>, Option<String>, Vec<String>) {
    let config = &provider.settings_config;
    let env = |key: &str| {
        config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|map| map.get(key))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let toml_model = || {
        config
            .get("config")
            .and_then(Value::as_str)
            .and_then(|text| {
                text.lines().find_map(|line| {
                    let (key, value) = line.split_once('=')?;
                    if key.trim() != "model" {
                        return None;
                    }
                    Some(value.trim().trim_matches('"').to_string())
                })
            })
    };
    let table_models = || -> Vec<String> {
        match config.get("models") {
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(str::to_string)
                .collect(),
            Some(Value::Object(map)) => map.keys().cloned().collect(),
            _ => Vec::new(),
        }
    };

    match app {
        AppType::Claude => (
            env("ANTHROPIC_MODEL"),
            env("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
            Vec::new(),
        ),
        AppType::Gemini => (env("GEMINI_MODEL"), None, Vec::new()),
        AppType::ClaudeDesktop => {
            let routes = provider
                .meta
                .as_ref()
                .map(|meta| meta.claude_desktop_model_routes.clone())
                .unwrap_or_default();
            let main = routes
                .iter()
                .find(|(key, _)| !key.contains("haiku"))
                .map(|(_, route)| route.model.clone());
            let light = routes
                .iter()
                .find(|(key, _)| key.contains("haiku"))
                .map(|(_, route)| route.model.clone());
            (main, light, Vec::new())
        }
        AppType::Codex | AppType::GrokBuild => (toml_model(), None, Vec::new()),
        AppType::OpenCode
        | AppType::Mcode
        | AppType::OpenClaw
        | AppType::Hermes
        | AppType::Pi => (None, None, table_models()),
    }
}

/// 把选择结果写进 settings_config / meta（纯函数，便于测试）。
pub fn apply_to_config(
    app: &AppType,
    config: &mut Value,
    routes: &mut std::collections::HashMap<String, ClaudeDesktopModelRoute>,
    request: &PlatformModelRequest,
) -> Result<(), AppError> {
    let main = normalized_model(request.default_model.as_deref())?;
    let light = normalized_model(request.light_model.as_deref())?;
    let models = normalized_models(request.models.as_deref())?;

    match app {
        AppType::Claude => {
            let Some(main) = main else {
                return Err(AppError::InvalidInput("请选择主模型".to_string()));
            };
            let env = ensure_object(config, "env");
            let haiku = light.clone().unwrap_or_else(|| main.clone());
            for key in ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL"] {
                env.insert(key.to_string(), Value::String(main.clone()));
            }
            env.insert(
                "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                Value::String(haiku),
            );
        }
        AppType::Gemini => {
            let Some(main) = main else {
                return Err(AppError::InvalidInput("请选择主模型".to_string()));
            };
            ensure_object(config, "env").insert(
                "GEMINI_MODEL".to_string(),
                Value::String(main),
            );
        }
        AppType::ClaudeDesktop => {
            let Some(main) = main else {
                return Err(AppError::InvalidInput("请选择主模型".to_string()));
            };
            let haiku = light.unwrap_or_else(|| main.clone());
            // 已有映射按角色重写；一条都没有时补标准三角色，保证 profile 能加载。
            if routes.is_empty() {
                routes.insert(
                    "claude-sonnet-5".to_string(),
                    ClaudeDesktopModelRoute {
                        model: main.clone(),
                        label_override: Some(main.clone()),
                        supports_1m: None,
                    },
                );
                routes.insert(
                    "claude-opus-5".to_string(),
                    ClaudeDesktopModelRoute {
                        model: main.clone(),
                        label_override: Some(main.clone()),
                        supports_1m: None,
                    },
                );
                routes.insert(
                    "claude-haiku-4-5".to_string(),
                    ClaudeDesktopModelRoute {
                        model: haiku.clone(),
                        label_override: Some(haiku.clone()),
                        supports_1m: None,
                    },
                );
            } else {
                let updates = routes
                    .iter()
                    .map(|(key, route)| {
                        let model = if key.contains("haiku") {
                            haiku.clone()
                        } else {
                            main.clone()
                        };
                        (key.clone(), route.model.clone(), model)
                    })
                    .collect::<Vec<_>>();
                for (key, previous, model) in updates {
                    if let Some(route) = routes.get_mut(&key) {
                        route.model = model.clone();
                        // 显示名跟着上游模型走，避免菜单里还是旧名字。
                        if route.label_override.as_deref().is_none_or(|label| label == previous || label.eq_ignore_ascii_case(&previous)) {
                            route.label_override = Some(model);
                        }
                    }
                }
            }
        }
        AppType::Codex | AppType::GrokBuild => {
            let Some(main) = main else {
                return Err(AppError::InvalidInput("请选择主模型".to_string()));
            };
            let Some(text) = config.get("config").and_then(Value::as_str) else {
                return Err(AppError::InvalidInput(
                    "该客户端配置里找不到 TOML 文本".to_string(),
                ));
            };
            let next = text
                .lines()
                .map(|line| {
                    let trimmed = line.trim();
                    if trimmed.starts_with('#') {
                        return line.to_string();
                    }
                    match trimmed.split_once('=') {
                        Some((key, _)) if key.trim() == "model" => {
                            format!("model = \"{main}\"")
                        }
                        _ => line.to_string(),
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            config["config"] = Value::String(next);
        }
        AppType::OpenCode | AppType::Mcode => {
            let list = models.unwrap_or_default();
            if list.is_empty() {
                return Err(AppError::InvalidInput("请至少选择一个模型".to_string()));
            }
            let previous = config
                .get("models")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let mut next = Map::new();
            for model in list {
                let entry = previous
                    .get(&model)
                    .cloned()
                    .unwrap_or_else(|| Value::Object(Map::new()));
                let mut object = match entry {
                    Value::Object(object) => object,
                    _ => Map::new(),
                };
                object
                    .entry("name".to_string())
                    .or_insert_with(|| Value::String(model.clone()));
                next.insert(model, Value::Object(object));
            }
            config["models"] = Value::Object(next);
        }
        AppType::OpenClaw | AppType::Hermes | AppType::Pi => {
            let list = models.unwrap_or_default();
            if list.is_empty() {
                return Err(AppError::InvalidInput("请至少选择一个模型".to_string()));
            }
            let previous = config
                .get("models")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut next = Vec::new();
            for model in list {
                let entry = previous
                    .iter()
                    .find(|item| item.get("id").and_then(Value::as_str) == Some(model.as_str()))
                    .cloned()
                    .unwrap_or_else(|| Value::Object(Map::new()));
                let mut object = match entry {
                    Value::Object(object) => object,
                    _ => Map::new(),
                };
                object.insert("id".to_string(), Value::String(model.clone()));
                object
                    .entry("name".to_string())
                    .or_insert_with(|| Value::String(model.clone()));
                next.push(Value::Object(object));
            }
            config["models"] = Value::Array(next);
        }
    }

    Ok(())
}

fn ensure_object<'a>(config: &'a mut Value, key: &str) -> &'a mut Map<String, Value> {
    if !config.get(key).is_some_and(Value::is_object) {
        config[key] = Value::Object(Map::new());
    }
    config
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .expect("ensure_object 已经保证是对象")
}

/// 写入平台供应商行，并在该客户端正使用平台供应商时重投影 live。
pub fn apply(
    state: &AppState,
    app: &AppType,
    request: PlatformModelRequest,
) -> Result<PlatformModelApplyResult, AppError> {
    let seed_id = platform_seed_id(app)?;
    let Some(mut provider) = state.db.get_provider_by_id(seed_id, app.as_str())? else {
        return Err(AppError::Config(
            "该客户端还没有平台供应商，请先在平台上完成连接".to_string(),
        ));
    };

    let mut meta = provider.meta.clone().unwrap_or_default();
    let mut routes = meta.claude_desktop_model_routes.clone();
    apply_to_config(app, &mut provider.settings_config, &mut routes, &request)?;
    meta.claude_desktop_model_routes = routes.clone();
    // Claude Desktop 只有走本机路由时才读这份映射；保持既有模式不动。
    if matches!(app, AppType::ClaudeDesktop) && meta.claude_desktop_mode.is_none() {
        meta.claude_desktop_mode = Some(crate::provider::ClaudeDesktopMode::Proxy);
    }
    provider.meta = Some(meta);
    state.db.save_provider(app.as_str(), &provider)?;

    let mut result = PlatformModelApplyResult {
        app: app.as_str().to_string(),
        synced: false,
        message: None,
    };

    let in_use = provider_for(state.db.as_ref(), app, Purpose::InUse).unwrap_or(None);
    if in_use.as_deref() != Some(seed_id) {
        result.message = Some("已保存，切回 AIFusion 平台后立即生效".to_string());
        return Ok(result);
    }

    // Pi 的 live 是独立 models.json，只能走它自己的启用流程。
    let sync = if matches!(app, AppType::Pi) {
        ProviderService::switch(state, app.clone(), seed_id).map(|_| ())
    } else {
        ProviderService::sync_current_provider_for_app(state, app.clone())
    };

    match sync {
        Ok(()) => result.synced = true,
        Err(error) => {
            log::warn!("平台模型写入后重投影 live 失败（{}）: {error}", app.as_str());
            result.message = Some(format!("配置已保存，但写入客户端失败：{error}"));
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn request(default: Option<&str>, light: Option<&str>, models: Option<&[&str]>) -> PlatformModelRequest {
        PlatformModelRequest {
            default_model: default.map(str::to_string),
            light_model: light.map(str::to_string),
            models: models.map(|list| list.iter().map(|m| m.to_string()).collect()),
        }
    }

    #[test]
    fn claude_writes_all_role_slots() {
        let mut config = json!({"env": {"ANTHROPIC_AUTH_TOKEN": "k", "ANTHROPIC_MODEL": "old"}});
        let mut routes = HashMap::new();
        apply_to_config(
            &AppType::Claude,
            &mut config,
            &mut routes,
            &request(Some("glm-5.3"), Some("glm-5.3-flash"), None),
        )
        .expect("apply claude");

        let env = config["env"].as_object().expect("env object");
        assert_eq!(env["ANTHROPIC_MODEL"], json!("glm-5.3"));
        assert_eq!(env["ANTHROPIC_DEFAULT_SONNET_MODEL"], json!("glm-5.3"));
        assert_eq!(env["ANTHROPIC_DEFAULT_OPUS_MODEL"], json!("glm-5.3"));
        assert_eq!(
            env["ANTHROPIC_DEFAULT_HAIKU_MODEL"],
            json!("glm-5.3-flash")
        );
        assert_eq!(env["ANTHROPIC_AUTH_TOKEN"], json!("k"));
    }

    #[test]
    fn codex_toml_replaces_only_the_model_line() {
        let mut config = json!({"config": "model_provider = \"custom\"\nmodel = \"old\"\nmodel_reasoning_effort = \"high\"\n\n[model_providers.custom]\nname = \"aifusion\"\n"});
        let mut routes = HashMap::new();
        apply_to_config(
            &AppType::Codex,
            &mut config,
            &mut routes,
            &request(Some("kimi-k3"), None, None),
        )
        .expect("apply codex");

        let text = config["config"].as_str().expect("toml text");
        assert!(text.contains("model = \"kimi-k3\""), "{text}");
        assert!(text.contains("model_provider = \"custom\""), "{text}");
        assert!(text.contains("model_reasoning_effort = \"high\""), "{text}");
        assert!(!text.contains("old"), "{text}");
    }

    #[test]
    fn grokbuild_keeps_default_provider_table_name() {
        let mut config = json!({"config": "[models]\ndefault = \"aifusion\"\n\n[model.\"aifusion\"]\nmodel = \"old\"\napi_backend = \"responses\"\n"});
        let mut routes = HashMap::new();
        apply_to_config(
            &AppType::GrokBuild,
            &mut config,
            &mut routes,
            &request(Some("gpt-5.5"), None, None),
        )
        .expect("apply grok");

        let text = config["config"].as_str().expect("toml text");
        assert!(text.contains("default = \"aifusion\""), "{text}");
        assert!(text.contains("model = \"gpt-5.5\""), "{text}");
        assert!(text.contains("[model.\"aifusion\"]"), "{text}");
    }

    #[test]
    fn claude_desktop_routes_follow_roles() {
        let mut config = json!({"env": {}});
        let mut routes = HashMap::new();
        routes.insert(
            "claude-sonnet-5".to_string(),
            ClaudeDesktopModelRoute {
                model: "old".to_string(),
                label_override: Some("Old".to_string()),
                supports_1m: None,
            },
        );
        routes.insert(
            "claude-haiku-4-5".to_string(),
            ClaudeDesktopModelRoute {
                model: "old".to_string(),
                label_override: Some("old".to_string()),
                supports_1m: None,
            },
        );

        apply_to_config(
            &AppType::ClaudeDesktop,
            &mut config,
            &mut routes,
            &request(Some("claude-sonnet-5"), Some("deepseek-v4-flash"), None),
        )
        .expect("apply desktop");

        assert_eq!(routes["claude-sonnet-5"].model, "claude-sonnet-5");
        assert_eq!(routes["claude-sonnet-5"].label_override.as_deref(), Some("claude-sonnet-5"));
        assert_eq!(routes["claude-haiku-4-5"].model, "deepseek-v4-flash");
    }

    #[test]
    fn pi_model_table_keeps_known_metadata() {
        let mut config = json!({"models": [
            {"id": "glm-5.3-flash", "name": "GLM 5.3 Flash", "contextWindow": 200000, "maxTokens": 32000}
        ]});
        let mut routes = HashMap::new();
        apply_to_config(
            &AppType::Pi,
            &mut config,
            &mut routes,
            &request(None, None, Some(&["glm-5.3-flash", "kimi-k3"])),
        )
        .expect("apply pi");

        let models = config["models"].as_array().expect("models array");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["contextWindow"], json!(200000));
        assert_eq!(models[1]["id"], json!("kimi-k3"));
        assert_eq!(models[1]["name"], json!("kimi-k3"));
    }

    #[test]
    fn opencode_model_map_is_replaced() {
        let mut config = json!({"options": {"apiKey": "k"}, "models": {"old": {"name": "旧"}}});
        let mut routes = HashMap::new();
        apply_to_config(
            &AppType::OpenCode,
            &mut config,
            &mut routes,
            &request(None, None, Some(&["glm-5.3"])),
        )
        .expect("apply opencode");

        let models = config["models"].as_object().expect("models map");
        assert!(models.contains_key("glm-5.3"));
        assert!(!models.contains_key("old"));
        assert_eq!(models["glm-5.3"]["name"], json!("glm-5.3"));
    }

    #[test]
    fn rejects_malformed_model_ids_and_empty_lists() {
        let mut config = json!({"env": {}});
        let mut routes = HashMap::new();
        let broken = request(Some("bad\"model"), None, None);
        assert!(apply_to_config(&AppType::Claude, &mut config, &mut routes, &broken).is_err());

        let empty = request(None, None, Some(&[]));
        assert!(apply_to_config(&AppType::Pi, &mut config, &mut routes, &empty).is_err());
    }
}
