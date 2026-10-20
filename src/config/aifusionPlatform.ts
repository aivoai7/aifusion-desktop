/**
 * AIFusion 自有平台单一事实源。
 *
 * 本应用只对接 AIFusion 平台（OpenAI 兼容网关），所有供应商预设与后端 seed
 * 都从这里取值，避免多处硬编码漂移。
 */
export const AIFUSION_NAME = "AIFusion";

/** 平台供应商在数据库中的固定 id（供后端 seed 与前端预设复用）。 */
export const AIFUSION_PROVIDER_ID = "aifusion-platform";

/** 平台站点地址（网页登录与展示）。 */
export const AIFUSION_WEBSITE_URL = "https://op.aifusion.sbs";

/** OpenAI 兼容 API Base URL。 */
export const AIFUSION_BASE_URL = "https://op.aifusion.sbs/v1";

/**
 * 平台访问密钥。
 *
 * 不在前端打包产物里保存任何平台密钥：用户首次启动时在应用内填写自己的
 * Key，由后端存入 SQLite 并下发到各客户端的平台供应商。预设模板里的
 * 密钥字段一律留空，避免把共享密钥打进安装包。
 */

/** 主力模型。 */
export const AIFUSION_MODEL = "hy4-preview";

/** 轻量模型。 */
export const AIFUSION_LIGHT_MODEL = "glm-5.3-flash";

/** 主力模型声明的上下文窗口。 */
export const AIFUSION_MODEL_CONTEXT = 960000;
