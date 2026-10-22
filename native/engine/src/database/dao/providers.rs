use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::provider::{Provider, ProviderMeta};
use indexmap::IndexMap;
use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};

type OmoProviderRow = (
    String,
    String,
    String,
    Option<String>,
    Option<i64>,
    Option<usize>,
    Option<String>,
    String,
);

impl Database {
    /// Detach Codex providers bound to these deleted local accounts, atomically.
    /// Only this device's account IDs are passed in: provider rows sync across
    /// devices, and a row bound to another device's account must stay bound.
    /// Keep raw JSON so unrelated and future metadata survives the update.
    pub fn unbind_codex_managed_accounts(
        &self,
        account_ids: &[String],
    ) -> Result<Vec<String>, AppError> {
        if account_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = {
            let mut stmt = tx
                .prepare(
                    "SELECT id, meta, settings_config, category,
                        trim(json_extract(meta, '$.authBinding.accountId')) FROM providers
                 WHERE app_type = 'codex'
                   AND json_extract(meta, '$.authBinding.source') = 'managed_account'
                   AND json_extract(meta, '$.authBinding.authProvider') = 'codex_oauth'
                 ORDER BY id",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                })
                .map_err(|e| AppError::Database(e.to_string()))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::Database(e.to_string()))?
        };
        let mut affected = Vec::new();
        for (id, meta_text, settings_text, category, bound) in rows {
            if !bound.is_some_and(|bound| account_ids.iter().any(|id| id.trim() == bound)) {
                continue;
            }
            let parse_error = |error: serde_json::Error| {
                AppError::Database(format!("供应商 {id} 配置无效: {error}"))
            };
            let mut meta: serde_json::Value =
                serde_json::from_str(&meta_text).map_err(parse_error)?;
            let mut settings: serde_json::Value =
                serde_json::from_str(&settings_text).map_err(parse_error)?;
            let mut provider = Provider::with_id(id.clone(), String::new(), settings.clone(), None);
            provider.category = category;
            provider.meta = Some(serde_json::from_value(meta.clone()).map_err(parse_error)?);
            if provider.category.is_none()
                && crate::proxy::providers::is_codex_official_provider(&provider)
            {
                provider.category = Some("official".to_string());
            }
            meta.as_object_mut()
                .ok_or_else(|| AppError::Config(format!("供应商 {id} 的 meta 必须是对象")))?
                .remove("authBinding");
            settings
                .as_object_mut()
                .ok_or_else(|| {
                    AppError::Config(format!("供应商 {id} 的 settings_config 必须是对象"))
                })?
                .insert("auth".to_string(), serde_json::json!({}));
            tx.execute(
                "UPDATE providers SET meta = ?1, settings_config = ?2, category = ?3
                 WHERE app_type = 'codex' AND id = ?4",
                params![
                    meta.to_string(),
                    settings.to_string(),
                    provider.category,
                    id
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
            affected.push(id);
        }
        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected)
    }

    pub fn get_all_providers(
        &self,
        app_type: &str,
    ) -> Result<IndexMap<String, Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn.prepare(
            "SELECT id, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, in_failover_queue
             FROM providers WHERE app_type = ?1
             ORDER BY COALESCE(sort_index, 999999), created_at ASC, id ASC"
        ).map_err(|e| AppError::Database(e.to_string()))?;

        let provider_iter = stmt
            .query_map(params![app_type], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let settings_config_str: String = row.get(2)?;
                let website_url: Option<String> = row.get(3)?;
                let category: Option<String> = row.get(4)?;
                let created_at: Option<i64> = row.get(5)?;
                let sort_index: Option<usize> = row.get(6)?;
                let notes: Option<String> = row.get(7)?;
                let icon: Option<String> = row.get(8)?;
                let icon_color: Option<String> = row.get(9)?;
                let meta_str: String = row.get(10)?;
                let in_failover_queue: bool = row.get(11)?;

                let settings_config =
                    serde_json::from_str(&settings_config_str).unwrap_or(serde_json::Value::Null);
                let meta: ProviderMeta = serde_json::from_str(&meta_str).unwrap_or_default();

                Ok((
                    id,
                    Provider {
                        id: "".to_string(), // Placeholder, set below
                        name,
                        settings_config,
                        website_url,
                        category,
                        created_at,
                        sort_index,
                        notes,
                        meta: Some(meta),
                        icon,
                        icon_color,
                        in_failover_queue,
                    },
                ))
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut providers = IndexMap::new();
        for provider_res in provider_iter {
            let (id, mut provider) = provider_res.map_err(|e| AppError::Database(e.to_string()))?;
            provider.id = id.clone();

            let mut stmt_endpoints = conn.prepare(
                "SELECT url, added_at FROM provider_endpoints WHERE provider_id = ?1 AND app_type = ?2 ORDER BY added_at ASC, url ASC"
            ).map_err(|e| AppError::Database(e.to_string()))?;

            let endpoints_iter = stmt_endpoints
                .query_map(params![id, app_type], |row| {
                    let url: String = row.get(0)?;
                    let added_at: Option<i64> = row.get(1)?;
                    Ok((
                        url,
                        crate::settings::CustomEndpoint {
                            url: "".to_string(),
                            added_at: added_at.unwrap_or(0),
                            last_used: None,
                        },
                    ))
                })
                .map_err(|e| AppError::Database(e.to_string()))?;

            let mut custom_endpoints = HashMap::new();
            for ep_res in endpoints_iter {
                let (url, mut ep) = ep_res.map_err(|e| AppError::Database(e.to_string()))?;
                ep.url = url.clone();
                custom_endpoints.insert(url, ep);
            }

            if let Some(meta) = &mut provider.meta {
                meta.custom_endpoints = custom_endpoints;
            }

            providers.insert(id, provider);
        }

        Ok(providers)
    }

    pub fn get_current_provider(&self, app_type: &str) -> Result<Option<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM providers WHERE app_type = ?1 AND is_current = 1 LIMIT 1")
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut rows = stmt
            .query(params![app_type])
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            Ok(Some(
                row.get(0).map_err(|e| AppError::Database(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    pub fn get_provider_by_id(
        &self,
        id: &str,
        app_type: &str,
    ) -> Result<Option<Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            "SELECT name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, in_failover_queue
             FROM providers WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
            |row| {
                let name: String = row.get(0)?;
                let settings_config_str: String = row.get(1)?;
                let website_url: Option<String> = row.get(2)?;
                let category: Option<String> = row.get(3)?;
                let created_at: Option<i64> = row.get(4)?;
                let sort_index: Option<usize> = row.get(5)?;
                let notes: Option<String> = row.get(6)?;
                let icon: Option<String> = row.get(7)?;
                let icon_color: Option<String> = row.get(8)?;
                let meta_str: String = row.get(9)?;
                let in_failover_queue: bool = row.get(10)?;

                let settings_config = serde_json::from_str(&settings_config_str).unwrap_or(serde_json::Value::Null);
                let meta: ProviderMeta = serde_json::from_str(&meta_str).unwrap_or_default();

                Ok(Provider {
                    id: id.to_string(),
                    name,
                    settings_config,
                    website_url,
                    category,
                    created_at,
                    sort_index,
                    notes,
                    meta: Some(meta),
                    icon,
                    icon_color,
                    in_failover_queue,
                })
            },
        );

        match result {
            Ok(provider) => Ok(Some(provider)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn save_provider(&self, app_type: &str, provider: &Provider) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut meta_clone = provider.meta.clone().unwrap_or_default();
        let endpoints = std::mem::take(&mut meta_clone.custom_endpoints);

        let existing: Option<(bool, bool)> = tx
            .query_row(
                "SELECT is_current, in_failover_queue FROM providers WHERE id = ?1 AND app_type = ?2",
                params![provider.id, app_type],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        let is_update = existing.is_some();
        let (is_current, in_failover_queue) =
            existing.unwrap_or((false, provider.in_failover_queue));

        if is_update {
            tx.execute(
                "UPDATE providers SET
                    name = ?1,
                    settings_config = ?2,
                    website_url = ?3,
                    category = ?4,
                    created_at = ?5,
                    sort_index = ?6,
                    notes = ?7,
                    icon = ?8,
                    icon_color = ?9,
                    meta = ?10,
                    is_current = ?11,
                    in_failover_queue = ?12
                WHERE id = ?13 AND app_type = ?14",
                params![
                    provider.name,
                    serde_json::to_string(&provider.settings_config).map_err(|e| {
                        AppError::Database(format!("Failed to serialize settings_config: {e}"))
                    })?,
                    provider.website_url,
                    provider.category,
                    provider.created_at,
                    provider.sort_index,
                    provider.notes,
                    provider.icon,
                    provider.icon_color,
                    serde_json::to_string(&meta_clone).map_err(|e| AppError::Database(format!(
                        "Failed to serialize meta: {e}"
                    )))?,
                    is_current,
                    in_failover_queue,
                    provider.id,
                    app_type,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        } else {
            tx.execute(
                "INSERT INTO providers (
                    id, app_type, name, settings_config, website_url, category,
                    created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    provider.id,
                    app_type,
                    provider.name,
                    serde_json::to_string(&provider.settings_config)
                        .map_err(|e| AppError::Database(format!("Failed to serialize settings_config: {e}")))?,
                    provider.website_url,
                    provider.category,
                    provider.created_at,
                    provider.sort_index,
                    provider.notes,
                    provider.icon,
                    provider.icon_color,
                    serde_json::to_string(&meta_clone)
                        .map_err(|e| AppError::Database(format!("Failed to serialize meta: {e}")))?,
                    is_current,
                    in_failover_queue,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

            for (url, endpoint) in endpoints {
                tx.execute(
                    "INSERT INTO provider_endpoints (provider_id, app_type, url, added_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![provider.id, app_type, url, endpoint.added_at],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            }
        }

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// Replace a provider row under a new ID without exposing an intermediate
    /// duplicate or missing row. Existing endpoint and health references move
    /// with the provider, while its current-state bit is preserved.
    pub fn replace_provider_id(
        &self,
        app_type: &str,
        original_id: &str,
        provider: &Provider,
    ) -> Result<(), AppError> {
        if original_id == provider.id {
            return self.save_provider(app_type, provider);
        }

        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let (is_current, in_failover_queue) = tx
            .query_row(
                "SELECT is_current, in_failover_queue FROM providers WHERE id = ?1 AND app_type = ?2",
                params![original_id, app_type],
                |row| Ok((row.get::<_, bool>(0)?, row.get::<_, bool>(1)?)),
            )
            .optional()
            .map_err(|e| AppError::Database(e.to_string()))?
            .ok_or_else(|| {
                AppError::Database(format!(
                    "Provider '{original_id}' does not exist in app '{app_type}'"
                ))
            })?;

        let target_exists = tx
            .query_row(
                "SELECT 1 FROM providers WHERE id = ?1 AND app_type = ?2",
                params![provider.id, app_type],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| AppError::Database(e.to_string()))?
            .is_some();
        if target_exists {
            return Err(AppError::Database(format!(
                "Provider '{}' already exists in app '{app_type}'",
                provider.id
            )));
        }

        let mut meta = provider.meta.clone().unwrap_or_default();
        meta.custom_endpoints.clear();
        tx.execute(
            "INSERT INTO providers (
                id, app_type, name, settings_config, website_url, category,
                created_at, sort_index, notes, icon, icon_color, meta,
                is_current, in_failover_queue
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                provider.id,
                app_type,
                provider.name,
                serde_json::to_string(&provider.settings_config).map_err(|e| {
                    AppError::Database(format!("Failed to serialize settings_config: {e}"))
                })?,
                provider.website_url,
                provider.category,
                provider.created_at,
                provider.sort_index,
                provider.notes,
                provider.icon,
                provider.icon_color,
                serde_json::to_string(&meta).map_err(|e| {
                    AppError::Database(format!("Failed to serialize meta: {e}"))
                })?,
                is_current,
                in_failover_queue,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "UPDATE provider_endpoints SET provider_id = ?1 WHERE provider_id = ?2 AND app_type = ?3",
            params![provider.id, original_id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute(
            "UPDATE provider_health SET provider_id = ?1 WHERE provider_id = ?2 AND app_type = ?3",
            params![provider.id, original_id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute(
            "DELETE FROM providers WHERE id = ?1 AND app_type = ?2",
            params![original_id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn delete_provider(&self, app_type: &str, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM providers WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn set_current_provider(&self, app_type: &str, id: &str) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "UPDATE providers SET is_current = 0 WHERE app_type = ?1",
            params![app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "UPDATE providers SET is_current = 1 WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn update_provider_settings_config(
        &self,
        app_type: &str,
        provider_id: &str,
        settings_config: &serde_json::Value,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET settings_config = ?1 WHERE id = ?2 AND app_type = ?3",
            params![
                serde_json::to_string(settings_config).map_err(|e| AppError::Database(format!(
                    "Failed to serialize settings_config: {e}"
                )))?,
                provider_id,
                app_type
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn add_custom_endpoint(
        &self,
        app_type: &str,
        provider_id: &str,
        url: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        let added_at = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO provider_endpoints (provider_id, app_type, url, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![provider_id, app_type, url, added_at],
        ).map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn remove_custom_endpoint(
        &self,
        app_type: &str,
        provider_id: &str,
        url: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM provider_endpoints WHERE provider_id = ?1 AND app_type = ?2 AND url = ?3",
            params![provider_id, app_type, url],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn set_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute(
            "UPDATE providers SET is_current = 0 WHERE app_type = ?1 AND category = ?2",
            params![app_type, category],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        // OMO ↔ OMO Slim mutually exclusive: deactivate the opposite category
        let opposite = match category {
            "omo" => Some("omo-slim"),
            "omo-slim" => Some("omo"),
            _ => None,
        };
        if let Some(opp) = opposite {
            tx.execute(
                "UPDATE providers SET is_current = 0 WHERE app_type = ?1 AND category = ?2",
                params![app_type, opp],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        let updated = tx
            .execute(
                "UPDATE providers SET is_current = 1 WHERE id = ?1 AND app_type = ?2 AND category = ?3",
                params![provider_id, app_type, category],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        if updated != 1 {
            return Err(AppError::Database(format!(
                "Failed to set {category} provider current: provider '{provider_id}' not found in app '{app_type}'"
            )));
        }
        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn is_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        match conn.query_row(
            "SELECT is_current FROM providers
             WHERE id = ?1 AND app_type = ?2 AND category = ?3",
            params![provider_id, app_type, category],
            |row| row.get(0),
        ) {
            Ok(is_current) => Ok(is_current),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn clear_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET is_current = 0
             WHERE id = ?1 AND app_type = ?2 AND category = ?3",
            params![provider_id, app_type, category],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_current_omo_provider(
        &self,
        app_type: &str,
        category: &str,
    ) -> Result<Option<Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let row_data: Result<OmoProviderRow, rusqlite::Error> = conn.query_row(
            "SELECT id, name, settings_config, category, created_at, sort_index, notes, meta
             FROM providers
             WHERE app_type = ?1 AND category = ?2 AND is_current = 1
             LIMIT 1",
            params![app_type, category],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        );

        let (id, name, settings_config_str, _row_category, created_at, sort_index, notes, meta_str) =
            match row_data {
                Ok(v) => v,
                Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
                Err(e) => return Err(AppError::Database(e.to_string())),
            };

        let settings_config = serde_json::from_str(&settings_config_str).map_err(|e| {
            AppError::Database(format!(
                "Failed to parse {category} provider settings_config (provider_id={id}): {e}"
            ))
        })?;
        let meta: crate::provider::ProviderMeta = if meta_str.trim().is_empty() {
            crate::provider::ProviderMeta::default()
        } else {
            serde_json::from_str(&meta_str).map_err(|e| {
                AppError::Database(format!(
                    "Failed to parse {category} provider meta (provider_id={id}): {e}"
                ))
            })?
        };

        Ok(Some(Provider {
            id,
            name,
            settings_config,
            website_url: None,
            category: Some(category.to_string()),
            created_at,
            sort_index,
            notes,
            meta: Some(meta),
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        }))
    }

    /// 判断 providers 表是否为空（全 app_type 一起算）。
    ///
    /// 用于区分"全新安装"和"升级用户"：在启动流程 import/seed 之前调用。
    /// 使用 `EXISTS` 短路查询，比 `COUNT(*)` 在将来表变大时更高效。
    pub fn is_providers_empty(&self) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let exists: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM providers)", [], |row| {
                row.get(0)
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(!exists)
    }

    /// 仅获取指定 app 下所有 provider 的 id 集合。
    ///
    /// 比 `get_all_providers` 轻量得多：只读 id 列、无 endpoint 子查询。
    /// 用于只需要做存在性检查的场景（如 additive 模式的 live 同步去重）。
    pub fn get_provider_ids(&self, app_type: &str) -> Result<HashSet<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM providers WHERE app_type = ?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map(params![app_type], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut ids = HashSet::new();
        for row in rows {
            ids.insert(row.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(ids)
    }

    /// 判断指定 app 下是否已存在任意 provider。
    ///
    /// 启动阶段的 live import 需要使用这个更严格的判断：
    /// 只要该 app 已经有任何 provider（包括官方 seed），就不应再自动导入 `default`。
    pub fn has_any_provider_for_app(&self, app_type: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM providers WHERE app_type = ?1)",
                params![app_type],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(exists)
    }

    /// 判断指定 app 下是否存在非官方种子的供应商。
    ///
    /// 比 `get_all_providers` 轻量得多：只读 id 列、无 endpoint 子查询、首条命中即返回。
    /// 用于 `import_default_config` 决定是否跳过 live 导入。
    pub fn has_non_official_seed_provider(&self, app_type: &str) -> Result<bool, AppError> {
        use crate::database::dao::providers_seed::is_official_seed_id;
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM providers WHERE app_type = ?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut rows = stmt
            .query(params![app_type])
            .map_err(|e| AppError::Database(e.to_string()))?;
        while let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            let id: String = row.get(0).map_err(|e| AppError::Database(e.to_string()))?;
            if !is_official_seed_id(&id) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// 计算指定 app 下一个可用的 sort_index（追加到末尾）。
    fn next_sort_index_for_app(&self, app_type: &str) -> Result<usize, AppError> {
        let conn = lock_conn!(self.conn);
        let max: Option<i64> = conn
            .query_row(
                "SELECT MAX(sort_index) FROM providers WHERE app_type = ?1",
                params![app_type],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(max.map(|v| (v + 1) as usize).unwrap_or(0))
    }

    /// 写入平台种子供应商时使用的密钥。
    ///
    /// 优先用用户在本机填写的平台密钥（`aifusion_platform_api_key`）；
    /// 兼容高级部署：没有用户密钥时回退到进程环境变量，便于 CI / 托管环境预置。
    fn platform_seed_api_key(&self) -> String {
        use crate::database::dao::providers_seed::API_KEY_SETTING;

        self.get_setting(API_KEY_SETTING)
            .ok()
            .flatten()
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty())
            .or_else(|| {
                std::env::var("AIFUSION_API_KEY")
                    .ok()
                    .map(|key| key.trim().to_string())
                    .filter(|key| !key.is_empty())
            })
            .unwrap_or_default()
    }

    /// 把旧版内置平台地址迁移到当前平台地址。
    ///
    /// 只处理内置平台供应商行，且仅在检测到旧地址时改写；同时清空旧平台
    /// 下发的 Key：新网关不认旧凭据，继续保留只会让各客户端拿着无效 Key。
    /// 模型、上下文等用户自定义保持不变。
    pub fn migrate_official_provider_endpoints(&self) -> Result<usize, AppError> {
        use crate::database::dao::providers_seed::{
            apply_api_key, replace_legacy_platform_site, LEGACY_PLATFORM_SITE, PLATFORM_SEEDS,
            PLATFORM_SITE,
        };

        let mut migrated = 0_usize;
        for seed in PLATFORM_SEEDS {
            let app = seed.app_type.as_str();
            let Some(mut provider) = self.get_provider_by_id(seed.id, app)? else {
                continue;
            };
            let legacy_website = provider
                .website_url
                .as_deref()
                .map(|url| url.contains(LEGACY_PLATFORM_SITE))
                .unwrap_or(false);
            let mut config = provider.settings_config.clone();
            let legacy_config = replace_legacy_platform_site(&mut config);
            if !legacy_website && !legacy_config {
                continue;
            }

            // 旧网关的 Key 在新网关上无效，迁移时一并清空，等网页登录重新下发。
            apply_api_key(&seed.app_type, &mut config, "");
            provider.settings_config = config;
            if legacy_website {
                provider.website_url = Some(PLATFORM_SITE.to_string());
            }
            self.save_provider(app, &provider)?;
            migrated += 1;
            log::info!(
                "✓ Migrated AIFusion platform endpoint for {} to {PLATFORM_SITE}",
                seed.id
            );
        }

        if migrated > 0 {
            use crate::database::dao::providers_seed::API_KEY_SETTING;
            self.set_setting(API_KEY_SETTING, "")?;
        }
        Ok(migrated)
    }

    /// 把平台已下架的默认模型换成当前默认值。
    ///
    /// 平台改版下架旧模型后（`hy4-preview`），各客户端配置里仍写着它，切过去就是
    /// 404。这里只覆盖内置平台供应商行（含 Claude Desktop 的模型映射），返回其中
    /// 「当前正在使用该供应商」的应用，由调用方重投影 live；用户自己换过模型的
    /// 行会跟着一起归一（因为旧模型已经不可用），但不会改动非平台供应商。
    pub fn migrate_official_provider_models(&self) -> Result<Vec<String>, AppError> {
        use crate::database::dao::providers_seed::{
            replace_retired_platform_model, PLATFORM_DEFAULT_MODEL, RETIRED_PLATFORM_MODELS,
        };

        let mut apps_to_sync: Vec<String> = Vec::new();

        for seed in crate::database::dao::providers_seed::PLATFORM_SEEDS {
            let app = seed.app_type.as_str();
            let Some(mut provider) = self.get_provider_by_id(seed.id, app)? else {
                continue;
            };

            let mut changed = replace_retired_platform_model(&mut provider.settings_config);
            if let Some(meta) = provider.meta.as_mut() {
                for route in meta.claude_desktop_model_routes.values_mut() {
                    if RETIRED_PLATFORM_MODELS.contains(&route.model.as_str()) {
                        route.model = PLATFORM_DEFAULT_MODEL.to_string();
                        changed = true;
                    }
                    if route
                        .label_override
                        .as_deref()
                        .is_some_and(|label| RETIRED_PLATFORM_MODELS.contains(&label))
                    {
                        route.label_override = Some(PLATFORM_DEFAULT_MODEL.to_string());
                        changed = true;
                    }
                }
            }
            if !changed {
                continue;
            }

            let is_current = self
                .get_current_provider(app)?
                .as_deref()
                .map(|id| id == seed.id)
                .unwrap_or(false);
            self.save_provider(app, &provider)?;
            log::info!("✓ 已把 {} 的平台默认模型换成 {PLATFORM_DEFAULT_MODEL}", seed.id);
            if is_current {
                apps_to_sync.push(app.to_string());
            }
        }

        Ok(apps_to_sync)
    }

    /// 启动时调用：补齐缺失的平台供应商（10 个客户端各一条）。
    ///
    /// 本应用只对接 AIFusion 平台，平台供应商是可用性的前提，因此每次启动都会
    /// 检查并补回缺失的行（用户改过的行原样保留，不会覆盖）：
    /// - 全新用户：写入 10 条平台供应商，并设为当前供应商
    /// - 老用户升级：只补缺失的应用，追加到末尾，不影响已有排序
    /// - 用户删除某条后：下次启动会补回，避免该客户端无可用供应商
    ///
    /// `aifusion_platform_seeded` 仅用于记录「首次 seed 已完成」，不阻止后续补齐。
    /// 与 `Database::save_provider` 的 UPSERT 语义配合，即使被意外重复调用
    /// 也不会覆盖用户当前激活的供应商（is_current 字段会被保留）。
    pub fn init_default_official_providers(&self) -> Result<usize, AppError> {
        use crate::database::dao::providers_seed::{render_seed_config, PLATFORM_SEEDS};

        let first_run = !self
            .get_bool_flag("aifusion_platform_seeded")
            .unwrap_or(false);

        let mut inserted = 0_usize;
        let now_ms = chrono::Utc::now().timestamp_millis();

        for seed in PLATFORM_SEEDS {
            let app_type_str = seed.app_type.as_str();

            // 若该 id 已存在（用户曾手动用过同 id），跳过插入但仍可能补设当前
            if self.get_provider_by_id(seed.id, app_type_str)?.is_none() {
                let next_sort_index = self.next_sort_index_for_app(app_type_str)?;

                // 源码只存占位符，真实密钥与平台地址在运行时注入。
                let api_key = self.platform_seed_api_key();
                let raw_config = render_seed_config(seed, &api_key);
                let settings_config: serde_json::Value = serde_json::from_str(&raw_config)
                    .map_err(|e| {
                        AppError::Database(format!("Seed JSON parse failed for {}: {e}", seed.id))
                    })?;

                let mut provider = Provider::with_id(
                    seed.id.to_string(),
                    seed.name.to_string(),
                    settings_config,
                    Some(seed.website_url.to_string()),
                );
                provider.category = Some(seed.category.to_string());
                provider.icon = Some(seed.icon.to_string());
                provider.icon_color = Some(seed.icon_color.to_string());
                provider.sort_index = Some(next_sort_index);
                provider.created_at = Some(now_ms);
                if let Some(meta_json) = seed.meta_json {
                    provider.meta = Some(serde_json::from_str(meta_json).map_err(|e| {
                        AppError::Database(format!("Seed meta parse failed for {}: {e}", seed.id))
                    })?);
                }

                self.save_provider(app_type_str, &provider)?;
                inserted += 1;
                log::info!(
                    "✓ Seeded AIFusion platform provider: {} ({})",
                    seed.name,
                    app_type_str
                );
            }

            // 仅当该应用尚无当前供应商（或当前是导入产生的 "default"）时，
            // 把平台设为当前，避免每次启动覆盖用户后续的选择。
            let needs_default = matches!(
                self.get_current_provider(app_type_str)?.as_deref(),
                None | Some("") | Some("default")
            );
            if needs_default {
                self.set_current_provider(app_type_str, seed.id)?;
            }
        }

        // 即使 inserted=0（例如用户手动创建过同 id）也设置 flag 防止反复检查
        if first_run {
            self.set_setting("aifusion_platform_seeded", "true")?;
        }

        Ok(inserted)
    }

    /// 按 id 兜底插入单条 official seed（仅当目标表中该 id 不存在时插入）。
    ///
    /// 与 `init_default_official_providers` 不同：
    /// - 不触碰 `aifusion_platform_seeded` 全局 flag，是 on-demand 修复
    /// - 只处理一条 seed，由调用方决定 id + app_type
    /// - 已存在则尊重用户自定义，不覆盖
    ///
    /// 返回 Ok(true) 表示插入了新行，Ok(false) 表示已存在被跳过。
    pub fn ensure_official_seed_by_id(
        &self,
        seed_id: &str,
        app_type: crate::app_config::AppType,
    ) -> Result<bool, AppError> {
        use crate::database::dao::providers_seed::{render_seed_config, PLATFORM_SEEDS};

        let seed = PLATFORM_SEEDS
            .iter()
            .find(|s| s.id == seed_id && s.app_type == app_type)
            .ok_or_else(|| {
                AppError::Database(format!(
                    "unknown platform seed: id={seed_id}, app_type={}",
                    app_type.as_str()
                ))
            })?;

        let app_type_str = seed.app_type.as_str();

        if self.get_provider_by_id(seed_id, app_type_str)?.is_some() {
            return Ok(false);
        }

        let api_key = self.platform_seed_api_key();
        let raw_config = render_seed_config(seed, &api_key);
        let settings_config: serde_json::Value =
            serde_json::from_str(&raw_config).map_err(|e| {
                AppError::Database(format!("Seed JSON parse failed for {}: {e}", seed.id))
            })?;

        let next_sort_index = self.next_sort_index_for_app(app_type_str)?;
        let now_ms = chrono::Utc::now().timestamp_millis();

        let mut provider = Provider::with_id(
            seed.id.to_string(),
            seed.name.to_string(),
            settings_config,
            Some(seed.website_url.to_string()),
        );
        provider.category = Some(seed.category.to_string());
        provider.icon = Some(seed.icon.to_string());
        provider.icon_color = Some(seed.icon_color.to_string());
        provider.sort_index = Some(next_sort_index);
        provider.created_at = Some(now_ms);
        if let Some(meta_json) = seed.meta_json {
            provider.meta = Some(serde_json::from_str(meta_json).map_err(|e| {
                AppError::Database(format!("Seed meta parse failed for {}: {e}", seed.id))
            })?);
        }

        self.save_provider(app_type_str, &provider)?;

        Ok(true)
    }
}

#[cfg(test)]
mod ensure_official_seed_tests {
    use crate::app_config::AppType;
    use crate::database::{
        Database, CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, CODEX_OFFICIAL_PROVIDER_ID,
        GROKBUILD_OFFICIAL_PROVIDER_ID,
    };

    #[test]
    fn ensure_inserts_when_missing() {
        let db = Database::memory().expect("memory db");
        let inserted = db
            .ensure_official_seed_by_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, AppType::ClaudeDesktop)
            .expect("ensure ok");
        assert!(inserted, "should insert when missing");

        let provider = db
            .get_provider_by_id(
                CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
                AppType::ClaudeDesktop.as_str(),
            )
            .expect("query ok")
            .expect("provider exists after ensure");

        assert_eq!(provider.id, CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID);
        assert_eq!(provider.name, "AIFusion");
        assert_eq!(provider.category.as_deref(), Some("third_party"));
        assert_eq!(provider.icon.as_deref(), Some("openai"));
        assert_eq!(provider.icon_color.as_deref(), Some("#6366F1"));
    }

    #[test]
    fn ensure_skips_when_present_and_preserves_customization() {
        let db = Database::memory().expect("memory db");
        db.init_default_official_providers().expect("seed");

        let mut renamed = db
            .get_provider_by_id(
                CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
                AppType::ClaudeDesktop.as_str(),
            )
            .expect("query ok")
            .expect("seed present");
        renamed.name = "My Custom Backup".to_string();
        db.save_provider(AppType::ClaudeDesktop.as_str(), &renamed)
            .expect("save customization");

        let inserted = db
            .ensure_official_seed_by_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, AppType::ClaudeDesktop)
            .expect("ensure ok");
        assert!(!inserted, "should skip when present");

        let after = db
            .get_provider_by_id(
                CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
                AppType::ClaudeDesktop.as_str(),
            )
            .expect("query ok")
            .expect("still present");
        assert_eq!(
            after.name, "My Custom Backup",
            "customization must not be overwritten"
        );
    }

    #[test]
    fn ensure_recreates_codex_official_seed_after_deletion() {
        let db = Database::memory().expect("memory db");
        db.init_default_official_providers().expect("seed");
        db.delete_provider(AppType::Codex.as_str(), CODEX_OFFICIAL_PROVIDER_ID)
            .expect("delete Codex official");

        let inserted = db
            .ensure_official_seed_by_id(CODEX_OFFICIAL_PROVIDER_ID, AppType::Codex)
            .expect("ensure Codex official");
        assert!(inserted);
        let provider = db
            .get_provider_by_id(CODEX_OFFICIAL_PROVIDER_ID, AppType::Codex.as_str())
            .expect("query")
            .expect("Codex official restored");
        assert_eq!(provider.category.as_deref(), Some("third_party"));
        assert_eq!(
            provider.settings_config["auth"]["OPENAI_API_KEY"],
            serde_json::json!(std::env::var("AIFUSION_API_KEY").unwrap_or_default())
        );
    }

    #[test]
    fn ensure_recreates_grokbuild_official_seed_after_deletion() {
        let db = Database::memory().expect("memory db");
        db.init_default_official_providers().expect("seed");
        db.delete_provider(AppType::GrokBuild.as_str(), GROKBUILD_OFFICIAL_PROVIDER_ID)
            .expect("delete Grok Build official");

        let inserted = db
            .ensure_official_seed_by_id(GROKBUILD_OFFICIAL_PROVIDER_ID, AppType::GrokBuild)
            .expect("ensure Grok Build official");
        assert!(inserted);
        let provider = db
            .get_provider_by_id(GROKBUILD_OFFICIAL_PROVIDER_ID, AppType::GrokBuild.as_str())
            .expect("query")
            .expect("Grok Build official restored");
        assert_eq!(provider.category.as_deref(), Some("third_party"));
        // config 指向平台 OpenAI 兼容端点，wire_api 走 responses
        let config = provider.settings_config["config"]
            .as_str()
            .expect("config is a TOML string");
        assert!(config.contains("base_url = \"https://op.aifusion.sbs/v1\""));
        assert!(config.contains("api_backend = \"responses\""));
    }

    #[test]
    fn ensure_rejects_unknown_seed() {
        let db = Database::memory().expect("memory db");
        let result = db.ensure_official_seed_by_id("nonexistent-id", AppType::ClaudeDesktop);
        assert!(result.is_err(), "unknown seed id should be Err");
    }

    #[test]
    fn ensure_rejects_seed_app_type_mismatch() {
        let db = Database::memory().expect("memory db");
        let result =
            db.ensure_official_seed_by_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, AppType::Claude);
        assert!(result.is_err(), "(id, app_type) mismatch should be Err");
    }

    #[test]
    fn migrates_legacy_platform_endpoint_and_clears_old_key() {
        use crate::database::dao::providers_seed::{
            API_KEY_SETTING, LEGACY_PLATFORM_SITE, PLATFORM_SITE,
        };

        let db = Database::memory().expect("memory db");
        db.init_default_official_providers().expect("seed");
        let mut provider = db
            .get_provider_by_id("claude-official", AppType::Claude.as_str())
            .expect("query")
            .expect("platform row");
        provider.settings_config["env"]["ANTHROPIC_BASE_URL"] =
            serde_json::json!(format!("{LEGACY_PLATFORM_SITE}/v1"));
        provider.settings_config["env"]["ANTHROPIC_AUTH_TOKEN"] = serde_json::json!("legacy-key");
        provider.website_url = Some(LEGACY_PLATFORM_SITE.to_string());
        db.save_provider(AppType::Claude.as_str(), &provider)
            .expect("save legacy row");
        db.set_setting(API_KEY_SETTING, "legacy-key")
            .expect("store legacy key");

        assert_eq!(
            db.migrate_official_provider_endpoints().expect("migrate"),
            1
        );

        let migrated = db
            .get_provider_by_id("claude-official", AppType::Claude.as_str())
            .expect("query")
            .expect("platform row");
        assert_eq!(
            migrated.settings_config["env"]["ANTHROPIC_BASE_URL"],
            serde_json::json!(format!("{PLATFORM_SITE}/v1"))
        );
        assert_eq!(
            migrated.settings_config["env"]["ANTHROPIC_AUTH_TOKEN"],
            serde_json::json!("")
        );
        assert_eq!(migrated.website_url.as_deref(), Some(PLATFORM_SITE));
        assert_eq!(
            db.get_setting(API_KEY_SETTING).expect("read"),
            Some(String::new())
        );
        // 再跑一次不应重复改写。
        assert_eq!(
            db.migrate_official_provider_endpoints().expect("migrate"),
            0
        );
    }

    #[test]
    fn migrate_official_provider_models_swaps_retired_default() {
        use crate::database::dao::providers_seed::PLATFORM_DEFAULT_MODEL;

        let db = Database::memory().expect("memory db");
        db.init_default_official_providers().expect("seed");
        let app = AppType::Claude.as_str();
        let mut provider = db
            .get_provider_by_id("claude-official", app)
            .expect("query")
            .expect("platform row");
        provider.settings_config["env"]["ANTHROPIC_MODEL"] = serde_json::json!("hy4-preview");
        provider.settings_config["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"] =
            serde_json::json!("glm-5.3-flash");
        db.save_provider(app, &provider).expect("save retired row");

        // claude 是当前供应商：迁移后应返回需要重投影的应用列表。
        let synced = db
            .migrate_official_provider_models()
            .expect("migrate models");
        assert!(synced.iter().any(|name| name == app), "{synced:?}");

        let migrated = db
            .get_provider_by_id("claude-official", app)
            .expect("query")
            .expect("platform row");
        assert_eq!(
            migrated.settings_config["env"]["ANTHROPIC_MODEL"],
            serde_json::json!(PLATFORM_DEFAULT_MODEL)
        );
        assert_eq!(
            migrated.settings_config["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"],
            serde_json::json!("glm-5.3-flash"),
            "用户自己选的轻量模型不该被覆盖"
        );

        // 幂等：第二次没有东西可改。
        assert!(db
            .migrate_official_provider_models()
            .expect("migrate again")
            .is_empty());
    }
}
