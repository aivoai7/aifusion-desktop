import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppId } from "@/lib/api";
import type { PlatformModelConfig } from "@/lib/api/platformKey";

const mocks = vi.hoisted(() => ({
  configured: true,
  wallet: 1234.5 as number | null,
  models: [] as { id: string; provider: string }[],
  modelConfig: vi.fn(),
  summary: null as null | {
    totalRequests: number;
    totalCost: string;
    realTotalTokens: number;
  },
  trends: [] as { date: string; requestCount: number }[],
  setTakeover: vi.fn(
    async (_app: string, _enabled: boolean, _stack: boolean) => {},
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // 测试里没有加载语言包：有 defaultValue 就用它，并把 {{param}} 就地替换
    t: (
      key: string,
      params?: Record<string, unknown> & { defaultValue?: string },
    ) => {
      const raw = params?.defaultValue ?? key;
      return Object.entries(params ?? {}).reduce(
        (acc, [name, value]) =>
          acc.replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), String(value)),
        raw,
      );
    },
  }),
}));

vi.mock("@/lib/query", () => ({
  usePlatformKeyStatusQuery: () => ({
    data: {
      configured: mocks.configured,
      maskedKey: mocks.configured ? "abcd…wxyz" : null,
      source: mocks.configured ? "user" : null,
      baseUrl: "https://op.aifusion.sbs",
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/api/platformKey", () => ({
  platformKeyApi: {
    modelConfig: mocks.modelConfig,
    models: async () => mocks.models,
    walletBalance: async () => mocks.wallet,
  },
}));

// 「全部走路由」逐个调用后端接管，测试里只记录调用
vi.mock("@/lib/api/proxy", () => ({
  proxyApi: {
    setProxyTakeoverForApp: mocks.setTakeover,
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/query/usage", () => ({
  useUsageSummary: () => ({ data: mocks.summary }),
  useUsageTrends: () => ({ data: mocks.trends }),
}));

vi.mock("@/hooks/useSidebarStatus", () => ({
  useSidebarStatus: () => ({
    appStatus: () => ({ mode: "direct", alert: false }),
  }),
}));

vi.mock("@/hooks/usePlatformWebLogin", () => ({
  usePlatformWebLogin: () => ({
    login: vi.fn(),
    cancel: async () => {},
    busy: false,
    error: null,
    clearError: () => {},
  }),
}));

vi.mock("@/components/apps/useToolManagement", () => ({
  useToolManagement: () => ({
    updatableToolNames: [] as string[],
    isLoadingTools: false,
    isAnyBusy: false,
    batchAction: null,
    lastCheckedAt: null,
    pendingUpgrade: null,
    checkForUpdates: vi.fn(async () => {}),
    handleRunToolAction: vi.fn(async () => {}),
    handleConfirmUpgrade: vi.fn(),
    handleCancelUpgrade: vi.fn(),
  }),
  toolDisplayName: (name: string) => name,
}));

vi.mock("@/components/settings/ToolUpgradeConfirmDialog", () => ({
  ToolUpgradeConfirmDialog: () => null,
}));

import { HomeOverview } from "@/components/home/HomeOverview";

const PAIR: PlatformModelConfig = {
  supportsDefault: true,
  supportsLight: true,
  supportsList: false,
  defaultModel: "claude-sonnet-5",
  lightModel: "glm-5.3-flash",
  models: [],
  usingPlatform: true,
  connected: true,
};
const SINGLE: PlatformModelConfig = {
  ...PAIR,
  supportsLight: false,
  lightModel: null,
};
const LIST: PlatformModelConfig = {
  ...PAIR,
  supportsDefault: false,
  supportsLight: false,
  supportsList: true,
  defaultModel: null,
  lightModel: null,
  models: ["claude-sonnet-5", "glm-5.3-flash", "deepseek-v4-pro"],
};
const LOCAL: PlatformModelConfig = { ...SINGLE, connected: false };

function stubConfigs(
  overrides: Partial<Record<AppId, PlatformModelConfig>> = {},
) {
  mocks.modelConfig.mockImplementation(async (app: string) => {
    if (overrides[app as AppId]) return overrides[app as AppId];
    if (app === "claude" || app === "claude-desktop") return PAIR;
    if (app === "opencode" || app === "hermes") return LIST;
    if (app === "pi") return LOCAL;
    return SINGLE;
  });
}

function renderHome(
  onOpenApp = vi.fn(),
  onOpenPage = vi.fn(),
  onOpenKeySettings = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const visibleApps = Object.fromEntries(
    [
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
    ].map((app) => [app, true]),
  ) as Record<AppId, boolean>;

  return {
    onOpenApp,
    onOpenPage,
    onOpenKeySettings,
    ...render(
      <QueryClientProvider client={client}>
        <HomeOverview
          visibleApps={visibleApps}
          activeApp="codex"
          onOpenApp={onOpenApp}
          onOpenPage={onOpenPage}
          onOpenKeySettings={onOpenKeySettings}
        />
      </QueryClientProvider>,
    ),
  };
}

/** 取一格 KPI 的整块文本（标签的父节点就是那一格）。 */
function kpi(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

describe("HomeOverview", () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.wallet = 1234.5;
    mocks.models = [
      { id: "claude-sonnet-5", provider: "anthropic" },
      { id: "glm-5.3-flash", provider: "z.ai" },
      { id: "gpt-5.5", provider: "openai" },
    ];
    mocks.summary = null;
    mocks.trends = [];
    stubConfigs();
  });

  it("shows the platform card with real balance, model count and connected apps", async () => {
    renderHome();

    expect(await screen.findByText("AIFusion 平台")).toBeInTheDocument();
    expect(screen.getByText("已连接")).toBeInTheDocument();
    expect(await screen.findByText("$1,234.50")).toBeInTheDocument();
    await waitFor(() => expect(kpi("已接入客户端")).toHaveTextContent("9"));
    expect(kpi("已接入客户端")).toHaveTextContent("/ 10");
    await waitFor(() => expect(kpi("平台可选模型")).toHaveTextContent("3"));
    expect(kpi("平台可选模型")).toHaveTextContent("个");
    expect(kpi("平台可选模型")).toHaveTextContent("3 家厂商");
    // 主模型里 claude-sonnet-5 出现次数最多
    expect(
      (await screen.findAllByText("claude-sonnet-5")).length,
    ).toBeGreaterThan(1);
    expect(kpi("最常用模型")).toHaveTextContent("claude-sonnet-5");
  });

  it("keeps the wallet honest when the platform returns nothing", async () => {
    mocks.wallet = null;
    renderHome();

    await screen.findByText("AIFusion 平台");
    expect(kpi("钱包余额")).toHaveTextContent("$—");
  });

  it("lists every visible client with its model summary and opens the detail", async () => {
    const { onOpenApp } = renderHome();

    const claudeCard = await screen.findByRole("button", {
      name: /Claude Code/,
    });
    await waitFor(() =>
      expect(claudeCard).toHaveTextContent("claude-sonnet-5"),
    );
    expect(claudeCard).toHaveTextContent("glm-5.3-flash");
    expect(claudeCard).toHaveTextContent("直连");

    const hermesCard = screen.getByRole("button", { name: /Hermes/ });
    await waitFor(() => expect(hermesCard).toHaveTextContent("3 个模型"));

    // 正在看的客户端标出来，别的没有
    expect(hermesCard).not.toHaveTextContent("正在看");
    const codexCard = screen.getByRole("button", { name: /Codex/ });
    expect(codexCard).toHaveTextContent("正在看");
    expect(codexCard.dataset.active).toBe("true");

    fireEvent.click(claudeCard);
    expect(onOpenApp).toHaveBeenCalledWith("claude");

    // 总览统计和卡片用的是同一份模型摘要
    expect(screen.getAllByText("claude-sonnet-5").length).toBeGreaterThan(1);
  });

  it("marks a client that still uses its local config", async () => {
    renderHome();
    const piCard = await screen.findByRole("button", { name: /Pi/ });
    await waitFor(() => expect(piCard).toHaveTextContent("本机配置"));
  });

  it("takes over every routing-capable client at once", async () => {
    mocks.setTakeover.mockClear();
    renderHome();

    const button = await screen.findByRole("button", { name: "全部走路由" });
    // 五个能走本机路由的客户端此刻都是直连
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(mocks.setTakeover).toHaveBeenCalledTimes(5));
    expect(mocks.setTakeover.mock.calls.map((call) => call[0]).sort()).toEqual(
      ["claude", "claude-desktop", "codex", "gemini", "grokbuild"].sort(),
    );
    // 每次都按「接管、非聚合」下发
    for (const call of mocks.setTakeover.mock.calls) {
      expect(call[1]).toBe(true);
      expect(call[2]).toBe(false);
    }
  });

  it("disables the batch takeover when nothing is signed in", async () => {
    mocks.configured = false;
    renderHome();
    const button = await screen.findByRole("button", { name: "全部走路由" });
    expect(button).toBeDisabled();
  });

  it("routes the more-tools links to the global pages", async () => {
    const { onOpenPage } = renderHome();
    await screen.findByText("AIFusion 平台");

    fireEvent.click(screen.getByRole("button", { name: "MCP" }));
    expect(onOpenPage).toHaveBeenCalledWith("mcp");
    // 语言包没加载时 t() 直接回吐键名，和侧栏的取名方式一致
    fireEvent.click(screen.getByRole("button", { name: "nav.usage" }));
    expect(onOpenPage).toHaveBeenCalledWith("usage");
  });

  it("reports the usage section honestly when nothing was recorded", async () => {
    renderHome();
    expect(await screen.findByText(/本机还没有用量记录/)).toBeInTheDocument();
  });

  it("draws the recent usage as a 7-bar spark plus three figures", async () => {
    mocks.summary = {
      totalRequests: 12,
      totalCost: "0.42",
      realTotalTokens: 5000,
    };
    mocks.trends = [
      { date: "2026-10-15", requestCount: 0 },
      { date: "2026-10-16", requestCount: 4 },
      { date: "2026-10-17", requestCount: 12 },
    ];
    const { container } = renderHome();

    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("$0.42")).toBeInTheDocument();
    expect(screen.getByText("5,000")).toBeInTheDocument();

    const bars = container.querySelectorAll(
      '[aria-label="近 7 天每日请求数"] > div',
    );
    expect(bars).toHaveLength(3);
    // 零请求留最矮的底色柱，最高的一天（也是今天）占满
    expect(bars[0].getAttribute("title")).toBe("2026-10-15 · 0");
    expect((bars[0] as HTMLElement).style.height).toBe("4%");
    expect((bars[2] as HTMLElement).style.height).toBe("100%");
  });

  it("keeps the white-label promise: no address, key or token in the markup", async () => {
    const { container } = renderHome();
    await screen.findByText("AIFusion 平台");

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/op\.aifusion|192\.168|https?:\/\//);
    expect(text).not.toMatch(/fk_|sk-|abcd…wxyz/);
  });

  it("asks for a platform sign-in when no key is stored", async () => {
    mocks.configured = false;
    renderHome();

    expect(await screen.findByText("未连接平台")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "登录平台" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mocks.modelConfig).not.toHaveBeenCalled());
    // 未登录时客户端数与模型数都不猜，只留破折号
    expect(kpi("已接入客户端")).toHaveTextContent("—");
  });
});
