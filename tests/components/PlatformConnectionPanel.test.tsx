import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";

const state = vi.hoisted(() => ({
  configured: true,
  maskedKey: "abcd…wxyz" as string | null,
  source: "user" as "user" | "environment" | null,
  proxyRunning: true,
  mode: "route" as "direct" | "route" | "stack",
}));

const loginWebMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { defaultValue?: string }) =>
      params?.defaultValue ?? key,
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

vi.mock("@/hooks/usePlatformWebLogin", () => ({
  usePlatformWebLogin: () => ({
    login: loginWebMock,
    cancel: async () => {},
    busy: false,
    error: null,
    clearError: () => {},
  }),
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
) {
  return render(
    <PlatformConnectionPanel
      app={app}
      providers={Object.fromEntries(providers.map((p) => [p.id, p]))}
      currentProviderId={currentProviderId}
      onOpenKeySettings={() => {}}
      onOpenPage={onOpenPage as never}
    />,
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

  it("marks apps still using their local config", () => {
    resetState();
    state.mode = "direct";
    state.proxyRunning = false;
    renderPanel("hermes", [localProvider]);

    expect(screen.getByText(/使用本机配置/)).toBeInTheDocument();
    expect(screen.queryByText(/已接入平台/)).not.toBeInTheDocument();
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

  it("treats additive apps with the platform provider as connected", () => {
    resetState();
    state.mode = "direct";
    state.proxyRunning = false;
    // additive 应用后端没有 current provider，列表里有平台条目就算已接入
    renderPanel("hermes", [localProvider, platformProvider]);

    expect(screen.getByText(/已接入平台/)).toBeInTheDocument();
    expect(screen.queryByText(/使用本机配置/)).not.toBeInTheDocument();
  });
});
