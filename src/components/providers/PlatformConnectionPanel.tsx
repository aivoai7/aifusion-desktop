import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { homeDir } from "@tauri-apps/api/path";
import { ArrowUpCircle, Loader2, LogIn, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { GlobalPage } from "@/lib/navigation";
import type { AppId } from "@/lib/api";
import type { Provider, VisibleApps } from "@/types";
import { platformKeyApi } from "@/lib/api/platformKey";
import { settingsApi } from "@/lib/api/settings";
import { usePlatformKeyStatusQuery } from "@/lib/query";
import { useAppMode, useProxyStatusQuery } from "@/lib/query/proxy";
import { useUsageSummaryByApp } from "@/lib/query/usage";
import { CLIENT_CONFIG_FILE } from "@/config/clientConfigTargets";
import {
  APP_IDS,
  isAdditiveAppId,
  isModeAppId,
  isProxyAppId,
} from "@/config/appConfig";
import { extractErrorMessage } from "@/utils/errorUtils";
import { ToolUpgradeConfirmDialog } from "@/components/settings/ToolUpgradeConfirmDialog";
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
  /** 侧栏里可见的客户端，用来生成「切换到其他客户端」。 */
  visibleApps: VisibleApps;
  onOpenKeySettings: () => void;
  /** 打开 MCP / Skills / 提示词 / 会话 / 用量统计等全局页。 */
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
 * 把后端解析出的配置目录 + 已知文件名收成一行可读路径，用户目录显示成 `~`。
 * 目录可能是用户在设置里自定义的，所以不写死。
 */
function formatConfigTarget(
  app: AppId,
  dir: string | undefined,
  home: string | undefined,
) {
  if (!dir) return null;
  const base = dir.replace(/[\\/]+$/, "");
  const separator = base.includes("\\") ? "\\" : "/";
  const fileName = CLIENT_CONFIG_FILE[app];
  const full = fileName ? `${base}${separator}${fileName}` : base;
  const homeBase = home?.replace(/[\\/]+$/, "");
  if (homeBase && full.toLowerCase().startsWith(homeBase.toLowerCase())) {
    return `~${full.slice(homeBase.length).replace(/\\/g, "/")}`;
  }
  return full;
}

/**
 * 客户端详情页（Ink & Grid 第二屏）。
 *
 * 一屏讲清一个客户端：左边一张规格表（主模型 / 连接方式 / 配置落点 / 密钥来源 /
 * 最近用量 / 应用更新 / 更多功能），右边可用模型清单和横向切客户端的入口。
 * 全页只用发丝线分格，没有上游的圆角玻璃卡与光晕。
 *
 * 这个构建只对接 AIFusion 自有平台：供应商 / 渠道由平台统一下发，
 * 不在客户端里展示，也不提供手动添加，所以页面里没有地址和密钥。
 */
export function PlatformConnectionPanel({
  app,
  providers,
  currentProviderId,
  visibleApps,
  onOpenKeySettings,
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
  // 应用更新放在详情里：侧栏不再单独给「应用」入口。
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
  const { data: platformModels } = useQuery({
    queryKey: ["platformModels"],
    queryFn: () => platformKeyApi.models(),
    enabled: configured,
    staleTime: 60_000,
  });

  // 配置落点：目录由后端按当前设置解析，再补上该客户端的配置文件名
  const { data: configDir } = useQuery({
    queryKey: ["configDir", app],
    queryFn: () => settingsApi.getConfigDir(app),
    staleTime: 60_000,
  });
  const { data: homePath } = useQuery({
    queryKey: ["homeDir"],
    queryFn: () => homeDir(),
    staleTime: Infinity,
  });
  const targetPath = useMemo(
    () => formatConfigTarget(app, configDir, homePath),
    [app, configDir, homePath],
  );

  // 近 7 天用量：和首页「最近用量」同一份缓存（按客户端汇总的那一条）
  const usageRange = useMemo(() => ({ preset: "7d" as const }), []);
  const { data: usageByApp, isLoading: usageLoading } =
    useUsageSummaryByApp(usageRange);
  // Claude Desktop 的流量记在 claude 名下，和用量页的筛选口径一致
  const usageKey = app === "claude-desktop" ? "claude" : app;
  const usageRow = usageByApp?.find((item) => item.appType === usageKey);

  // 其他可见客户端：详情页右侧一行胶囊，横向切换不用回首页
  const otherApps = useMemo(
    () => APP_IDS.filter((item) => item !== app && visibleApps[item]),
    [app, visibleApps],
  );

  // 模型 id → 厂商；平台列表没回来时留空，不猜
  const vendorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of platformModels ?? []) map.set(model.id, model.provider);
    return map;
  }, [platformModels]);

  const availableModels = useMemo(() => {
    if (!modelConfig) return [];
    const list =
      modelConfig.models.length > 0
        ? modelConfig.models
        : [modelConfig.defaultModel, modelConfig.lightModel].filter(
            (id): id is string => Boolean(id),
          );
    return [...new Set(list)];
  }, [modelConfig]);

  const mainModel = modelConfig?.defaultModel ?? modelConfig?.models[0] ?? null;

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

  const openConfigFolder = () => {
    settingsApi.openConfigFolder(app).catch((error: unknown) => {
      toast.error(
        t("platformConnection.openFolderFailed", {
          defaultValue: "打开目录失败",
        }),
        { description: extractErrorMessage(error) || undefined },
      );
    });
  };

  const signInButton = (
    <Button
      size="compact"
      onClick={() =>
        void (webLogin.busy ? webLogin.cancel() : webLogin.login())
      }
    >
      {webLogin.busy ? (
        <X className="h-3.5 w-3.5" />
      ) : (
        <LogIn className="h-3.5 w-3.5" />
      )}
      {webLogin.busy
        ? t("platformKey.cancelWaiting", { defaultValue: "取消等待" })
        : t("platformConnection.signIn", { defaultValue: "登录平台" })}
    </Button>
  );

  return (
    <>
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_296px]">
        {/* ── 规格表 ───────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-panel border border-hairline bg-surface shadow-sm">
          <Spec
            label={t("platformConnection.modelLabel", {
              defaultValue: "主模型",
            })}
          >
            <span className="inline-flex min-w-0 items-baseline gap-1.5">
              <span
                className="af-num truncate text-body text-fg-1"
                title={mainModel ?? undefined}
              >
                {mainModel ??
                  (configured
                    ? t("platformConnection.modelNone", {
                        defaultValue: "未选择模型",
                      })
                    : t("platformConnection.modelSignedOut", {
                        defaultValue: "登录平台后可选择",
                      }))}
              </span>
              {mainModel && vendorByName.get(mainModel) && (
                <span className="shrink-0 text-badge text-fg-3">
                  · {vendorByName.get(mainModel)}
                </span>
              )}
            </span>
            <Button
              variant="neutral"
              size="compact"
              className="ms-auto shrink-0"
              disabled={!configured}
              onClick={() => setModelDialogOpen(true)}
            >
              {t("platformConnection.chooseModel", {
                defaultValue: "选择模型",
              })}
            </Button>
          </Spec>

          <Spec
            label={t("platformConnection.title", {
              defaultValue: "AIFusion 平台",
            })}
          >
            <Chip tone={configured ? "ok" : "warn"} dot>
              {isLoading
                ? t("platformKey.loading", { defaultValue: "读取中…" })
                : configured
                  ? t("platformConnection.connected", {
                      defaultValue: "已连接",
                    })
                  : t("platformConnection.disconnected", {
                      defaultValue: "未连接平台",
                    })}
            </Chip>
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
            <span className="ms-auto flex shrink-0 items-center gap-2">
              {configured ? (
                <Button
                  variant="neutral"
                  size="compact"
                  onClick={onOpenKeySettings}
                >
                  {t("platformConnection.manageKey", {
                    defaultValue: "管理连接",
                  })}
                </Button>
              ) : (
                signInButton
              )}
            </span>
          </Spec>

          <Spec
            label={t("platformConnection.modeLabel", {
              defaultValue: "连接方式",
            })}
          >
            {isModeAppId(app) ? (
              <>
                {mode === "stack" && (
                  <Chip tone="stack">
                    {t("mode.names.stack", { defaultValue: "聚合" })}
                  </Chip>
                )}
                <ModeSwitch app={app} mode={mode} disabled={!configured} />
              </>
            ) : (
              <Chip tone="info">{modeLabel}</Chip>
            )}
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
          </Spec>

          <Spec
            label={t("platformConnection.targetLabel", {
              defaultValue: "配置落点",
            })}
          >
            <span
              className="af-num min-w-0 truncate text-body text-fg-2"
              title={targetPath ?? undefined}
            >
              {targetPath ??
                t("platformConnection.targetLoading", {
                  defaultValue: "读取中…",
                })}
            </span>
            <span className="shrink-0 text-badge text-fg-3">
              {t("platformConnection.targetHint", {
                defaultValue: "保存后立即写入",
              })}
            </span>
            <Button
              variant="neutral"
              size="compact"
              className="ms-auto shrink-0"
              onClick={openConfigFolder}
            >
              {t("platformConnection.openFolder", {
                defaultValue: "打开配置目录",
              })}
            </Button>
          </Spec>

          <Spec
            label={t("platformConnection.keyLabel", {
              defaultValue: "密钥来源",
            })}
          >
            <span className="text-body text-fg-1">
              {t("platformConnection.keyHint", {
                defaultValue: "平台登录自动下发",
              })}
            </span>
            <Chip tone="mute">
              {t("platformConnection.keyLocal", { defaultValue: "本机保存" })}
            </Chip>
          </Spec>

          <Spec
            label={t("platformConnection.usageLabel", {
              defaultValue: "最近用量",
            })}
          >
            <span className="af-num text-body text-fg-1">{usageText}</span>
            <Button
              variant="neutral"
              size="compact"
              className="ms-auto"
              onClick={() => onOpenPage("usage")}
            >
              {t("platformConnection.usageOpen", { defaultValue: "查看统计" })}
            </Button>
          </Spec>

          <Spec
            label={t("platformConnection.appUpdates", {
              defaultValue: "应用更新",
            })}
          >
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
            <span className="ms-auto flex shrink-0 items-center gap-2">
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

          <Spec
            label={t("platformConnection.toolsLabel", {
              defaultValue: "更多功能",
            })}
            last
          >
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {[
                {
                  page: "mcp" as const,
                  label: "MCP",
                },
                { page: "skills" as const, label: "Skills" },
                {
                  page: "prompts" as const,
                  label: t("nav.prompts", { defaultValue: "提示词" }),
                },
                {
                  page: "sessions" as const,
                  label: t("nav.sessions", { defaultValue: "会话" }),
                },
                {
                  page: "usage" as const,
                  label: t("nav.usage", { defaultValue: "用量统计" }),
                },
              ].map((item) => (
                <button
                  key={item.page}
                  type="button"
                  onClick={() => onOpenPage(item.page)}
                  className="text-caption text-fg-2 transition-colors hover:text-action-text active:translate-y-px"
                >
                  {item.label}
                </button>
              ))}
              <span className="text-badge text-fg-3">
                {t("platformConnection.toolsHint", {
                  defaultValue: "作用于全部客户端",
                })}
              </span>
            </span>
          </Spec>

          {webLogin.busy || (!configured && webLogin.error) ? (
            <p
              className={cn(
                "hairline border-t px-4 py-2.5 text-caption",
                !configured && webLogin.error ? "text-danger" : "text-fg-3",
              )}
            >
              {webLogin.busy
                ? t("platformKey.webLoginWaiting", {
                    defaultValue: "等待网页登录完成…",
                  })
                : webLogin.error}
            </p>
          ) : null}
        </section>

        {/* ── 右列：可用模型 + 横向切客户端 ─────────────────────────── */}
        <div className="flex flex-col gap-3.5">
          <section className="rounded-panel border border-hairline bg-surface shadow-sm">
            <h3 className="hairline border-b px-4 py-2.5 text-badge text-fg-3">
              {t("platformConnection.availableModels", {
                defaultValue: "可用模型",
              })}
              <span className="af-num ms-1 text-fg-2">
                {availableModels.length}
              </span>
            </h3>
            {availableModels.length === 0 ? (
              <p className="px-4 py-4 text-caption text-fg-3">
                {configured
                  ? t("platformConnection.modelNone", {
                      defaultValue: "未选择模型",
                    })
                  : t("platformConnection.modelSignedOut", {
                      defaultValue: "登录平台后可选择",
                    })}
              </p>
            ) : (
              <ul>
                {availableModels.map((id) => (
                  <li
                    key={id}
                    className="hairline flex items-baseline gap-2 border-b px-4 py-2 last:border-b-0"
                  >
                    <span
                      className={cn(
                        "af-num min-w-0 flex-1 truncate",
                        id === mainModel ? "text-fg-1" : "text-fg-2",
                      )}
                      title={id}
                    >
                      {id}
                    </span>
                    <span className="shrink-0 text-badge text-fg-3">
                      {vendorByName.get(id) ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {otherApps.length > 0 && (
            <section className="rounded-panel border border-hairline bg-surface shadow-sm">
              <h3 className="hairline border-b px-4 py-2.5 text-badge text-fg-3">
                {t("platformConnection.switchTitle", {
                  defaultValue: "切换到其他客户端",
                })}
              </h3>
              <div className="flex flex-wrap gap-1.5 px-4 py-3">
                {otherApps.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => onOpenApp(item)}
                    className="inline-flex h-6 items-center gap-1.5 rounded-full border border-hairline bg-subtle px-2 text-badge text-fg-2 transition-colors hover:border-hairline-strong hover:text-fg-1 active:translate-y-px"
                  >
                    <AppGlyph app={item} size={13} badgeClassName="bg-subtle" />
                    {APP_DISPLAY_NAME[item]}
                  </button>
                ))}
              </div>
            </section>
          )}
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

/** 规格表的一行：左标签固定宽，右边内容自由排；行之间只用发丝线。 */
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
        "hairline flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 md:flex-nowrap",
        last && "border-b-0",
      )}
    >
      <span className="w-[92px] shrink-0 text-caption text-fg-3">{label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        {children}
      </span>
    </div>
  );
}
