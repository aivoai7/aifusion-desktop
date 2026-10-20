/**
 * AIFusion 自有平台单一事实源。
 *
 * 本应用只对接 AIFusion 平台（OpenAI 兼容网关），所有供应商预设与后端 seed
 * 都从这里取值，避免多处硬编码漂移。
 */
export const AIFUSION_NAME = "AIFusion";

/** 平台供应商在数据库中的固定 id（供后端 seed 与前端预设复用）。 */
export const AIFUSION_PROVIDER_ID = "aifusion-platform";

/** 平台站点地址（用于展示）。 */
export const AIFUSION_WEBSITE_URL = "http://192.168.5.125:8788";

/** OpenAI 兼容 API Base URL。 */
export const AIFUSION_BASE_URL = "http://192.168.5.125:8788/v1";

/**
 * 平台访问密钥。
 *
 * 源码不落库真实密钥：构建时从 `VITE_AIFUSION_API_KEY` 注入
 * （见 `.env.local`，已被 .gitignore 排除）。
 */
export const AIFUSION_API_KEY =
  (import.meta.env.VITE_AIFUSION_API_KEY as string | undefined) ?? "";

/** 主力模型。 */
export const AIFUSION_MODEL = "hy4-preview";

/** 轻量模型。 */
export const AIFUSION_LIGHT_MODEL = "glm-5.3-flash";

/** 主力模型声明的上下文窗口。 */
export const AIFUSION_MODEL_CONTEXT = 960000;
