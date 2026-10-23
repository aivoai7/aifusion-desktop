import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageHero } from "@/components/usage/UsageHero";
import { platformUsageDays } from "@/lib/usageRange";
import type { UsageRangeSelection } from "@/types/usage";

/**
 * 「总成本」优先报平台账本的真实扣费：本机价目表缺模型时会把真实消费估成 0。
 * 这里只 mock 两个接口出口，指标卡本身照常真渲染。
 */

const usageApiMock = vi.hoisted(() => ({ getUsageSummaryByApp: vi.fn() }));
const platformApiMock = vi.hoisted(() => ({ usage: vi.fn() }));

vi.mock("@/lib/api/usage", () => ({ usageApi: usageApiMock }));
vi.mock("@/lib/api/platformKey", () => ({ platformKeyApi: platformApiMock }));

const localSummary = {
  appType: "claude",
  summary: {
    totalRequests: 89,
    totalCost: "0.010000",
    totalInputTokens: 20_000,
    totalOutputTokens: 5_000,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 400_000,
    successRate: 100,
    realTotalTokens: 425_000,
    cacheHitRate: 0.953,
  },
};

const platformUsage = {
  currencyCode: "USD",
  days: 1,
  from: "2026-10-23",
  to: "2026-10-23",
  totals: {
    requests: 122,
    inputTokens: 300_000,
    outputTokens: 90_000,
    tokens: 390_000,
    costUsd: 1.7532,
  },
  daily: [{ date: "2026-10-23", requests: 122, tokens: 390_000, costUsd: 1.7532 }],
  models: [
    {
      modelId: "deepseek-v4.1-flash",
      modelName: "DeepSeek V4.1 Flash",
      requests: 119,
      inputTokens: 270_000,
      outputTokens: 88_000,
      tokens: 358_000,
      costUsd: 1.7455,
    },
  ],
};

function renderHero(range: UsageRangeSelection, appType?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UsageHero
        range={range}
        appType={appType}
        refreshIntervalMs={0}
      />
    </QueryClientProvider>,
  );
}

describe("platformUsageDays", () => {
  it("只对得上平台账本的自然日窗口", () => {
    expect(platformUsageDays({ preset: "today" })).toBe(1);
    expect(platformUsageDays({ preset: "7d" })).toBe(7);
    expect(platformUsageDays({ preset: "14d" })).toBe(14);
    expect(platformUsageDays({ preset: "30d" })).toBe(30);
  });

  it("滚动 24 小时、全部与自定义不套用平台账本", () => {
    expect(platformUsageDays({ preset: "1d" })).toBeNull();
    expect(platformUsageDays({ preset: "all" })).toBeNull();
    expect(
      platformUsageDays({
        preset: "custom",
        customStartDate: 1_760_000_000,
        customEndDate: 1_760_086_400,
      }),
    ).toBeNull();
  });
});

describe("UsageHero 总成本口径", () => {
  beforeEach(() => {
    usageApiMock.getUsageSummaryByApp.mockResolvedValue([localSummary]);
    platformApiMock.usage.mockResolvedValue(platformUsage);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("已登录且区间对得上时报平台真实扣费", async () => {
    renderHero({ preset: "today" });
    await waitFor(() => expect(screen.getByText("$1.75")).toBeInTheDocument());
    expect(platformApiMock.usage).toHaveBeenCalledWith(1);
    expect(screen.queryByText("$0.01")).not.toBeInTheDocument();
  });

  it("区间对不上时不发请求，沿用本机估算", async () => {
    renderHero({ preset: "1d" });
    await waitFor(() => expect(screen.getByText("$0.01")).toBeInTheDocument());
    expect(platformApiMock.usage).not.toHaveBeenCalled();
  });

  it("按客户端筛选时账本对不上口径，沿用本机估算", async () => {
    renderHero({ preset: "today" }, "claude");
    await waitFor(() => expect(screen.getByText("$0.01")).toBeInTheDocument());
    expect(platformApiMock.usage).not.toHaveBeenCalled();
  });

  it("平台还没有用量接口（回 null）时不炸，退回本机估算", async () => {
    platformApiMock.usage.mockResolvedValue(null);
    renderHero({ preset: "today" });
    await waitFor(() => expect(screen.getByText("$0.01")).toBeInTheDocument());
  });
});
