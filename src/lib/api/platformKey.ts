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

/** 平台上的一个可用模型（不含任何地址或密钥信息）。 */
export interface PlatformModelOption {
  id: string;
  /** 所属厂商，用于分组展示。 */
  provider: string;
}

/** 某个客户端当前的平台模型配置。 */
export interface PlatformModelConfig {
  /** 该客户端能不能指定一个主模型（切换型客户端）。 */
  supportsDefault: boolean;
  /** 是否有独立的轻量模型槽位（Claude Code / Claude Desktop）。 */
  supportsLight: boolean;
  /** 是否可以勾选一批可用模型（附加型客户端各自维护模型表）。 */
  supportsList: boolean;
  defaultModel: string | null;
  lightModel: string | null;
  models: string[];
  /** 该客户端此刻是否在用它自己的 live 配置（否则要切回来才生效）。 */
  usingPlatform: boolean;
  connected: boolean;
}

export interface PlatformModelApplyResult {
  app: string;
  synced: boolean;
  message: string | null;
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

  /**
   * 平台钱包余额（美元）。未登录或平台还没有钱包接口时返回 null，
   * 其余失败抛错，由调用方决定是保留上次数值还是提示。
   */
  async walletBalance(): Promise<number | null> {
    return await invoke("get_platform_wallet_balance");
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

  /** 平台实时模型列表；未登录时后端返回空数组。 */
  async models(): Promise<PlatformModelOption[]> {
    return await invoke("get_platform_models");
  },

  /** 某个客户端当前的平台模型配置。 */
  async modelConfig(app: string): Promise<PlatformModelConfig> {
    return await invoke("get_platform_model_config", { app });
  },

  /** 保存模型选择：后端写回该客户端的平台供应商并尽量立即重投影 live。 */
  async saveModel(
    app: string,
    selection: {
      defaultModel?: string | null;
      lightModel?: string | null;
      models?: string[] | null;
    },
  ): Promise<PlatformModelApplyResult> {
    return await invoke("set_platform_model", {
      app,
      defaultModel: selection.defaultModel ?? null,
      lightModel: selection.lightModel ?? null,
      models: selection.models ?? null,
    });
  },
};
