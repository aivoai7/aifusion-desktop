import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import type { PlatformModelConfig } from "@/lib/api/platformKey";
import { DEFAULT_VISIBLE_APPS } from "@/config/appConfig";

const state = vi.hoisted(() => ({
  configured: true,
  maskedKey: "abcd…wxyz" as string | null,
  source: "user" as "user" | "environment" | null,
  proxyRunning: true,
  mode: "route" as "direct" | "route" | "stack",
}));

const loginWebMock = vi.hoisted(() => vi.fn(async () => null));
const openFolderMock = vi.hoisted(() => vi.fn(async () => {}));
const setTakeoverMock = vi.hoisted(() => vi.fn(async () => {}));

function shape(over: Partial<PlatformModelConfig>): PlatformModelConfig {
  return {
    supportsDefault: true,
    supportsLight: false,
    supportsList: false,
    defaultModel: null,
    lightModel: null,
    models: [],
    usingPlatform: true,
    connected: true,
    ...over,
  };
}

const MODELS: Partial<Record<AppId, PlatformModelConfig>> = {
  claude: shape({
    supportsLight: true,
    defaultModel: "claude-sonnet-5",
    lightModel: "glm-5.3-flash",
  }),
  codex: shape({ defaultModel: "claude-opus-5" }),
  hermes: shape({
    supportsDefault: false,
    supportsList: true,
    models: ["claude-sonnet-5", "glm-5.3-flash"],
  }),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // 测试没有加载语言包：有 defaultValue 就用它，并把 {{param}} 填进去
    t: (
      key: string,
      params?: Record<string, unknown> & { defaultValue?: string },
    ) => {
      const text = params?.defaultValue ?? key;
      if (!params) return text;
      return Object.entries(params)
        .filter(([name]) => name !== "defaultValue")
        .reduce(
          (acc, [name, value]) =>
            acc.replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), String(value)),
          text,
        );
    },
  }),
}));

vi.mock("@/lib/query", () => ({
  usePlatformKeyStatusQuery: () => ({
    data: {
      configured: state.configured,
      maskedKey: state.maskedKey,
      source: state.source,
      baseUrl: "https://op.aifusion.sbs",
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/query/proxy", () => ({
  useAppMode: () => ({ data: { mode: state.mode } }),
  useProxyStatusQuery: () => ({ data: { running: state.proxyRunning } }),
}));

// 连接方式胶囊用这个 hook 进出路由，测试里只关心它被怎么调用
vi.mock("@/hooks/useProxyStatus", () => ({
  useProxyStatus: () => ({
    setTakeoverForApp: setTakeoverMock,
    isPending: false,
  }),
}));

vi.mock("@/hooks/usePlatformWebLogin", () => ({
  usePlatformWebLogin: () => ({
    login: loginWebMock,
    cancel: async () => {},
    busy: false,
    error: null,
    clearError: () => {},
  }),
}));

// 详情页会读模型配置、本机目录和用量，全部换成可控的假数据
vi.mock("@/lib/api/platformKey", () => ({
  platformKeyApi: {
    modelConfig: async (app: AppId) => MODELS[app] ?? null,
    models: async () => [
      { id: "claude-sonnet-5", provider: "anthropic" },
      { id: "glm-5.3-flash", provider: "z.ai" },
      { id: "claude-opus-5", provider: "anthropic" },
    ],
    setModel: async () => {},
  },
}));

vi.mock("@/lib/api/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/settings")>();
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      // homeDir 的测试桩是 /home/mock，所以这里能显示成 ~/.claude/settings.json
      getConfigDir: async () => "/home/mock/.claude",
      openConfigFolder: openFolderMock,
    },
  };
});

vi.mock("@/lib/query/usage", () => ({
  useUsageSummaryByApp: () => ({
    data: [
      {
        appType: "claude",
        summary: {
          totalRequests: 12,
          totalCost: "0.42",
          realTotalTokens: 5000,
        },
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/components/providers/PlatformModelDialog", () => ({
  PlatformModelDialog: () => null,
}));

import { PlatformConnectionPanel } from "@/components/providers/PlatformConnectionPanel";

const platformProvider: Provider = {
  id: "claude-official",
  name: "AIFusion",
  settingsConfig: {},
};

const localProvider: Provider = {
  id: "existing-hermes",
  name: "existing-hermes",
  settingsConfig: {},
};

function renderPanel(
  app: "claude" | "hermes",
  providers: Provider[],
  currentProviderId = "",
  onOpenPage: (page: string) => void = () => {},
  onOpenApp: (app: string) => void = () => {},
) {
  // 面板里有平台模型 / 应用更新两组查询，需要 QueryClient
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PlatformConnectionPanel
        app={app}
        providers={Object.fromEntries(providers.map((p) => [p.id, p]))}
        currentProviderId={currentProviderId}
        visibleApps={DEFAULT_VISIBLE_APPS}
        onOpenKeySettings={() => {}}
        onOpenPage={onOpenPage as never}
        onOpenApp={onOpenApp as never}
      />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.configured = true;
  state.maskedKey = "abcd…wxyz";
  state.source = "user";
  state.proxyRunning = true;
  state.mode = "route";
}

describe("PlatformConnectionPanel", () => {
  it("shows connection and routed status without exposing the address or key", () => {
    resetState();
    renderPanel("claude", [platformProvider], "claude-official");

    expect(screen.getByText("AIFusion 平台")).toBeInTheDocument();
    expect(
      screen.queryByText("https://op.aifusion.sbs"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("已连接")).toBeInTheDocument();
    expect(screen.queryByText("abcd…wxyz")).not.toBeInTheDocument();
    expect(screen.getByText(/已接入平台/)).toBeInTheDocument();
    expect(screen.getByText("路由")).toBeInTheDocument();
    expect(screen.getByText("路由服务运行中")).toBeInTheDocument();
    // 密钥来源只说来源，不给地址、不给 key
    expect(screen.getByText("平台登录自动下发")).toBeInTheDocument();
    expect(screen.getByText("本机保存")).toBeInTheDocument();
  });

  it("switches a routing-capable client back to direct", async () => {
    resetState();
    setTakeoverMock.mockClear();
    renderPanel("claude", [platformProvider], "claude-official");

    const route = screen.getByRole("button", { name: "路由" });
    const direct = screen.getByRole("button", { name: "直连" });
    expect(route).toHaveAttribute("aria-pressed", "true");
    expect(direct).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(direct);
    expect(setTakeoverMock).toHaveBeenCalledWith({
      appType: "claude",
      enabled: false,
      stack: false,
    });
  });

  it("enters route mode for a client that is still direct", async () => {
    resetState();
    state.mode = "direct";
    state.proxyRunning = false;
    setTakeoverMock.mockClear();
    renderPanel("claude", [platformProvider], "claude-official");

    await userEvent.click(screen.getByRole("button", { name: "路由" }));
    expect(setTakeoverMock).toHaveBeenCalledWith({
      appType: "claude",
      enabled: true,
      stack: false,
    });
  });

  it("offers no switch for clients the local router cannot take over", () => {
    resetState();
    renderPanel("hermes", [platformProvider]);

    expect(
      screen.queryByRole("button", { name: "路由" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/不支持本机路由/)).toBeInTheDocument();
  });

  it("warns when the key is missing and offers website sign-in", async () => {
    resetState();
    state.configured = false;
    state.maskedKey = null;
    state.source = null;
    state.proxyRunning = false;
    state.mode = "direct";
    loginWebMock.mockClear();
    renderPanel("claude", [platformProvider], "claude-official");

    expect(screen.getByText("未连接平台")).toBeInTheDocument();
    expect(screen.queryByText("路由服务运行中")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "登录平台" }));
    expect(loginWebMock).toHaveBeenCalledTimes(1);
  });

  it("marks apps still using their local config", async () => {
    resetState();
    state.mode = "direct";
    state.proxyRunning = false;
    renderPanel("hermes", [localProvider]);

    // additive 应用：hermes 的模型来自本机模型表，不是平台下发
    // 模型表是异步查询，先等右侧「可用模型」清单真的渲染出条目
    await screen.findAllByText("claude-sonnet-5");
    expect(screen.getByText("可用模型")).toBeInTheDocument();
    // 主模型行和右侧「可用模型」清单都会出现同一个模型 id
    expect(screen.getAllByText("claude-sonnet-5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("glm-5.3-flash").length).toBeGreaterThan(0);
    expect(screen.getByText(/使用本机配置/)).toBeInTheDocument();
    expect(screen.queryByText(/已接入平台/)).not.toBeInTheDocument();
  });

  it("shows the model, the local file it lands in and the recent usage", async () => {
    resetState();
    renderPanel("claude", [platformProvider], "claude-official");

    expect(screen.getByRole("button", { name: "选择模型" })).toBeEnabled();
    expect(
      (await screen.findAllByText("claude-sonnet-5")).length,
    ).toBeGreaterThan(0);
    // 厂商跟在模型后面，来自平台模型列表
    expect(await screen.findByText("· anthropic")).toBeInTheDocument();
    expect(screen.getByText("配置落点")).toBeInTheDocument();
    expect(
      await screen.findByText("~/.claude/settings.json"),
    ).toBeInTheDocument();
    expect(screen.getByText("保存后立即写入")).toBeInTheDocument();
    expect(screen.getByText("最近用量")).toBeInTheDocument();
    expect(
      screen.getByText("12 次请求 · $0.42 · 5,000 Token"),
    ).toBeInTheDocument();
    // 白标：页面里不出现网关地址、密钥或官网域名
    expect(document.body.textContent).not.toMatch(
      /op\.aifusion|https?:\/\/|192\.168|fk_|sk-/,
    );

    openFolderMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "打开配置目录" }));
    expect(openFolderMock).toHaveBeenCalledWith("claude");
  });

  it("lists the other clients and opens their details", async () => {
    resetState();
    const onOpenApp = vi.fn();
    renderPanel(
      "claude",
      [platformProvider],
      "claude-official",
      () => {},
      onOpenApp,
    );

    expect(await screen.findByText("切换到其他客户端")).toBeInTheDocument();
    // 当前客户端不重复出现，其余可见客户端各一枚胶囊
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
    const codex = screen.getByText("Codex");
    expect(codex.closest("button")).toHaveTextContent("Codex");

    await userEvent.click(codex.closest("button")!);
    expect(onOpenApp).toHaveBeenCalledWith("codex");
  });

  it("opens the global pages from the panel", async () => {
    resetState();
    const onOpenPage = vi.fn();
    renderPanel("claude", [platformProvider], "claude-official", onOpenPage);

    for (const label of ["MCP", "Skills", "提示词", "会话", "用量统计"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    expect(onOpenPage).toHaveBeenCalledWith("mcp");
    await userEvent.click(screen.getByRole("button", { name: "用量统计" }));
    expect(onOpenPage).toHaveBeenCalledWith("usage");
  });

  it("treats additive apps with the platform provider as connected", async () => {
    resetState();
    state.mode = "direct";
    state.proxyRunning = false;
    // additive 应用后端没有 current provider，列表里有平台条目就算已接入
    renderPanel("hermes", [localProvider, platformProvider]);

    await screen.findByText("可用模型");
    expect(screen.getByText(/已接入平台/)).toBeInTheDocument();
    expect(screen.queryByText(/使用本机配置/)).not.toBeInTheDocument();
  });
});
