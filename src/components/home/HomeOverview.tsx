import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpCircle,
  BookOpen,
  ChartColumn,
  History,
  KeyRound,
  Library,
  Loader2,
  LogIn,
  RefreshCw,
  Route,
  Server,
  X,
} from "lucide-react";
import afLogo from "@/assets/icons/logo.png";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GlobalPage } from "@/lib/navigation";
import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { APP_IDS, APP_LABELS, MODE_APP_IDS } from "@/config/appConfig";
import { platformKeyApi } from "@/lib/api/platformKey";
import { proxyApi } from "@/lib/api/proxy";
import { toast } from "@/lib/toast";
import { usePlatformKeyStatusQuery } from "@/lib/query";
import { useUsageSummary, useUsageTrends } from "@/lib/query/usage";
import { useSidebarStatus } from "@/hooks/useSidebarStatus";
import { usePlatformWebLogin } from "@/hooks/usePlatformWebLogin";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { AppModelCard, useAppModelRows } from "@/components/apps/AppModelCard";
import {
  toolDisplayName,
  useToolManagement,
} from "@/components/apps/useToolManagement";
import { ToolUpgradeConfirmDialog } from "@/components/settings/ToolUpgradeConfirmDialog";

interface HomeOverviewProps {
  visibleApps: VisibleApps;
  /** 当前应用：用于让对应卡片标出「正在看」。 */
  activeApp: AppId;
  onOpenApp: (app: AppId) => void;
  onOpenPage: (page: GlobalPage | "settings") => void;
  onOpenKeySettings: () => void;
}

/**
 * 首页总览（Ink & Grid 第一屏）。
 *
 * 三块内容，一张墨底卡片 + 两组列表，不用上游的 20px 圆角玻璃卡与彩色光晕：
 * 平台卡（连接状态 + 四格等宽 KPI + 组件更新条）、客户端九宫格、近 7 天用量。
 * 改模型进详情页；这里只提供「全部走路由」这一处批量操作。
 */
export function HomeOverview({
  visibleApps,
  activeApp,
  onOpenApp,
  onOpenPage,
  onOpenKeySettings,
}: HomeOverviewProps) {
  const { t } = useTranslation();
  const { data: keyStatus } = usePlatformKeyStatusQuery();
  const configured = keyStatus?.configured === true;
  const webLogin = usePlatformWebLogin();
  const tools = useToolManagement();
  const { appStatus } = useSidebarStatus();

  const apps = useMemo(
    () => APP_IDS.filter((app) => visibleApps[app]),
    [visibleApps],
  );

  // 每个客户端的模型摘要：一次并发读完，缓存键和详情页的模型行完全一致
  const rows = useAppModelRows(apps, configured);

  // 一键接管：只有后端 has_route_mode 的五个客户端能走本机路由，
  // 其余（OpenCode / OpenClaw / Hermes / Pi / MiniMax Code）由平台直接写配置。
  const queryClient = useQueryClient();
  const [routing, setRouting] = useState(false);
  const routeApps = useMemo(
    () => MODE_APP_IDS.filter((app) => visibleApps[app]),
    [visibleApps],
  );
  const routedCount = routeApps.filter(
    (app) => appStatus(app).mode !== "direct",
  ).length;
  const routeTargets = routeApps.filter(
    (app) => appStatus(app).mode === "direct",
  );

  const routeAll = async () => {
    if (routeTargets.length === 0) return;
    setRouting(true);
    const failed: string[] = [];
    // 串行：每次接管都要重写客户端配置并拉起路由服务，并发会抢同一把切换锁
    for (const app of routeTargets) {
      try {
        await proxyApi.setProxyTakeoverForApp(app, true, false);
      } catch {
        failed.push(APP_LABELS[app] ?? app);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["providers"] });
    queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
    setRouting(false);
    const done = routeTargets.length - failed.length;
    if (failed.length === 0) {
      toast.success(
        t("home.routeAllDone", {
          count: done,
          defaultValue: "已把 {{count}} 个客户端切到路由",
        }),
        { closeButton: true },
      );
    } else {
      toast.warning(
        t("home.routeAllPartial", {
          done,
          failed: failed.join("、"),
          defaultValue: "{{done}} 个已切到路由，{{failed}} 未成功",
        }),
        { closeButton: true },
      );
    }
  };

  const { data: platformModels } = useQuery({
    queryKey: ["platformModels"],
    queryFn: () => platformKeyApi.models(),
    enabled: configured,
    staleTime: 60_000,
    // 冷启动时平台网关可能还在握手，一次失败就留个 5 秒后的自动重试；
    // 拿到列表后不再轮询，交给详情页共用同一份缓存。
    retry: 2,
    refetchInterval: (query) =>
      query.state.status === "error" ? 5_000 : false,
  });
  const { data: wallet } = useQuery({
    queryKey: ["platformWalletBalance"],
    queryFn: () => platformKeyApi.walletBalance(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const connectedCount = rows.filter((row) => row.config?.connected).length;
  const vendorCount = useMemo(() => {
    if (!platformModels) return 0;
    return new Set(platformModels.map((model) => model.provider)).size;
  }, [platformModels]);

  // 最常用模型：拿每个客户端的主模型（列表型取第一个）统计次数
  const topModel = useMemo(() => {
    const tally = new Map<string, number>();
    for (const row of rows) {
      const config = row.config;
      if (!config) continue;
      const preferred = config.defaultModel ?? config.models[0] ?? null;
      if (!preferred) continue;
      tally.set(preferred, (tally.get(preferred) ?? 0) + 1);
    }
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? null;
  }, [rows]);

  // 近 7 天：整段汇总出三个数字，按天汇总出 7 根柱子
  const range = useMemo(() => ({ preset: "7d" as const }), []);
  const { data: summary } = useUsageSummary(range);
  const { data: trends } = useUsageTrends(range);
  const spark = useMemo(() => {
    const days = (trends ?? []).slice(-7);
    const peak = days.reduce((max, day) => Math.max(max, day.requestCount), 0);
    return { days, peak };
  }, [trends]);

  const quickPages = [
    {
      page: "mcp" as const,
      label: "MCP",
      icon: <Server className="h-3.5 w-3.5" />,
    },
    {
      page: "skills" as const,
      label: "Skills",
      icon: <Library className="h-3.5 w-3.5" strokeWidth={1.5} />,
    },
    {
      page: "prompts" as const,
      label: t("nav.prompts"),
      icon: <BookOpen className="h-3.5 w-3.5" />,
    },
    {
      page: "sessions" as const,
      label: t("nav.sessions"),
      icon: <History className="h-3.5 w-3.5" />,
    },
    {
      page: "usage" as const,
      label: t("nav.usage"),
      icon: <ChartColumn className="h-3.5 w-3.5" />,
    },
  ];

  const updatableCount = tools.updatableToolNames.length;
  const hasWallet = typeof wallet === "number" && Number.isFinite(wallet);

  return (
    <>
      <AppPageHeader
        variant="page"
        title={t("home.title", { defaultValue: "首页总览" })}
        subtitle={t("home.subtitle", {
          defaultValue: "平台、客户端与用量一屏可见",
        })}
      />
      <div
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto scroll-stable px-6 pb-14 pt-4"
      >
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6">
          {/* ── 平台卡：墨底 + 发丝线，无光晕、无玻璃模糊 ───────────────── */}
          <section className="overflow-hidden rounded-panel border border-hairline bg-surface shadow-sm">
            <div className="hairline flex items-center gap-3 border-b px-4 py-3">
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] border border-hairline bg-white dark:bg-subtle">
                <img
                  src={afLogo}
                  alt=""
                  draggable={false}
                  className="h-4 w-auto"
                />
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <b className="text-body font-medium text-fg-1">
                  {t("platformConnection.title", {
                    defaultValue: "AIFusion 平台",
                  })}
                </b>
                <Chip tone={configured ? "ok" : "warn"} dot>
                  {configured
                    ? t("platformConnection.connected", {
                        defaultValue: "已连接",
                      })
                    : t("platformConnection.disconnected", {
                        defaultValue: "未连接平台",
                      })}
                </Chip>
                <span className="truncate text-badge text-fg-3">
                  {t("home.heroHint", {
                    defaultValue: "模型与密钥由平台统一管理，登录即自动下发",
                  })}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {configured ? (
                  <>
                    <Button
                      variant="neutral"
                      size="compact"
                      onClick={() =>
                        void (webLogin.busy
                          ? webLogin.cancel()
                          : webLogin.login())
                      }
                    >
                      {webLogin.busy ? (
                        <X className="h-3.5 w-3.5" />
                      ) : (
                        <LogIn className="h-3.5 w-3.5" />
                      )}
                      {webLogin.busy
                        ? t("platformKey.cancelWaiting", {
                            defaultValue: "取消等待",
                          })
                        : t("platformConnection.reSignIn", {
                            defaultValue: "重新登录",
                          })}
                    </Button>
                    <Button
                      variant="neutral"
                      size="compact"
                      onClick={onOpenKeySettings}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {t("platformConnection.manageKey", {
                        defaultValue: "管理连接",
                      })}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="compact"
                    onClick={() =>
                      void (webLogin.busy
                        ? webLogin.cancel()
                        : webLogin.login())
                    }
                  >
                    {webLogin.busy ? (
                      <X className="h-3.5 w-3.5" />
                    ) : (
                      <LogIn className="h-3.5 w-3.5" />
                    )}
                    {webLogin.busy
                      ? t("platformKey.cancelWaiting", {
                          defaultValue: "取消等待",
                        })
                      : t("platformConnection.signIn", {
                          defaultValue: "登录平台",
                        })}
                  </Button>
                )}
              </div>
            </div>

            {/* 四格 KPI：数字一律 26px 等宽，单位用小一号界面字 */}
            <div className="grid grid-cols-2 md:grid-cols-4">
              <Kpi
                label={t("nav.walletBalance", { defaultValue: "钱包余额" })}
                unit="USD"
                hint={t("home.walletHint", {
                  defaultValue: "实时读取平台钱包",
                })}
              >
                {hasWallet
                  ? `$${wallet.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : "$—"}
              </Kpi>
              <Kpi
                index={1}
                label={t("home.connectedApps", {
                  defaultValue: "已接入客户端",
                })}
                unit={`/ ${apps.length}`}
                hint={
                  configured
                    ? t("home.connectedHint", {
                        defaultValue: "全部完成密钥下发",
                      })
                    : t("home.notSignedIn", {
                        defaultValue: "登录平台后下发",
                      })
                }
              >
                {configured ? connectedCount : "—"}
              </Kpi>
              <Kpi
                index={2}
                label={t("home.platformModels", {
                  defaultValue: "平台可选模型",
                })}
                unit={t("home.modelsUnit", { defaultValue: "个" })}
                hint={
                  vendorCount > 0
                    ? t("home.vendors", {
                        count: vendorCount,
                        defaultValue: "{{count}} 家厂商",
                      })
                    : "—"
                }
              >
                {platformModels ? platformModels.length : "—"}
              </Kpi>
              <Kpi
                index={3}
                mono
                label={t("home.topModel", { defaultValue: "最常用模型" })}
                hint={t("home.topModelHint", {
                  defaultValue: "各客户端主模型中出现最多",
                })}
              >
                {topModel ?? "—"}
              </Kpi>
            </div>

            <div className="hairline flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
              {updatableCount > 0 && (
                <Chip tone="warn">
                  {t("platformConnection.updatesAvailable", {
                    count: updatableCount,
                    defaultValue: "{{count}} 个可升级",
                  })}
                </Chip>
              )}
              <span className="min-w-0 flex-1 truncate text-badge text-fg-3">
                {webLogin.busy
                  ? t("platformKey.webLoginWaiting", {
                      defaultValue: "等待网页登录完成…",
                    })
                  : webLogin.error ||
                    (tools.isLoadingTools
                      ? t("platformConnection.updatesChecking", {
                          defaultValue: "检查中…",
                        })
                      : updatableCount > 0
                        ? t("platformConnection.updatesHint", {
                            defaultValue: "客户端组件有新版本",
                          })
                        : tools.lastCheckedAt
                          ? t("platformConnection.updatesLatest", {
                              defaultValue: "组件已是最新",
                            })
                          : t("platformConnection.updatesUnchecked", {
                              defaultValue: "组件更新未检查",
                            }))}
              </span>
              <Button
                variant="neutral"
                size="compact"
                disabled={tools.isLoadingTools || tools.isAnyBusy}
                onClick={() => void tools.checkForUpdates()}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    tools.isLoadingTools && "animate-spin",
                  )}
                />
                {t("platformConnection.updatesCheck", {
                  defaultValue: "检查更新",
                })}
              </Button>
              {updatableCount > 0 && (
                <Button
                  size="compact"
                  disabled={Boolean(tools.batchAction)}
                  onClick={() =>
                    void tools.handleRunToolAction(
                      tools.updatableToolNames,
                      "update",
                      { fromBatchEntry: true },
                    )
                  }
                >
                  {tools.batchAction === "update" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                  )}
                  {t("platformConnection.updatesRunAll", {
                    count: updatableCount,
                    defaultValue: "全部升级",
                  })}
                </Button>
              )}
            </div>
          </section>

          {/* ── 客户端九宫格 ────────────────────────────────────────────── */}
          <section className="flex flex-col gap-2.5">
            <SectionHead
              title={t("home.appsTitle", { defaultValue: "客户端" })}
              hint={t("home.appsHint", {
                routed: routedCount,
                total: routeApps.length,
                defaultValue:
                  "点卡片进入详情改模型 · 本机路由 {{routed}}/{{total}}",
              })}
              action={
                <Button
                  variant="neutral"
                  size="compact"
                  className="rounded-full border border-hairline-strong bg-popover/85 px-3"
                  disabled={!configured || routing || routeTargets.length === 0}
                  onClick={() => void routeAll()}
                >
                  {routing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Route className="h-3.5 w-3.5" />
                  )}
                  {routeTargets.length === 0
                    ? t("home.routeAllDone2", { defaultValue: "已全部走路由" })
                    : t("home.routeAll", {
                        count: routeTargets.length,
                        defaultValue: "全部走路由",
                      })}
                </Button>
              }
            />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <AppModelCard
                  key={row.app}
                  row={row}
                  signedIn={configured}
                  active={row.app === activeApp}
                  alert={appStatus(row.app).alert}
                  mode={appStatus(row.app).mode}
                  onOpen={() => onOpenApp(row.app)}
                />
              ))}
            </div>
            {/* 全局页在首页收成一排文字入口：页头只留品牌、余额和设置 */}
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 ps-0.5">
              <span className="text-badge text-fg-3">
                {t("home.moreTitle", { defaultValue: "更多功能" })}
              </span>
              {quickPages.map(({ page, label, icon }) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => onOpenPage(page)}
                  className="inline-flex items-center gap-1.5 text-caption text-fg-2 transition-colors hover:text-action-text active:translate-y-px"
                >
                  {icon}
                  {label}
                </button>
              ))}
              <span className="text-badge text-fg-3">
                {t("home.moreHint", { defaultValue: "作用于全部客户端" })}
              </span>
            </div>
          </section>

          {/* ── 最近用量：迷你柱状图 + 三个等宽数字 ─────────────────────── */}
          <section className="flex flex-col gap-2.5">
            <SectionHead
              title={t("home.usageTitle", { defaultValue: "最近用量" })}
              hint={t("home.usageHint", {
                defaultValue: "近 7 天，来自本机用量记录",
              })}
            />
            <div className="rounded-panel border border-hairline bg-surface px-4 py-4 shadow-sm">
              {summary ? (
                <>
                  <Spark
                    days={spark.days}
                    peak={spark.peak}
                    label={t("home.usageSpark", {
                      defaultValue: "近 7 天每日请求数",
                    })}
                  />
                  <div className="hairline mt-3.5 flex flex-wrap items-end gap-x-6 gap-y-2 border-t pt-3">
                    <Figure
                      label={t("usage.columnRequests", {
                        defaultValue: "请求",
                      })}
                      value={summary.totalRequests.toLocaleString("en-US")}
                    />
                    <Figure
                      label={t("usage.cost", { defaultValue: "花费" })}
                      value={`$${(Number.parseFloat(summary.totalCost) || 0).toFixed(2)}`}
                    />
                    <Figure
                      label="Token"
                      value={summary.realTotalTokens.toLocaleString("en-US")}
                    />
                    <Button
                      variant="neutral"
                      size="compact"
                      className="ms-auto"
                      onClick={() => onOpenPage("usage")}
                    >
                      {t("home.usageOpen", { defaultValue: "查看统计" })}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="py-2 text-center text-caption text-fg-3">
                  {t("home.usageEmpty", {
                    defaultValue:
                      "本机还没有用量记录 —— 客户端产生请求后，这里按天画出请求数、花费与 Token。",
                  })}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      <ToolUpgradeConfirmDialog
        isOpen={tools.pendingUpgrade !== null}
        plans={tools.pendingUpgrade?.plans ?? []}
        displayName={toolDisplayName}
        onConfirm={tools.handleConfirmUpgrade}
        onCancel={tools.handleCancelUpgrade}
      />
    </>
  );
}

/**
 * 一格 KPI：小灰标签 + 26px 等宽大数字（带单位）+ 一行说明。
 * 分隔只用发丝线：窄屏两列时右列加竖线、第二行加横线，宽屏四列全部竖排。
 */
function Kpi({
  label,
  hint,
  unit,
  index = 0,
  mono = false,
  children,
}: {
  label: string;
  hint?: string;
  /** 数字后面的单位（USD / 个 / / 10），用小一号界面字，不参与等宽 */
  unit?: React.ReactNode;
  /** 在四格里的序号，只用来算发丝线 */
  index?: number;
  /** 长文本值（模型 ID）用小一号等宽字，不用 26px 数字 */
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "hairline min-w-0 px-4 py-3.5",
        index % 2 === 1 && "border-s",
        index >= 2 && "border-t",
        index > 0 && "md:border-s",
        index >= 2 && "md:border-t-0",
      )}
    >
      <div className="text-badge text-fg-3">{label}</div>
      <div
        className={cn(
          "af-num mt-1.5 flex items-baseline whitespace-nowrap text-fg-1",
          mono ? "truncate font-mono text-title" : "text-metric",
        )}
        title={mono ? String(children) : undefined}
      >
        {children}
        {unit && (
          <span className="ms-1 font-sans text-caption font-medium text-fg-3">
            {unit}
          </span>
        )}
      </div>
      {hint && <div className="mt-1 truncate text-badge text-fg-3">{hint}</div>}
    </div>
  );
}

/** 用量条里的一个数字块：小灰标签 + 等宽数值。 */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-badge text-fg-3">{label}</div>
      <div className="af-num mt-0.5 whitespace-nowrap text-title text-fg-1">
        {value}
      </div>
    </div>
  );
}

/**
 * 7 根柱子的迷你柱状图：以最高的一天为基准等比压缩，今天用实心 azure，
 * 其余按同一比例压暗，零请求留一条最矮的底色柱。纯 CSS，不引图表库。
 */
function Spark({
  days,
  peak,
  label,
}: {
  days: { date: string; requestCount: number }[];
  peak: number;
  label: string;
}) {
  if (days.length === 0) return null;
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-[46px] items-end gap-[3px]"
    >
      {days.map((day, i) => {
        const ratio = peak > 0 ? day.requestCount / peak : 0;
        const isToday = i === days.length - 1;
        return (
          <div
            key={day.date}
            title={`${day.date} · ${day.requestCount}`}
            className="min-h-[2px] flex-1 rounded-t-[2px]"
            style={{
              height: `${Math.max(ratio * 100, 4)}%`,
              background:
                day.requestCount === 0
                  ? "var(--bg-selected)"
                  : isToday
                    ? "var(--action-bg)"
                    : "color-mix(in srgb, var(--action-bg) 45%, transparent)",
            }}
          />
        );
      })}
    </div>
  );
}

function SectionHead({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className="text-section text-fg-1">{title}</h2>
      {hint && <span className="text-caption text-fg-3">{hint}</span>}
      {action && <span className="ms-auto">{action}</span>}
    </div>
  );
}
