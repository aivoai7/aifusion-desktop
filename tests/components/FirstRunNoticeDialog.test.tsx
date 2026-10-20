import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  keyStatus: undefined as
    | {
        configured: boolean;
        maskedKey: string | null;
        source: "user" | "environment" | null;
        baseUrl: string;
      }
    | undefined,
  settings: undefined as Record<string, unknown> | undefined,
  login: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/query", () => ({
  useSettingsQuery: () => ({ data: mocks.settings }),
  usePlatformKeyStatusQuery: () => ({ data: mocks.keyStatus }),
  PLATFORM_KEY_STATUS_QUERY_KEY: ["platform-key-status"],
}));

vi.mock("@/lib/api", () => ({
  settingsApi: {
    save: mocks.saveSettings,
  },
}));

vi.mock("@/hooks/usePlatformWebLogin", () => ({
  usePlatformWebLogin: () => ({
    login: mocks.login,
    cancel: async () => {},
    busy: false,
    error: null,
    clearError: () => {},
  }),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "4.0.15",
}));

vi.mock("@/lib/whatsNew", () => ({
  markSeen: (_seen: string | undefined, version: string) => version,
}));

import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";

const loginResult = {
  updatedProviders: 10,
  syncedApps: [],
  syncFailures: [],
  keyName: "AIFusion",
  maskedKey: "b3d6…683a",
};

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FirstRunNoticeDialog />
    </QueryClientProvider>,
  );
}

describe("FirstRunNoticeDialog", () => {
  beforeEach(() => {
    mocks.keyStatus = {
      configured: false,
      maskedKey: null,
      source: null,
      baseUrl: "https://platform.example",
    };
    mocks.settings = {};
    mocks.login.mockReset();
    mocks.saveSettings.mockReset().mockResolvedValue(true);
  });

  it("opens the website login and acknowledges after a key is fetched", async () => {
    mocks.login.mockResolvedValue(loginResult);
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "firstRunNotice.webLogin" }),
    );
    expect(mocks.login).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          firstRunNoticeConfirmed: true,
          newLayoutNoticeConfirmed: true,
          whatsNewSeenVersion: "4.0.15",
        }),
      ),
    );
  });

  it("stays on the notice when the website login is cancelled", async () => {
    mocks.login.mockResolvedValue(null);
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "firstRunNotice.webLogin" }),
    );

    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it("shows the welcome copy once a key exists", async () => {
    mocks.keyStatus = {
      configured: true,
      maskedKey: "abcd…wxyz",
      source: "user",
      baseUrl: "https://platform.example",
    };
    renderDialog();

    expect(await screen.findByText("firstRunNotice.title")).toBeInTheDocument();
    expect(mocks.login).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "firstRunNotice.confirm" }),
    );
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ firstRunNoticeConfirmed: true }),
      ),
    );
  });
});
