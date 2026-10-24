import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpCircle,
  ArrowUpRight,
  Loader2,
  LogIn,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { visibleModelId } from "@/lib/modelId";
import type { GlobalPage } from "@/lib/navigation";
import type { AppId } from "@/lib/api";
import type { Provider, VisibleApps } from "@/types";
import { platformKeyApi } from "@/lib/api/platformKey";
import { usePlatformKeyStatusQuery } from "@/lib/query";
import { useAppMode, useProxyStatusQuery } from "@/lib/query/proxy";
import { useUsageSummaryByApp } from "@/lib/query/usage";
import {
  APP_IDS,
  isAdditiveAppId,
  isModeAppId,
  isProxyAppId,
} from "@/config/appConfig";
import { ToolUpgradeConfirmDialog } from "@/components/apps/ToolUpgradeConfirmDialog";
import { PlatformModelDialog } from "@/components/providers/PlatformModelDialog";
import { ModeSwitch } from "@/components/providers/ModeSwitch";
import {
  toolDisplayName,
  useToolManagement,
} from "@/components/apps/useToolManagement";
import { usePlatformWebLogin } from "@/hooks/usePlatformWebLogin";
import { APP_DISPLAY_NAME, AppGlyph } from "@/components/shell/AppGlyph";

interface PlatformConnectionPanelProps {
  app: AppId;
  /** 该应用已有的供应商，用来判断平台条目是否已下发到本机配置。 */
  providers: Record<string, Provider>;
  /** 切换型应用的当前供应商；additive 应用没有这个概念，通常为空。 */
  currentProviderId: string;
  /** 首页可见的客户端，用来生成「切换到其他客户端」。 */
  visibleApps: VisibleApps;
  /** 打开用量统计等全局页。 */
  onOpenPage: (page: GlobalPage) => void;
  /** 切到另一个客户端的详情页。 */
  onOpenApp: (app: AppId) => void;
}

function isPlatformProvider(provider: Provider): boolean {
  // 平台的供应商条目以 `*-official` 结尾（历史库里也可能叫 AIFusion）
  return (
    provider.id.endsWith("-official") ||
    provider.name.toLowerCase().includes("aifusion")
  );
}

/**
 * 客户端详情页（Paper & Signal）。
 *
 * 报头给出客户端身份与平台状态，正文是一张没有外框的规格表：
 * 主模型、连接方式、最近用量、组件更新。
 * 右栏是只读的可用模型清单和其他客户端的入口。
 *
 * 这个构建只对接 AIFusion 自有平台：供应商 / 渠道由平台统一下发，
 * 不在客户端里展示，也不提供手动添加，所以页面里没有地址和密钥。
 */
export function PlatformConnectionPanel({
  app,
  providers,
  currentProviderId,
  visibleApps,
  onOpenPage,
  onOpenApp,
}: PlatformConnectionPanelProps) {
  const { t } = useTranslation();
  const { data: keyStatus, isLoading } = usePlatformKeyStatusQuery();
  const configured = keyStatus?.configured === true;
  const webLogin = usePlatformWebLogin();
  const modeApp = isModeAppId(app);
  const { data: modeView } = useAppMode(app, modeApp);
  const { data: proxyStatus } = useProxyStatusQuery();
  // 应用更新放在详情里：不再单独给「应用」入口。
  const tools = useToolManagement();
  const updatableCount = tools.updatableToolNames.length;
  // 渠道卡隐藏了，模型只能在这里选：按应用读一次平台模型配置。
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { data: modelConfig } = useQuery({
    queryKey: ["platformModelConfig", app],
    queryFn: () => platformKeyApi.modelConfig(app),
    enabled: configured,
    staleTime: 15_000,
  });
  // 近 7 天用量：和首页「最近用量」同一份缓存（按客户端汇总的那一条）
  const usageRange = useMemo(() => ({ preset: "7d" as const }), []);
  const { data: usageByApp, isLoading: usageLoading } =
    useUsageSummaryByApp(usageRange);
  // Claude Desktop 的流量记在 claude 名下，和用量页的筛选口径一致
  const usageKey = app === "claude-desktop" ? "claude" : app;
  const usageRow = usageByApp?.find((item) => item.appType === usageKey);

  // 其他可见客户端：详情页右栏的切换入口，不用回首页
  const otherApps = useMemo(
    () => APP_IDS.filter((item) => item !== app && visibleApps[item]),
    [app, visibleApps],
  );

  // 平台会下发 __AIFUSION_MODEL__ 这类占位符（写入本机时再替换），
  // 界面上过滤掉，免得看起来像配置坏了。
  const availableModels = useMemo(() => {
    if (!modelConfig) return [];
    const source =
      modelConfig.models.length > 0
        ? modelConfig.models
        : [modelConfig.defaultModel, modelConfig.lightModel];
    const list = source
      .map((id) => visibleModelId(id))
      .filter((id): id is string => id != null);
    return [...new Set(list)];
  }, [modelConfig]);

  // 主模型是占位符时不要拿轻量模型或列表第一项顶替：显示「由平台下发」更诚实。
  const mainModel = visibleModelId(modelConfig?.defaultModel) ?? null;
  const lightModel = visibleModelId(modelConfig?.lightModel);

  // additive 应用（OpenCode / OpenClaw / Hermes / Pi / Mcode）没有「当前供应商」，
  // 只要平台条目已经下发到库里就算已接入；其余应用看当前选中的那一条。
  const platformProvider = isAdditiveAppId(app)
    ? Object.values(providers).some(isPlatformProvider)
    : currentProviderId !== "" &&
      providers[currentProviderId] != null &&
      isPlatformProvider(providers[currentProviderId]);

  const mode = modeApp ? (modeView?.mode ?? "direct") : "direct";
  const routed = mode === "route" || mode === "stack";
  const proxyRunning = proxyStatus?.running === true;

  const modeLabel =
    mode === "stack"
      ? t("mode.names.stack", { defaultValue: "聚合" })
      : mode === "route"
        ? t("mode.names.route", { defaultValue: "路由" })
        : t("mode.names.direct", { defaultValue: "直连" });

  // 连接方式后面那句解释：直连 / 本地转换 / 路由服务状态各说一种
  const modeNote = (() => {
    if (routed && isProxyAppId(app)) {
      return proxyRunning
        ? t("platformConnection.proxyRunning", {
            defaultValue: "路由服务运行中",
          })
        : t("platformConnection.proxyStopped", {
            defaultValue: "路由服务未启动",
          });
    }
    if (routed) {
      return t("platformConnection.modeConvertHint", {
        defaultValue: "经本机转换服务转成兼容请求",
      });
    }
    if (!isModeAppId(app)) {
      return t("platformConnection.modeNoRouteHint", {
        defaultValue: "配置由平台直接写入，该客户端不支持本机路由",
      });
    }
    return t("platformConnection.modeDirectHint", {
      defaultValue: "客户端直接请求平台网关，不经本机代理",
    });
  })();

  const usageText = (() => {
    if (usageLoading) {
      return t("platformConnection.modelLoading", { defaultValue: "读取中…" });
    }
    if (!usageRow) {
      return t("platformConnection.usageNone", {
        defaultValue: "近 7 天暂无用量记录",
      });
    }
    return t("platformConnection.usageLine", {
      requests: usageRow.summary.totalRequests,
      cost: (Number.parseFloat(usageRow.summary.totalCost) || 0).toFixed(2),
      tokens: usageRow.summary.realTotalTokens.toLocaleString("en-US"),
      defaultValue: "{{requests}} 次请求 · ${{cost}} · {{tokens}} Token",
    });
  })();

  const toggleLogin = () =>
    void (webLogin.busy ? webLogin.cancel() : webLogin.login());

  const connectionChip = isLoading ? (
    <Chip tone="mute" dot>
      {t("platformKey.loading", { defaultValue: "读取中…" })}
    </Chip>
  ) : configured ? (
    <Chip tone="ok" dot>
      {t("platformConnection.connected", { defaultValue: "已连接" })}
    </Chip>
  ) : (
    <Chip tone="warn" dot>
      {t("platformConnection.disconnected", { defaultValue: "未连接平台" })}
    </Chip>
  );

  return (
    <>
      <div className="mx-auto w-full max-w-[1160px] px-8 pb-16 pt-8">
        {/* ── 报头：客户端身份与平台状态 ─────────────────────────────── */}
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 border-b border-hairline pb-6">
          <div className="min-w-0">
            <div className="af-kicker flex flex-wrap items-center gap-2.5">
              <span aria-hidden="true" className="af-kicker-dot" />
              <span>Client</span>
              <span
                aria-hidden="true"
                className="h-2.5 w-px bg-hairline-strong"
              />
              <span className="af-num tracking-normal">
                {String(APP_IDS.indexOf(app) + 1).padStart(2, "0")} /{" "}
                {String(APP_IDS.length).padStart(2, "0")}
              </span>
            </div>
            <h1 className="mt-2 text-page text-fg-1">{APP_DISPLAY_NAME[app]}</h1>
            <p className="mt-1.5 max-w-xl text-body text-fg-2">
              {t("platformConnection.detailSubtitle", {
                defaultValue:
                  "模型、路由与密钥由平台统一管理；保存后立即写入本机配置。",
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {connectionChip}
            {configured && (
              <Chip tone={platformProvider ? "mute" : "warn"}>
                {platformProvider
                  ? t("platformConnection.appConnected", {
                      defaultValue: "已接入平台",
                    })
                  : t("platformConnection.appLocal", {
                      defaultValue: "使用本机配置",
                    })}
              </Chip>
            )}
            <Chip
              tone={
                mode === "stack" ? "stack" : mode === "route" ? "route" : "mute"
              }
            >
              {modeLabel}
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

        <div className="mt-8 grid items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_318px]">
          {/* ── 规格表 ─────────────────────────────────────────────── */}
          <section className="min-w-0 overflow-hidden rounded-panel border border-hairline bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-hairline px-5 py-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="af-kicker">Platform</span>
                <h2 className="m-0 text-body font-semibold text-fg-1">
                  {t("platformConnection.specTitle", {
                    defaultValue: "配置",
                  })}
                </h2>
                <span className="text-badge text-fg-3">
                  {t("platformConnection.specHint", {
                    defaultValue: "只写入这个客户端，不影响其他应用",
                  })}
                </span>
              </div>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 text-badge",
                  configured ? "text-fg-2" : "text-fg-3",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    configured ? "bg-action-text" : "bg-hairline-strong",
                  )}
                />
                {configured
                  ? t("platformConnection.keyWritten", {
                      defaultValue: "密钥已写入本机",
                    })
                  : t("platformConnection.keyMissing", {
                      defaultValue: "登录后写入本机",
                    })}
              </span>
            </div>

            <div>
              <Spec
                label={t("platformConnection.modelLabel", {
                  defaultValue: "主模型",
                })}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="af-num truncate text-strong text-fg-1"
                    title={mainModel ?? undefined}
                  >
                    {mainModel ??
                      (configured
                        ? t("platformConnection.modelSource", {
                            defaultValue: "由平台下发",
                          })
                        : t("platformConnection.modelSignedOut", {
                            defaultValue: "登录平台后可选择",
                          }))}
                  </span>
                  <span className="mt-0.5 truncate text-badge text-fg-3">
                    {configured && mainModel == null
                      ? t("platformConnection.modelInjectedHint", {
                          defaultValue: "写入本机时按账号替换",
                        })
                      : t("platformConnection.modelSource", {
                          defaultValue: "由平台下发",
                        })}
                  </span>
                </span>
                <Button
                  variant="neutral"
                  size="compact"
                  className="shrink-0"
                  disabled={!configured}
                  onClick={() => setModelDialogOpen(true)}
                >
                  {t("platformConnection.chooseModel", {
                    defaultValue: "选择模型",
                  })}
                </Button>
              </Spec>

              <Spec
                label={t("platformConnection.modeLabel", {
                  defaultValue: "连接方式",
                })}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    {isModeAppId(app) ? (
                      <ModeSwitch
                        app={app}
                        mode={mode}
                        disabled={!configured}
                      />
                    ) : (
                      <Chip tone="info">{modeLabel}</Chip>
                    )}
                    {mode === "stack" && (
                      <Chip tone="stack">
                        {t("mode.names.stack", { defaultValue: "聚合" })}
                      </Chip>
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-badge",
                      routed && isProxyAppId(app) && !proxyRunning
                        ? "text-warning-text"
                        : "text-fg-3",
                    )}
                  >
                    {modeNote}
                  </span>
                </span>
              </Spec>

              <Spec
                label={t("platformConnection.usageLabel", {
                  defaultValue: "最近用量",
                })}
              >
                <span className="af-num min-w-0 flex-1 truncate text-caption text-fg-1">
                  {usageText}
                </span>
                <Button
                  variant="neutral"
                  size="compact"
                  className="shrink-0"
                  onClick={() => onOpenPage("usage")}
                >
                  {t("platformConnection.usageOpen", {
                    defaultValue: "查看统计",
                  })}
                </Button>
              </Spec>

              <Spec
                label={t("platformConnection.appUpdates", {
                  defaultValue: "应用更新",
                })}
                last
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <Chip tone={updatableCount > 0 ? "warn" : "mute"}>
                    {tools.isLoadingTools
                      ? t("platformConnection.updatesChecking", {
                          defaultValue: "检查中…",
                        })
                      : updatableCount > 0
                        ? t("platformConnection.updatesAvailable", {
                            count: updatableCount,
                            defaultValue: "{{count}} 个可升级",
                          })
                        : tools.lastCheckedAt
                          ? t("platformConnection.updatesLatest", {
                              defaultValue: "已是最新",
                            })
                          : t("platformConnection.updatesUnchecked", {
                              defaultValue: "未检查",
                            })}
                  </Chip>
                  <span className="text-badge text-fg-3">
                    {t("platformConnection.updatesForApp", {
                      defaultValue: "升级会替换该客户端的命令行程序",
                    })}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
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
                </span>
              </Spec>
            </div>
          </section>

          {/* ── 右栏：可用模型 + 切换客户端 ───────────────────────────── */}
          <aside className="flex min-w-0 flex-col gap-4">
            <section className="overflow-hidden rounded-panel border border-hairline bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <span className="af-kicker">Models</span>
                  <h2 className="m-0 text-body font-semibold text-fg-1">
                    {t("platformConnection.availableModels", {
                      defaultValue: "可用模型",
                    })}
                  </h2>
                </div>
                <span className="shrink-0 text-badge tabular-nums text-fg-3">
                  {t("platformConnection.modelsCount", {
                    count: availableModels.length,
                    defaultValue: "{{count}} 个",
                  })}
                </span>
              </div>
              {availableModels.length === 0 ? (
                <p className="m-0 px-5 py-5 text-caption text-fg-3">
                  {configured
                    ? t("platformConnection.modelNone", {
                        defaultValue: "未选择模型",
                      })
                    : t("platformConnection.modelSignedOut", {
                        defaultValue: "登录平台后可选择",
                      })}
                </p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {availableModels.map((id) => {
                    const role =
                      id === mainModel
                        ? "main"
                        : id === lightModel
                          ? "light"
                          : "metered";
                    return (
                      <li
                        key={id}
                        className={cn(
                          "flex items-center gap-2.5 border-b border-hairline px-5 py-2.5 last:border-b-0",
                          role === "metered" && "text-fg-2",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            id === mainModel
                              ? "bg-action-text"
                              : "bg-hairline-strong",
                          )}
                        />
                        <span
                          className={cn(
                            "af-num min-w-0 flex-1 truncate text-caption",
                            id === mainModel ? "text-fg-1" : "text-fg-2",
                          )}
                          title={id}
                        >
                          {id}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-1.5 py-[1px] text-[9.5px] leading-[13px]",
                            role === "main"
                              ? "border-[rgba(61,219,208,0.3)] bg-action-soft text-action-text"
                              : role === "light"
                                ? "border-hairline-strong text-fg-2"
                                : "border-transparent text-fg-3",
                          )}
                        >
                          {role === "main"
                            ? t("platformConnection.modelRoleMain", {
                                defaultValue: "主",
                              })
                            : role === "light"
                              ? t("platformConnection.modelRoleLight", {
                                  defaultValue: "轻量",
                                })
                              : t("platformConnection.modelRoleMetered", {
                                  defaultValue: "按量",
                                })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {otherApps.length > 0 && (
              <section className="overflow-hidden rounded-panel border border-hairline bg-surface">
                <div className="border-b border-hairline px-5 py-3">
                  <div className="flex min-w-0 items-baseline gap-2.5">
                    <span className="af-kicker">Clients</span>
                    <h2 className="m-0 text-body font-semibold text-fg-1">
                      {t("platformConnection.switchTitle", {
                        defaultValue: "切换到其他客户端",
                      })}
                    </h2>
                  </div>
                  <p className="m-0 mt-0.5 text-badge text-fg-3">
                    {t("platformConnection.switchHint", {
                      defaultValue: "只改当前查看的应用",
                    })}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-3">
                  {otherApps.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onOpenApp(item)}
                      className="group flex min-w-0 items-center gap-2 rounded-control border border-hairline px-2 py-2 text-start transition-colors hover:border-hairline-strong hover:bg-subtle active:translate-y-px"
                    >
                      <AppGlyph
                        app={item}
                        size={14}
                        badgeClassName="bg-surface"
                      />
                      <span className="min-w-0 flex-1 truncate text-badge text-fg-2 group-hover:text-fg-1">
                        {APP_DISPLAY_NAME[item]}
                      </span>
                      <ArrowUpRight
                        className="h-3 w-3 shrink-0 text-fg-3"
                        strokeWidth={1.6}
                      />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>

      <ToolUpgradeConfirmDialog
        isOpen={tools.pendingUpgrade !== null}
        plans={tools.pendingUpgrade?.plans ?? []}
        displayName={toolDisplayName}
        onConfirm={tools.handleConfirmUpgrade}
        onCancel={tools.handleCancelUpgrade}
      />

      <PlatformModelDialog
        app={app}
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
      />
    </>
  );
}

/**
 * 规格表的一行：92px 标签 + 可换行的值 + 右对齐操作。
 * 行之间只用发丝线；外框和抬头由上面的卡片负责。
 */
function Spec({
  label,
  last = false,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b border-hairline px-5 py-3.5 md:flex-row md:items-center md:gap-x-4",
        last && "border-b-0",
      )}
    >
      <span className="shrink-0 text-badge text-fg-3 md:w-[92px]">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        {children}
      </div>
    </div>
  );
}
