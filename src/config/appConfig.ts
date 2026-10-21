import type { AppId } from "@/lib/api/types";
import type { VisibleApps } from "@/types";

/**
 * 应用名：品牌名不翻译，五种语言都写原文。
 * 这里是唯一出处，`shell/AppGlyph` 只是把它转出去给组件用（`APP_DISPLAY_NAME`）。
 */
export const APP_LABELS: Record<AppId, string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  gemini: "Gemini CLI",
  grokbuild: "Grok Build",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  pi: "Pi",
  mcode: "MiniMax Code",
};

export const APP_IDS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
  "mcode",
];

export const DEFAULT_VISIBLE_APPS: VisibleApps = {
  claude: true,
  "claude-desktop": true,
  codex: true,
  gemini: true,
  grokbuild: true,
  opencode: true,
  openclaw: true,
  hermes: true,
  pi: true,
  mcode: true,
};

/** App IDs shown in Skills panels. */
export const SKILLS_APP_IDS: AppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "hermes",
  "pi",
  "mcode",
];

export type ProxyAppId = Extract<
  AppId,
  "claude" | "codex" | "gemini" | "grokbuild"
>;

/** Apps with a complete local gateway + failover data plane. */
export const PROXY_APP_IDS: ProxyAppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
];

export function isProxyAppId(appId: string): appId is ProxyAppId {
  return (PROXY_APP_IDS as string[]).includes(appId);
}

/**
 * 有直连 / 路由模式的应用（后端 `AppType::has_route_mode`）：上面四个，加上 Claude Desktop。
 * Desktop 经同一个路由服务转发，但没有故障转移和路由设置（不在 `PROXY_APP_IDS` 里）。
 */
export type ModeAppId = ProxyAppId | "claude-desktop";

export const MODE_APP_IDS: ModeAppId[] = [...PROXY_APP_IDS, "claude-desktop"];

export function isModeAppId(appId: string): appId is ModeAppId {
  return (MODE_APP_IDS as string[]).includes(appId);
}

/** 支持 Stack 模式的应用（后端 `mode::stack::supports_stack` 的镜像）。 */
export type StackAppId = Extract<
  ModeAppId,
  "claude" | "codex" | "claude-desktop"
>;

export const STACK_APP_IDS: StackAppId[] = [
  "claude",
  "codex",
  "claude-desktop",
];

export function isStackAppId(appId: string): appId is StackAppId {
  return (STACK_APP_IDS as string[]).includes(appId);
}

export type AdditiveAppId = Extract<
  AppId,
  "opencode" | "openclaw" | "hermes" | "pi" | "mcode"
>;

export const ADDITIVE_APP_IDS: AdditiveAppId[] = [
  "mcode",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
];

export function isAdditiveAppId(appId: string): appId is AdditiveAppId {
  return (ADDITIVE_APP_IDS as string[]).includes(appId);
}

/**
 * 切换只替换关键字段的应用：供应商编辑器显示「切到这个供应商之后配置文件的样子」，由后端
 * `ProviderService::editor_view` 投影。
 */
export const EDITOR_VIEW_APP_IDS: AppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
];

export function usesEditorView(appId: AppId): boolean {
  return EDITOR_VIEW_APP_IDS.includes(appId);
}

/** Claude Desktop、OpenClaw 不由 AIFusion 管理 MCP；Pi 1.0 起内置 MCP（`~/.pi/agent/mcp.json`） */
export type McpAppId = Exclude<AppId, "claude-desktop" | "openclaw">;
export const MCP_APP_IDS: McpAppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "hermes",
  "pi",
  "mcode",
];

export function isMcpAppId(appId: string): appId is McpAppId {
  return (MCP_APP_IDS as string[]).includes(appId);
}

export function getAppLabel(appId: string): string {
  return APP_LABELS[appId as AppId] ?? appId;
}
