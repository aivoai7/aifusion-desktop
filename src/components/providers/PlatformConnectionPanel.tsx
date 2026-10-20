import { useTranslation } from "react-i18next";
import {
  ArrowUpCircle,
  BookOpen,
  ChartColumn,
  History,
  KeyRound,
  Loader2,
  LogIn,
  RefreshCw,
  Route,
  Server,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import ccswitchLogo from "@/assets/icons/logo.png";
import { Button } from "@/components/ui/button";
import { SkillsIcon } from "@/components/BrandIcons";
import { cn } from "@/lib/utils";
import type { GlobalPage } from "@/lib/navigation";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import { usePlatformKeyStatusQuery } from "@/lib/query";
import { useAppMode, useProxyStatusQuery } from "@/lib/query/proxy";
import {
  isAdditiveAppId,
  isModeAppId,
  isProxyAppId,
  getAppLabel,
} from "@/config/appConfig";
import { ToolUpgradeConfirmDialog } from "@/components/settings/ToolUpgradeConfirmDialog";
import {
  toolDisplayName,
  useToolManagement,
} from "@/components/apps/useToolManagement";
import { usePlatformWebLogin } from "@/hooks/usePlatformWebLogin";

interface PlatformConnectionPanelProps {
  app: AppId;
  /** 该应用已有的供应商，用来判断平台条目是否已下发到本机配置。 */
  providers: Record<string, Provider>;
  /** 切换型应用的当前供应商；additive 应用没有这个概念，通常为空。 */
  currentProviderId: string;
  onOpenKeySettings: () => void;
  /** 打开 MCP / Skills / 提示词 / 会话 / 用量统计等全局页。 */
  onOpenPage: (page: GlobalPage) => void;
}

function isPlatformProvider(provider: Provider): boolean {
  // 平台的供应商条目以 `*-official` 结尾（历史库里也可能叫 AIFusion）
  return (
    provider.id.endsWith("-official") ||
    provider.name.toLowerCase().includes("aifusion")
  );
}

/**
 * 应用页的平台连接状态。
 *
 * 这个构建只对接 AIFusion 自有平台：供应商 / 渠道由平台统一下发，
 * 不在客户端里展示，也不提供手动添加。这里只告诉用户平台地址、密钥
 * 和各客户端当前的连接方式。
 */
export function PlatformConnectionPanel({
  app,
  providers,
  currentProviderId,
  onOpenKeySettings,
  onOpenPage,
}: PlatformConnectionPanelProps) {
  const { t } = useTranslation();
  const { data: keyStatus, isLoading } = usePlatformKeyStatusQuery();
  const webLogin = usePlatformWebLogin();
  const modeApp = isModeAppId(app);
  const { data: modeView } = useAppMode(app, modeApp);
  const { data: proxyStatus } = useProxyStatusQuery();
  // 应用更新放在平台连接里：侧栏不再单独给「应用」入口。
  const tools = useToolManagement();
  const updatableCount = tools.updatableToolNames.length;

  const configured = keyStatus?.configured === true;
  // additive 应用（OpenCode / OpenClaw / Hermes / Pi / Mcode）没有「当前供应商」，
  // 只要平台条目已经下发到库里就算已接入；其余应用看当前选中的那一条。
  const platformProvider = isAdditiveAppId(app)
    ? Object.values(providers).some(isPlatformProvider)
    : currentProviderId !== "" &&
      providers[currentProviderId] != null &&
      isPlatformProvider(providers[currentProviderId]);

  const mode = modeApp ? (modeView?.mode ?? "direct") : null;
  const routed = mode === "route" || mode === "stack";
  const proxyRunning = proxyStatus?.running === true;

  const modeLabel =
    mode === "stack"
      ? t("mode.names.stack", { defaultValue: "聚合" })
      : mode === "route"
        ? t("mode.names.route", { defaultValue: "路由" })
        : t("mode.names.direct", { defaultValue: "直连" });

  // 侧栏只留应用，MCP / Skills / 提示词 / 会话 / 用量统计统一收进平台连接。
  const quickPages = [
    {
      page: "mcp" as const,
      label: "MCP",
      icon: <Server className="h-3.5 w-3.5" />,
    },
    {
      page: "skills" as const,
      label: "Skills",
      icon: <SkillsIcon size={14} />,
    },
    {
      page: "prompts" as const,
      label: t("nav.prompts", { defaultValue: "提示词" }),
      icon: <BookOpen className="h-3.5 w-3.5" />,
    },
    {
      page: "sessions" as const,
      label: t("nav.sessions", { defaultValue: "会话" }),
      icon: <History className="h-3.5 w-3.5" />,
    },
    {
      page: "usage" as const,
      label: t("nav.usage", { defaultValue: "用量统计" }),
      icon: <ChartColumn className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <>
      <div className="relative overflow-hidden rounded-[20px] border border-border bg-surface shadow-v7-sm">
        {/* 顶部暖色光晕：借鉴 TEAMO 的大圆角深色卡片，信息结构不变 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40"
          style={{
            background:
              "radial-gradient(120% 170% at 84% -45%, color-mix(in srgb, var(--action-bg) 30%, transparent) 0%, transparent 60%), radial-gradient(80% 130% at 2% -35%, color-mix(in srgb, var(--direct-fill) 16%, transparent) 0%, transparent 62%)",
          }}
        />
        <div className="relative flex items-start gap-3.5 px-6 pb-5 pt-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-v7-sm ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
            <img
              src={ccswitchLogo}
              alt=""
              draggable={false}
              className="h-7 w-auto"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-title tracking-tight text-fg-1">
                {t("platformConnection.title", {
                  defaultValue: "AIFusion 平台",
                })}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-badge font-medium backdrop-blur-sm",
                  configured
                    ? "border-green-500/25 bg-green-500/10 text-green-600 dark:text-green-400"
                    : "border-orange-500/25 bg-orange-500/10 text-orange-600 dark:text-orange-400",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    configured
                      ? "bg-green-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
                      : "bg-orange-500 shadow-[0_0_0_3px_rgba(249,115,22,0.15)]",
                  )}
                />
                {isLoading
                  ? t("platformKey.loading", { defaultValue: "读取中…" })
                  : configured
                    ? t("platformConnection.connected", {
                        defaultValue: "已连接",
                      })
                    : t("platformConnection.disconnected", {
                        defaultValue: "未连接平台",
                      })}
              </span>
            </div>
          </div>
          {configured ? (
            <Button
              variant="neutral"
              size="compact"
              className="shrink-0 rounded-full border-border-strong/80 bg-surface/70 px-3.5 backdrop-blur-sm"
              onClick={onOpenKeySettings}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {t("platformConnection.manageKey", {
                defaultValue: "管理连接",
              })}
            </Button>
          ) : (
            <Button
              size="compact"
              className="shrink-0 rounded-full px-3.5"
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
                ? t("platformKey.cancelWaiting", {
                    defaultValue: "取消等待",
                  })
                : t("platformConnection.signIn", { defaultValue: "登录平台" })}
            </Button>
          )}
        </div>

        <dl className="relative mt-1 grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 border-t border-border/70 px-6 py-5 text-body">
          <dt className="text-fg-3">
            {t("platformConnection.appLabel", { defaultValue: "客户端" })}
          </dt>
          <dd className="text-fg-1">
            {getAppLabel(app)} ·{" "}
            {platformProvider
              ? t("platformConnection.appConnected", {
                  defaultValue: "已接入平台",
                })
              : t("platformConnection.appLocal", {
                  defaultValue: "使用本机配置",
                })}
          </dd>

          {modeApp && (
            <>
              <dt className="text-fg-3">
                {t("platformConnection.modeLabel", {
                  defaultValue: "连接方式",
                })}
              </dt>
              <dd className="flex flex-wrap items-center gap-2 text-fg-1">
                <span className="inline-flex items-center gap-1">
                  <Route className="h-3.5 w-3.5 text-fg-3" />
                  {modeLabel}
                </span>
                {routed && isProxyAppId(app) && (
                  <span
                    className={cn(
                      "text-fg-3",
                      !proxyRunning && "text-warning-text",
                    )}
                  >
                    {proxyRunning
                      ? t("platformConnection.proxyRunning", {
                          defaultValue: "路由服务运行中",
                        })
                      : t("platformConnection.proxyStopped", {
                          defaultValue: "路由服务未启动",
                        })}
                  </span>
                )}
              </dd>
            </>
          )}
          <dt className="text-fg-3">
            {t("platformConnection.appUpdates", { defaultValue: "应用更新" })}
          </dt>
          <dd className="flex flex-wrap items-center gap-2 text-fg-1">
            <span
              className={cn(
                updatableCount > 0 ? "text-warning-text" : "text-fg-2",
              )}
            >
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
            </span>
            <Button
              variant="quiet"
              size="compact"
              className="rounded-full"
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
                className="rounded-full"
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
          </dd>
        </dl>

      <div className="relative flex flex-wrap items-center gap-2 border-t border-border/70 px-6 py-3.5">
        <span className="me-1 text-caption text-fg-3">
          {t("platformConnection.toolsLabel", { defaultValue: "更多功能" })}
        </span>
        {quickPages.map(({ page, label, icon }) => (
          <Button
            key={page}
            variant="neutral"
            size="compact"
            className="rounded-full border-border/80 bg-surface/60 px-3 backdrop-blur-sm"
            onClick={() => onOpenPage(page)}
          >
            {icon}
            {label}
          </Button>
        ))}
      </div>

      <div className="relative flex items-start gap-2.5 border-t border-border/70 bg-subtle/40 px-6 py-4 text-caption text-fg-2">
        {configured ? (
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-3" />
        ) : (
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text" />
        )}
        <p
          className={cn(
            "leading-relaxed",
            webLogin.error && "text-danger",
          )}
        >
          {webLogin.busy
            ? t("platformKey.webLoginWaiting", {
                defaultValue: "等待网页登录完成…",
              })
            : webLogin.error ||
              t("platformConnection.hint", {
                defaultValue:
                  "供应商与渠道由 AIFusion 平台统一管理，客户端无需手动配置。登录平台后会自动完成授权并下发。",
              })}
        </p>
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
