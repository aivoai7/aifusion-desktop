import type { AppId } from "@/lib/api";

/**
 * 主窗口的导航模型（v10）：侧栏与设置页都去掉了，
 * 首页总览是唯一入口，页头承担外壳。
 *
 * - 首页：平台读数 + 客户端账本，是启动后的落地页，也是品牌块的回程目标。
 * - 应用页：点首页一行进入详情；OpenClaw、Hermes 在页头下用页签切到自己的专属页。
 * - 全局页：顶栏只露出用量统计；MCP、Skills、提示词、会话保留路由，但不再占一级入口。
 *   「应用」页（客户端安装与升级）从应用页 ⋯ 菜单进入。
 */

export type AppPage =
  | "providers"
  | "workspace"
  | "openclawConfig"
  | "hermesMemory";

export type GlobalPage =
  | "usage"
  | "mcp"
  | "skills"
  | "skillsDiscovery"
  | "prompts"
  | "sessions"
  | "apps";

export type View = "home" | AppPage | GlobalPage;

const APP_PAGES: AppPage[] = [
  "providers",
  "workspace",
  "openclawConfig",
  "hermesMemory",
];

const GLOBAL_PAGES: GlobalPage[] = [
  "usage",
  "mcp",
  "skills",
  "skillsDiscovery",
  "prompts",
  "sessions",
  "apps",
];

/** 已从顶栏移除的全局页：保留页面本身，但启动时不再作为落地页。 */
const HIDDEN_GLOBAL_PAGES: View[] = [
  "mcp",
  "skills",
  "skillsDiscovery",
  "prompts",
  "sessions",
];

export const VIEW_STORAGE_KEY = "aifusion-last-view";
export const APP_STORAGE_KEY = "aifusion-last-app";

/** 旧版视图名 → 新视图（OpenClaw 的三个配置页合成了一个）。 */
const LEGACY_VIEWS: Record<string, View> = {
  openclawEnv: "openclawConfig",
  openclawTools: "openclawConfig",
  openclawAgents: "openclawConfig",
};

export function isAppPage(view: View): view is AppPage {
  return (APP_PAGES as string[]).includes(view);
}

export function isGlobalPage(view: View): view is GlobalPage {
  return (GLOBAL_PAGES as string[]).includes(view);
}

export function parseView(value: string | null | undefined): View | null {
  if (!value) return null;
  if (value in LEGACY_VIEWS) return LEGACY_VIEWS[value];
  if (value === "home") return "home";
  if ((APP_PAGES as string[]).includes(value)) return value as AppPage;
  if ((GLOBAL_PAGES as string[]).includes(value)) return value as GlobalPage;
  return null;
}

/** 应用专属页只对它所属的应用成立；换了应用就回到供应商页。 */
export function appPageBelongsTo(page: AppPage, app: AppId): boolean {
  switch (page) {
    case "providers":
      return true;
    case "workspace":
    case "openclawConfig":
      return app === "openclaw";
    case "hermesMemory":
      return app === "hermes";
  }
}

export function readStoredView(): View {
  try {
    const stored = parseView(localStorage.getItem(VIEW_STORAGE_KEY));
    // 首页是新的落地页；上次停在应用页或用量页就回到那一页。
    // 已从顶栏移除的页面回总览。
    if (stored && !HIDDEN_GLOBAL_PAGES.includes(stored)) {
      return stored;
    }
    return "home";
  } catch {
    return "home";
  }
}

export function storeView(view: View) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // 存不了就算了：下次启动回到首页总览
  }
}

/** 提示词、会话页在 Claude Desktop 上看的是 Claude Code 的内容（两者共用）。 */
export function sharedFeatureAppOf(app: AppId): AppId {
  return app === "claude-desktop" ? "claude" : app;
}
