import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpCircle,
  ArrowUpRight,
  Loader2,
  LogIn,
  RefreshCw,
  Route,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GlobalPage } from "@/lib/navigation";
import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import {
  APP_IDS,
  APP_LABELS,
  MODE_APP_IDS,
  isModeAppId,
} from "@/config/appConfig";
import { platformKeyApi } from "@/lib/api/platformKey";
import { proxyApi } from "@/lib/api/proxy";
import { toast } from "@/lib/toast";
import { usePlatformKeyStatusQuery } from "@/lib/query";
import { useUsageSummary, useUsageTrends } from "@/lib/query/usage";
import { useSidebarStatus } from "@/hooks/useSidebarStatus";
import { usePlatformWebLogin } from "@/hooks/usePlatformWebLogin";
import { AppGlyph, APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import {
  useAppModelRows,
  type AppModelRow,
} from "@/components/apps/AppModelCard";
import {
  toolDisplayName,
  useToolManagement,
} from "@/components/apps/useToolManagement";
import { ToolUpgradeConfirmDialog } from "@/components/apps/ToolUpgradeConfirmDialog";

interface HomeOverviewProps {
  visibleApps: VisibleApps;
  /** 当前应用：用于让对应行标出「正在看」。 */
  activeApp: AppId;
  onOpenApp: (app: AppId) => void;
  onOpenPage: (page: GlobalPage) => void;
}

function modeChip(app: AppId, mode: "direct" | "route" | "stack") {
  if (mode === "stack") {
    return {
      tone: "stack" as const,
      key: "mode.names.stack",
      fallback: "聚合",
    };
  }
  if (mode === "route") {
    return isModeAppId(app)
      ? { tone: "route" as const, key: "mode.names.route", fallback: "路由" }
      : {
          tone: "route" as const,
          key: "home.localConvert",
          fallback: "本地转换",
        };
  }
  return { tone: "info" as const, key: "mode.names.direct", fallback: "直连" };
}

/**
 * 首页总览（Paper & Signal 第一屏）。
 *
 * 这一版把「卡片墙」换成了编辑部式的报头 + 标尺线：
 * 四格平台读数、左侧客户端账本、右侧反色用量块与组件状态。
 * 数据全部来自既有真实查询（平台密钥、钱包、平台模型、本机用量、工具更新）。
 */
export function HomeOverview({
  visibleApps,
  activeApp,
  onOpenApp,
  onOpenPage,
}: HomeOverviewProps) {
  const { t, i18n } = useTranslation();
  const { data: keyStatus } = usePlatformKeyStatusQuery();
  const configured = keyStatus?.configured === true;
  const webLogin = usePlatformWebLogin();
  const tools = useToolManagement();
  const { appStatus } = useSidebarStatus();

  const apps = useMemo(
    () => APP_IDS.filter((app) => visibleApps[app]),
    [visibleApps],
  );
  const rows = useAppModelRows(apps, configured);

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

  const updatableCount = tools.updatableToolNames.length;
  const hasWallet = typeof wallet === "number" && Number.isFinite(wallet);
  const walletText = hasWallet
    ? `$${wallet.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : "$—";

  const today = useMemo(() => {
    try {
      return new Date().toLocaleDateString(i18n.language || "zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      return new Date().toLocaleDateString();
    }
  }, [i18n.language]);

  const toggleLogin = () =>
    void (webLogin.busy ? webLogin.cancel() : webLogin.login());

  return (
    <>
      <div
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto scroll-stable"
      >
        <div className="mx-auto flex w-full max-w-[1160px] flex-col px-8 pb-16 pt-9">
          {/* ── 报头 ─────────────────────────────────────────────────── */}
          <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 border-b border-hairline pb-6">
            <div className="min-w-0">
              <div className="af-kicker flex flex-wrap items-center gap-2.5">
                <span>Platform / Overview</span>
                <span
                  aria-hidden="true"
                  className="h-2.5 w-px bg-hairline-strong"
                />
                <span className="af-num tracking-normal">{today}</span>
              </div>
              <h1 className="mt-2 text-display text-fg-1">
                {t("nav.overview", { defaultValue: "总览" })}
              </h1>
              <p className="mt-1.5 max-w-xl text-body text-fg-2">
                {t("home.subtitle", {
                  defaultValue: "平台、客户端与用量一屏可见",
                })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={configured ? "ok" : "warn"} dot>
                {configured
                  ? t("platformConnection.connected", {
                      defaultValue: "已连接",
                    })
                  : t("platformConnection.disconnected", {
                      defaultValue: "未连接平台",
                    })}
              </Chip>
              {configured ? (
                <Button variant="neutral" size="compact" onClick={toggleLogin}>
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
              ) : (
                <Button size="compact" onClick={toggleLogin}>
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
            {webLogin.busy || webLogin.error ? (
              <p
                className={cn(
                  "w-full text-caption",
                  webLogin.error ? "text-danger" : "text-fg-3",
                )}
              >
                {webLogin.busy
                  ? t("platformKey.webLoginWaiting", {
                      defaultValue: "等待网页登录完成…",
                    })
                  : webLogin.error}
              </p>
            ) : null}
          </header>

          {/* ── 四格读数：没有卡片，只有标尺 ─────────────────────────── */}
          <section
            aria-label={t("home.stats", { defaultValue: "平台读数" })}
            className="grid grid-cols-2 border-b border-hairline md:grid-cols-4"
          >
            <Reading
              index={0}
              label={t("nav.walletBalance", { defaultValue: "钱包余额" })}
              value={walletText}
              hint={t("home.walletHint", {
                defaultValue: "实时读取平台钱包",
              })}
            />
            <Reading
              index={1}
              label={t("home.connectedApps", { defaultValue: "已接入客户端" })}
              value={configured ? String(connectedCount) : "—"}
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
            />
            <Reading
              index={2}
              label={t("home.platformModels", {
                defaultValue: "平台可选模型",
              })}
              value={platformModels ? String(platformModels.length) : "—"}
              unit={t("home.modelsUnit", { defaultValue: "个" })}
              hint={
                platformModels
                  ? t("home.modelsHint", { defaultValue: "实时取自平台" })
                  : "—"
              }
            />
            <Reading
              index={3}
              label={t("home.topModel", { defaultValue: "最常用模型" })}
              value={topModel ?? "—"}
              mono
              hint={t("home.topModelHint", {
                defaultValue: "各客户端主模型中出现最多",
              })}
            />
          </section>

          <div className="mt-9 grid items-start gap-x-10 gap-y-9 lg:grid-cols-[minmax(0,1fr)_318px]">
            {/* ── 客户端账本 ─────────────────────────────────────────── */}
            <section className="min-w-0">
              <SectionHead
                kicker={t("home.clientsKicker", { defaultValue: "Clients" })}
                title={t("home.appsTitle", { defaultValue: "客户端" })}
                hint={t("home.appsHintNew", {
                  defaultValue: "点任意一行进入配置详情；模型与密钥由平台下发",
                })}
                action={
                  <Button
                    variant="neutral"
                    size="compact"
                    disabled={
                      !configured || routing || routeTargets.length === 0
                    }
                    onClick={() => void routeAll()}
                  >
                    {routing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Route className="h-3.5 w-3.5" strokeWidth={1.6} />
                    )}
                    {routeTargets.length === 0
                      ? t("home.routeAllDone2", {
                          defaultValue: "已全部走路由",
                        })
                      : t("home.routeAll", {
                          count: routeTargets.length,
                          defaultValue: "全部走路由",
                        })}
                  </Button>
                }
              />

              <div className="mt-4 border-t border-hairline">
                <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_84px_96px_24px] gap-4 px-2 py-2.5 md:grid">
                  {[
                    t("home.colClient", { defaultValue: "客户端" }),
                    t("home.colModel", { defaultValue: "模型" }),
                    t("home.colMode", { defaultValue: "连接" }),
                    t("home.colStatus", { defaultValue: "状态" }),
                    "",
                  ].map((label, index) => (
                    <span
                      key={index}
                      className={cn(
                        "af-kicker text-[9px]",
                        index === 4 && "text-end",
                      )}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                {rows.map((row, index) => {
                  const status = appStatus(row.app);
                  const model = describeModel(row, t);
                  const chip = modeChip(row.app, status.mode);
                  const active = row.app === activeApp;
                  const isSetUp = configured && row.config?.connected === true;
                  return (
                    <button
                      key={row.app}
                      type="button"
                      onClick={() => onOpenApp(row.app)}
                      data-active={active}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "af-accent-rail group relative grid w-full grid-cols-[minmax(0,1fr)_24px] items-center gap-x-4 gap-y-2 border-b border-hairline px-2 py-3.5 text-start transition-colors hover:bg-subtle md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_84px_96px_24px]",
                        active && "bg-subtle/60",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="af-num w-5 shrink-0 text-[10px] text-fg-3">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-hairline bg-surface">
                          <AppGlyph
                            app={row.app}
                            size={17}
                            badgeClassName="bg-surface"
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-body font-medium text-fg-1">
                              {APP_DISPLAY_NAME[row.app]}
                            </span>
                            {active && (
                              <span className="af-kicker shrink-0 text-[9px] text-action-text">
                                {t("home.viewingNow", {
                                  defaultValue: "正在看",
                                })}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 md:hidden">
                            <Chip tone={chip.tone}>
                              {t(chip.key, { defaultValue: chip.fallback })}
                            </Chip>
                            <StatusDot
                              ok={isSetUp}
                              warn={status.alert}
                              label={statusLabel(row, configured, t)}
                            />
                          </span>
                        </span>
                      </div>

                      <div className="col-start-2 row-start-2 min-w-0 ps-8 md:col-start-2 md:row-start-1 md:ps-0">
                        <div
                          className="af-num truncate text-caption text-fg-1"
                          title={model.primary}
                        >
                          {model.primary}
                        </div>
                        <div className="truncate text-badge text-fg-3">
                          {model.secondary}
                        </div>
                      </div>

                      <div className="hidden md:block">
                        <Chip tone={chip.tone}>
                          {t(chip.key, { defaultValue: chip.fallback })}
                        </Chip>
                      </div>

                      <div className="hidden md:block">
                        <StatusDot
                          ok={isSetUp}
                          warn={status.alert}
                          label={statusLabel(row, configured, t)}
                        />
                      </div>

                      <ArrowUpRight
                        className="col-start-2 row-start-1 ms-auto h-4 w-4 shrink-0 text-fg-3 transition-colors group-hover:text-action-text md:col-start-5 md:row-start-1"
                        strokeWidth={1.6}
                      />
                    </button>
                  );
                })}
                {rows.length === 0 && (
                  <p className="border-b border-hairline py-10 text-center text-caption text-fg-3">
                    {t("home.noVisibleApps", {
                      defaultValue: "还没有在首页显示任何客户端。",
                    })}
                  </p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-badge text-fg-3">
                  {t("home.routedCount", {
                    routed: routedCount,
                    total: routeApps.length,
                    defaultValue: "本机路由 {{routed}}/{{total}}",
                  })}
                </span>
              </div>
            </section>

            {/* ── 右栏：用量、组件与平台 ─────────────────────────────── */}
            <aside className="flex min-w-0 flex-col gap-5">
              <section className="overflow-hidden rounded-panel bg-inverse-bg px-5 pb-5 pt-4 text-inverse-fg">
                <div className="flex items-center justify-between gap-3">
                  <span className="af-kicker text-[9px] text-inverse-fg opacity-60">
                    {t("home.usageTitle", { defaultValue: "最近用量" })} · 7D
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenPage("usage")}
                    className="text-badge text-inverse-fg opacity-60 transition-opacity hover:opacity-100"
                  >
                    {t("home.usageOpen", { defaultValue: "查看统计" })} →
                  </button>
                </div>
                {summary ? (
                  <>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="af-num text-display leading-none">
                        {summary.totalRequests.toLocaleString("en-US")}
                      </span>
                      <span className="text-caption opacity-60">
                        {t("home.requestsUnit", { defaultValue: "次请求" })}
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption opacity-60">
                      <span className="af-num">
                        ${(Number.parseFloat(summary.totalCost) || 0).toFixed(2)}
                      </span>
                      <span className="af-num">
                        {summary.realTotalTokens.toLocaleString("en-US")} Token
                      </span>
                    </div>
                    <InverseSpark
                      days={spark.days}
                      peak={spark.peak}
                      label={t("home.usageSpark", {
                        defaultValue: "近 7 天每日请求数",
                      })}
                    />
                  </>
                ) : (
                  <p className="mt-4 text-caption leading-5 opacity-60">
                    {t("home.usageEmpty", {
                      defaultValue:
                        "本机还没有用量记录 —— 客户端产生请求后，这里按天画出请求数、花费与 Token。",
                    })}
                  </p>
                )}
              </section>

              <section className="rounded-panel border border-hairline bg-surface px-4 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="af-kicker">
                    {t("platformConnection.appUpdates", {
                      defaultValue: "应用更新",
                    })}
                  </span>
                  <span
                    className={cn(
                      "af-num text-title",
                      updatableCount > 0 ? "text-warning-text" : "text-fg-1",
                    )}
                  >
                    {tools.isLoadingTools
                      ? "…"
                      : updatableCount > 0
                        ? String(updatableCount).padStart(2, "0")
                        : "00"}
                  </span>
                </div>
                <p className="mt-1 text-badge text-fg-3">
                  {tools.isLoadingTools
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
                          })}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
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
                      strokeWidth={1.6}
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
                        <ArrowUpCircle
                          className="h-3.5 w-3.5"
                          strokeWidth={1.6}
                        />
                      )}
                      {t("platformConnection.updatesRunAll", {
                        count: updatableCount,
                        defaultValue: "全部升级",
                      })}
                    </Button>
                  )}
                </div>
              </section>

            </aside>
          </div>
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

/** 一条读数：小眉标、30px 等宽数字、下面一行解释；竖线只在标尺上。 */
function Reading({
  index,
  label,
  value,
  unit,
  hint,
  mono = false,
}: {
  index: number;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 px-5 py-5",
        index % 2 === 1 && "border-s border-hairline",
        index >= 2 && "border-t border-hairline md:border-t-0",
        index > 0 && "md:border-s",
      )}
    >
      <div className="af-kicker">{label}</div>
      <div
        className={cn(
          "mt-2 flex items-baseline gap-1.5 text-fg-1",
          mono ? "min-w-0" : "whitespace-nowrap",
        )}
      >
        <span
          className={cn("af-num truncate", mono ? "text-title" : "text-metric")}
          title={mono ? value : undefined}
        >
          {value}
        </span>
        {unit && (
          <span className="af-num shrink-0 text-caption text-fg-3">{unit}</span>
        )}
      </div>
      {hint && (
        <div className="mt-1 truncate text-badge text-fg-3" title={hint}>
          {hint}
        </div>
      )}
    </div>
  );
}

function SectionHead({
  kicker,
  title,
  hint,
  action,
}: {
  kicker: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
      <div className="min-w-0">
        <div className="af-kicker">{kicker}</div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-title text-fg-1">{title}</h2>
          {hint && <span className="text-badge text-fg-3">{hint}</span>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function StatusDot({
  ok,
  warn,
  label,
}: {
  ok: boolean;
  warn: boolean;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-badge text-fg-2">
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          warn ? "bg-warning" : ok ? "bg-success" : "bg-fg-3",
        )}
      />
      {label}
    </span>
  );
}

function statusLabel(row: AppModelRow, configured: boolean, t: TFunction) {
  if (!configured) return t("home.statusSignedOut", { defaultValue: "未登录" });
  if (row.loading)
    return t("platformConnection.modelLoading", { defaultValue: "读取中…" });
  if (row.config?.connected)
    return t("home.statusPushed", { defaultValue: "已下发" });
  if (row.config)
    return t("platformConnection.appLocal", { defaultValue: "本机配置" });
  return t("home.notAvailable", { defaultValue: "暂无数据" });
}

function describeModel(row: AppModelRow, t: TFunction) {
  const config = row.config;
  if (row.loading) {
    return {
      primary: t("platformConnection.modelLoading", { defaultValue: "读取中…" }),
      secondary: t("home.modelSource", { defaultValue: "平台模型配置" }),
    };
  }
  if (!config) {
    return {
      primary: "—",
      secondary: t("home.notAvailable", { defaultValue: "暂无数据" }),
    };
  }
  if (config.supportsList) {
    return {
      primary:
        config.models[0] ??
        t("platformConnection.modelNone", { defaultValue: "未选择模型" }),
      secondary: t("platformConnection.modelCount", {
        count: config.models.length,
        defaultValue: "{{count}} 个模型",
      }),
    };
  }
  const primary = config.defaultModel ?? "—";
  const secondary = config.supportsLight
    ? `${t("home.lightModelTag", { defaultValue: "轻量" })} ${
        config.lightModel ?? t("home.sameAsMain", { defaultValue: "同主模型" })
      }`
    : t("home.singleModel", { defaultValue: "单模型" });
  return { primary, secondary };
}

/**
 * 反色用量块里的柱子：颜色跟随 --inverse-fg，切主题时整块反过来。
 * 今天实心，其余按比例压暗；零请求留一条底线。
 */
function InverseSpark({
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
      className="mt-5 flex h-[52px] items-end gap-[3px]"
      style={{
        borderBottom:
          "1px solid color-mix(in srgb, var(--inverse-fg) 22%, transparent)",
      }}
    >
      {days.map((day, i) => {
        const ratio = peak > 0 ? day.requestCount / peak : 0;
        const isToday = i === days.length - 1;
        return (
          <div
            key={day.date}
            title={`${day.date} · ${day.requestCount}`}
            className="min-h-[2px] flex-1 rounded-t-[1px]"
            style={{
              height: `${Math.max(ratio * 100, 4)}%`,
              background:
                day.requestCount === 0
                  ? "color-mix(in srgb, var(--inverse-fg) 16%, transparent)"
                  : isToday
                    ? "var(--inverse-fg)"
                    : "color-mix(in srgb, var(--inverse-fg) 48%, transparent)",
            }}
          />
        );
      })}
    </div>
  );
}
