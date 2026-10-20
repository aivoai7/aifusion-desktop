import { invoke } from "@tauri-apps/api/core";

export interface PlatformKeyStatus {
  configured: boolean;
  /** 形如 `abcd…wxyz`，未配置时为 null。 */
  maskedKey: string | null;
  /** `user` = 本机填写；`environment` = 托管环境变量；未配置为 null。 */
  source: "user" | "environment" | null;
  baseUrl: string;
}

export interface PlatformKeyApplyResult {
  updatedProviders: number;
  syncedApps: string[];
  syncFailures: string[];
}

export interface PlatformKeyValidation {
  valid: boolean;
  message: string;
  httpStatus: number | null;
}

export interface PlatformLoginResult extends PlatformKeyApplyResult {
  /** 平台里取到的那把 Key 的名称。 */
  keyName: string;
  /** 取到的 Key 的脱敏展示。 */
  maskedKey: string;
}

export const platformKeyApi = {
  async status(): Promise<PlatformKeyStatus> {
    return await invoke("get_platform_api_key_status");
  },

  /**
   * 用系统默认浏览器打开平台官网登录，成功后自动取 Key 并下发。
   * 用户在桌面端取消等待时返回 null（不算失败）。
   */
  async loginWeb(): Promise<PlatformLoginResult | null> {
    return await invoke("login_platform_web");
  },

  /** 取消正在等待的浏览器登录。 */
  async cancelLoginWeb(): Promise<boolean> {
    return await invoke("cancel_platform_web_login");
  },

  /** 保存前先校验，避免用户存下一把必然 401 的 Key。 */
  async validate(apiKey: string): Promise<PlatformKeyValidation> {
    return await invoke("validate_platform_api_key", { apiKey });
  },

  async save(apiKey: string): Promise<PlatformKeyApplyResult> {
    return await invoke("set_platform_api_key", { apiKey });
  },

  async clear(): Promise<PlatformKeyApplyResult> {
    return await invoke("clear_platform_api_key");
  },

  async site(): Promise<string> {
    return await invoke("get_platform_site");
  },
};
