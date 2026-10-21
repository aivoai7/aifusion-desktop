import { Suspense, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import {
  resetProviderState,
  setCurrentProviderId,
  setProviders,
} from "../msw/state";
import { emitTauriEvent } from "../msw/tauriMocks";
import { server } from "../msw/server";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const skillsPanelMocks = vi.hoisted(() => ({
  initialViews: [] as string[],
}));
const panelMocks = vi.hoisted(() => ({ apps: [] as string[] }));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

// 详情页每一行怎么取值由 tests/components/PlatformConnectionPanel.test.tsx 覆盖。
// 这里只管 App 这一层：把哪个应用交给详情页、切应用切页时发生了什么。
vi.mock("@/components/providers/PlatformConnectionPanel", () => ({
  PlatformConnectionPanel: ({ app, providers, currentProviderId }: any) => {
    panelMocks.apps.push(app);
    return (
      <div data-testid="platform-panel">
        <span data-testid="panel-app">{app}</span>
        <span data-testid="panel-providers">{JSON.stringify(providers)}</span>
        <span data-testid="current-provider">{currentProviderId}</span>
      </div>
    );
  },
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen, message, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <div data-testid="confirm-message">{message}</div>
        <button onClick={() => onConfirm()}>confirm-delete</button>
        <button onClick={() => onCancel()}>cancel-delete</button>
      </div>
    ) : null,
}));

vi.mock("@/contexts/UpdateContext", () => ({
  useUpdate: () => ({ hasUpdate: false, updateInfo: null }),
}));

// 设置页要 ThemeProvider，这里只看导航进去时发生了什么
vi.mock("@/components/settings/SettingsPage", () => ({
  SettingsPage: () => <div data-testid="settings-page" />,
}));

vi.mock("@/components/skills/UnifiedSkillsPanel", () => ({
  // v7：Skills 的页头（添加 / 检查更新 / 存储与同步）在面板自己里面
  default: ({ initialView }: { initialView?: string }) => {
    skillsPanelMocks.initialViews.push(initialView ?? "installed");
    return <div data-testid="unified-skills-panel">{initialView}</div>;
  },
}));

vi.mock("@/components/mcp/UnifiedMcpPanel", async () => {
  const { useUnsavedChangesTracker } = await vi.importActual<
    typeof import("@/lib/unsavedChanges")
  >("@/lib/unsavedChanges");
  // 当作一直开着的 MCP 编辑页：输入即登记未保存的修改
  const Body = () => (
    <div data-testid="mcp-editor" {...useUnsavedChangesTracker()}>
      <input aria-label="mcp-field" />
    </div>
  );
  return { default: Body };
});

/** 侧栏里的应用行（v7 侧栏取代了原来页头的应用切换器） */
const sidebarApp = (name: string) =>
  // 首次启动提示是模态对话框，会把侧栏标成 aria-hidden，所以带上 hidden
  within(document.querySelector("nav") as HTMLElement).getByRole("button", {
    name,
    hidden: true,
  });

/**
 * 从首页总览进全局页（v8）：MCP / 用量统计这些入口不再挂在侧栏上，
 * 只有首页「更多功能」那一排 chips。
 */
const openFromHome = async (name: RegExp) => {
  fireEvent.click(sidebarApp("首页总览"));
  const chip = await screen.findByRole("button", { name, hidden: true });
  fireEvent.click(chip);
};

const renderApp = (AppComponent: ComponentType) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading">loading</div>}>
        <AppComponent />
      </Suspense>
    </QueryClientProvider>,
  );
};

/** 详情页现在画的是哪个应用 */
const panelApp = () => screen.getByTestId("panel-app").textContent;
/** 详情页拿到的供应商列表 */
const panelProviderIds = () =>
  JSON.parse(screen.getByTestId("panel-providers").textContent || "{}");

const expectPanelApp = async (app: string) => {
  await waitFor(() => expect(panelApp()).toBe(app));
};

describe("App integration with MSW", () => {
  beforeEach(() => {
    resetProviderState();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    skillsPanelMocks.initialViews = [];
    panelMocks.apps = [];
    // v8 起首页是落地页；这批用例测的是应用页，直接把上次停留的页签设为客户端详情页
    localStorage.setItem("cc-switch-last-view", "providers");
    localStorage.removeItem("cc-switch-last-app");
  });

  it("hands the active app and its providers to the detail page", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);

    await expectPanelApp("claude");
    await waitFor(() => expect(panelProviderIds()).toHaveProperty("claude-1"));

    fireEvent.click(sidebarApp("Codex"));
    await expectPanelApp("codex");
    await waitFor(() => expect(panelProviderIds()).toHaveProperty("codex-1"));

    // 详情页只跟着当前应用走（切应用后重画一次，不会把上一个应用带过来）
    expect([...new Set(panelMocks.apps)]).toEqual(["claude", "codex"]);
  }, 30_000);

  it("refreshes the route pointer when the proxy fails over to another provider", async () => {
    let routeProviderId = "claude-1";
    let modeRequests = 0;
    server.use(
      http.post("http://tauri.local/get_app_mode", async ({ request }) => {
        const { appType } = (await request.json()) as { appType: string };
        if (appType !== "claude") return;
        modeRequests += 1;
        return HttpResponse.json({
          mode: "route",
          attached: true,
          routeProviderId,
          directProviderId: "claude-1",
        });
      }),
    );

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() => expect(modeRequests).toBeGreaterThan(0));
    const before = modeRequests;

    // 故障转移只改后端的路由指针，再发 provider-switched
    routeProviderId = "claude-2";
    emitTauriEvent("provider-switched", {
      appType: "claude",
      providerId: "claude-2",
      source: "failover",
    });

    await waitFor(() => expect(modeRequests).toBeGreaterThan(before));
  }, 20_000);

  it("resets provider view scroll when switching apps", async () => {
    const { default: App } = await import("@/App");
    const { container } = renderApp(App);

    await expectPanelApp("claude");

    const mainScrollContainer = container.querySelector("main") as HTMLElement;
    // 详情页的滚动区在页头下面（每个应用一份）
    const providerScrollContainer = () =>
      container.querySelector<HTMLElement>("#main-content");

    expect(mainScrollContainer).not.toBeNull();
    expect(providerScrollContainer()).not.toBeNull();

    mainScrollContainer.scrollTop = 320;
    mainScrollContainer.scrollLeft = 12;
    providerScrollContainer()!.scrollTop = 640;
    providerScrollContainer()!.scrollLeft = 24;

    fireEvent.click(sidebarApp("Codex"));
    await expectPanelApp("codex");

    expect(mainScrollContainer.scrollTop).toBe(0);
    expect(mainScrollContainer.scrollLeft).toBe(0);
    expect(providerScrollContainer()!.scrollTop).toBe(0);
    expect(providerScrollContainer()!.scrollLeft).toBe(0);
  }, 10_000);

  it("asks before leaving an unsaved global page", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);
    await expectPanelApp("claude");

    await openFromHome(/^MCP$/);
    fireEvent.input(await screen.findByLabelText("mcp-field"), {
      target: { value: "draft" },
    });

    // 离开未保存的全局页要问；取消后还在原页，登记也不能丢
    fireEvent.click(sidebarApp("首页总览"));
    expect(await screen.findByTestId("confirm-message")).toHaveTextContent(
      "common.unsavedLeaveMessage",
    );
    fireEvent.click(screen.getByText("cancel-delete"));
    expect(screen.getByTestId("mcp-editor")).toBeInTheDocument();

    // 同意后才真的离开
    fireEvent.click(sidebarApp("首页总览"));
    fireEvent.click(await screen.findByText("confirm-delete"));
    await waitFor(() =>
      expect(screen.queryByTestId("mcp-editor")).not.toBeInTheDocument(),
    );

    // 已经在首页时再点首页：不离开，所以不问
    fireEvent.click(sidebarApp("首页总览"));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  }, 10_000);

  it("leaves the detail page for settings on ⌘,", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);
    await expectPanelApp("claude");

    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(await screen.findByTestId("settings-page")).toBeInTheDocument();
  });

  it("shows toast when auto sync fails in background", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);

    await expectPanelApp("claude");

    expect(() => {
      emitTauriEvent("webdav-sync-status-updated", null);
    }).not.toThrow();
    expect(toastErrorMock).not.toHaveBeenCalled();

    emitTauriEvent("webdav-sync-status-updated", {
      source: "auto",
      status: "error",
      error: "network timeout",
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });

    toastErrorMock.mockReset();
    expect(() => {
      emitTauriEvent("s3-sync-status-updated", null);
    }).not.toThrow();
    expect(toastErrorMock).not.toHaveBeenCalled();

    emitTauriEvent("s3-sync-status-updated", {
      source: "auto",
      status: "error",
      error: "s3 timeout",
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
  });

  it("moves the detail page to the provider the backend switched to", async () => {
    setProviders("claude", {
      "claude-1": {
        id: "claude-1",
        name: "Claude Default",
        settingsConfig: {},
        category: "official",
        sortIndex: 0,
        createdAt: 1,
      },
      "claude-9": {
        id: "claude-9",
        name: "Claude Late",
        settingsConfig: {},
        category: "custom",
        sortIndex: 1,
        createdAt: 2,
      },
    });
    setCurrentProviderId("claude", "claude-1");

    const { default: App } = await import("@/App");
    renderApp(App);
    await expectPanelApp("claude");
    await waitFor(() => expect(panelProviderIds()).toHaveProperty("claude-9"));
    expect(screen.getByTestId("current-provider").textContent).toBe("claude-1");

    // 后端换的那家要立刻反映到详情页的当前指针上
    setCurrentProviderId("claude", "claude-9");
    emitTauriEvent("provider-switched", {
      appType: "claude",
      providerId: "claude-9",
    });

    await waitFor(() =>
      expect(screen.getByTestId("current-provider").textContent).toBe(
        "claude-9",
      ),
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  }, 10_000);

  it("renders the Skills page with its own header", async () => {
    localStorage.setItem("cc-switch-last-view", "skills");
    const { default: App } = await import("@/App");
    renderApp(App);

    expect(await screen.findByTestId("unified-skills-panel")).toHaveTextContent(
      "installed",
    );
  });

  it("navigates OpenClaw and Hermes pages with underline tabs", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(sidebarApp("OpenClaw"));
    // 首次启动提示是模态对话框，页面其余部分是 aria-hidden，所以带上 hidden
    const openclawTabs = await screen.findByRole("tablist", {
      name: "OpenClaw",
      hidden: true,
    });
    const pageTabs = within(openclawTabs).getAllByRole("tab", { hidden: true });
    expect(pageTabs.map((tab) => tab.textContent)).toEqual([
      "appPage.providers",
      "appPage.workspace",
      "appPage.openclawConfig",
    ]);
    expect(pageTabs[0]).toHaveAttribute("aria-selected", "true");
    expect(
      screen.queryByRole("group", { name: "OpenClaw", hidden: true }),
    ).not.toBeInTheDocument();

    fireEvent.click(pageTabs[2]);
    const configTabs = await screen.findByRole("tablist", {
      name: "appPage.openclawConfig",
      hidden: true,
    });
    const subTabs = within(configTabs).getAllByRole("tab", { hidden: true });
    expect(subTabs).toHaveLength(3);
    expect(subTabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { hidden: true })).toHaveAttribute(
      "aria-labelledby",
      "openclaw-config-env",
    );

    fireEvent.click(sidebarApp("Hermes"));
    const hermesTabs = await screen.findByRole("tablist", {
      name: "Hermes",
      hidden: true,
    });
    const hermesPageTabs = within(hermesTabs).getAllByRole("tab", {
      hidden: true,
    });
    expect(hermesPageTabs.map((tab) => tab.textContent)).toEqual([
      "appPage.providers",
      "appPage.memory",
    ]);

    // 记忆页：页头没有「添加供应商」这类上游入口
    fireEvent.click(hermesPageTabs[1]);
    const header = document.querySelector("header") as HTMLElement;
    const save = await within(header).findByRole("button", {
      name: "common.save",
      hidden: true,
    });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(
      within(header).queryByRole("button", {
        name: /provider.addProvider/,
        hidden: true,
      }),
    ).not.toBeInTheDocument();
    const memoryTabs = await screen.findByRole("tablist", {
      name: "hermes.memory.fileTabs",
      hidden: true,
    });
    expect(
      within(memoryTabs).getAllByRole("tab", { hidden: true }),
    ).toHaveLength(2);
    await waitFor(() =>
      expect(
        screen.getAllByRole("textbox", {
          name: "hermes.memory.editorLabel",
          hidden: true,
        })[0],
      ).toHaveValue("agent notes"),
    );
  });

  it("opens the old skillsDiscovery view as the Discover segment", async () => {
    localStorage.setItem("cc-switch-last-view", "skillsDiscovery");
    const { default: App } = await import("@/App");
    renderApp(App);

    expect(await screen.findByTestId("unified-skills-panel")).toHaveTextContent(
      "discover",
    );
  });
});
