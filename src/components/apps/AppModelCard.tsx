import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { AppId } from "@/lib/api";
import { platformKeyApi } from "@/lib/api/platformKey";
import type { PlatformModelConfig } from "@/lib/api/platformKey";
import { isModeAppId } from "@/config/appConfig";
import { Chip } from "@/components/ui/badge";
import { AppGlyph, APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";

/** 一个客户端在总览/切换网格里要展示的模型摘要。 */
export interface AppModelRow {
  app: AppId;
  config: PlatformModelConfig | undefined;
  loading: boolean;
}

/**
 * 一次读多个客户端的平台模型配置。
 *
 * 缓存键与详情页的模型行完全一致（`["platformModelConfig", app]`），
 * 所以首页和详情页共用同一份数据，来回切页不会重复请求。
 */
export function useAppModelRows(
  apps: AppId[],
  enabled: boolean,
): AppModelRow[] {
  const queries = useQueries({
    queries: apps.map((app) => ({
      queryKey: ["platformModelConfig", app],
      queryFn: () => platformKeyApi.modelConfig(app),
      enabled,
      staleTime: 15_000,
    })),
  });

  return apps.map((app, index) => ({
    app,
    config: queries[index]?.data,
    loading: enabled && queries[index]?.isPending === true,
  }));
}

/** 连接方式 → 语义胶囊：直连走 azure，路由走青，聚合走紫。 */
function modeChip(app: AppId, mode: "direct" | "route" | "stack") {
  if (mode === "stack") {
    return {
      tone: "stack" as const,
      textKey: "mode.names.stack",
      textDefault: "聚合",
    };
  }
  if (mode === "route") {
    return {
      tone: "route" as const,
      textKey: isModeAppId(app) ? "nav.mode.route" : "home.localConvert",
      textDefault: isModeAppId(app) ? "路由" : "本地转换",
    };
  }
  return {
    tone: "info" as const,
    textKey: "mode.names.direct",
    textDefault: "直连",
  };
}

/**
 * 单个客户端卡片（Ink & Grid 九宫格里的一格）。
 *
 * 三行结构：字块 + 名字、两行 `dt/dd` 模型摘要、底部连接方式胶囊；
 * 悬停时左侧长出 2px azure 强调条，正在看的那一张常驻。没有光晕和玻璃底。
 */
export function AppModelCard({
  row,
  signedIn,
  active,
  alert,
  mode,
  onOpen,
}: {
  row: AppModelRow;
  signedIn: boolean;
  active: boolean;
  alert: boolean;
  mode: "direct" | "route" | "stack";
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const config = row.config;
  const label = APP_DISPLAY_NAME[row.app];

  const lines = (() => {
    if (!row.loading && !config) {
      return [
        {
          tag: t("home.modelTag", { defaultValue: "模型" }),
          value: t("home.notAvailable", { defaultValue: "暂无数据" }),
        },
      ];
    }
    if (!config) {
      return [
        {
          tag: t("home.modelTag", { defaultValue: "模型" }),
          value: t("platformConnection.modelLoading", {
            defaultValue: "读取中…",
          }),
        },
      ];
    }
    if (config.supportsList) {
      return [
        {
          tag: t("home.modelTag", { defaultValue: "模型" }),
          value:
            config.models.length > 0
              ? t("platformConnection.modelCount", {
                  count: config.models.length,
                  defaultValue: "{{count}} 个模型",
                })
              : t("platformConnection.modelNone", {
                  defaultValue: "未选择模型",
                }),
        },
        {
          tag: t("home.firstModelTag", { defaultValue: "首个" }),
          value: config.models[0] ?? "—",
        },
      ];
    }
    const main = [
      {
        tag: t("home.mainModelTag", { defaultValue: "主模型" }),
        value: config.defaultModel ?? "—",
      },
    ];
    if (config.supportsLight) {
      main.push({
        tag: t("home.lightModelTag", { defaultValue: "轻量" }),
        value:
          config.lightModel ??
          t("home.sameAsMain", { defaultValue: "同主模型" }),
      });
    }
    return main;
  })();

  const chip = modeChip(row.app, mode);
  const needsAttention = alert;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-active={active}
      aria-current={active ? "true" : undefined}
      className={cn(
        "af-accent-rail group flex flex-col rounded-panel border bg-surface px-3.5 py-3 text-start transition-colors",
        "hover:border-hairline-strong hover:bg-subtle",
        active ? "border-hairline-strong" : "border-hairline",
      )}
    >
      <h3 className="mb-2.5 flex min-w-0 items-center gap-1.5 text-body font-medium text-fg-1">
        <AppGlyph app={row.app} size={16} badgeClassName="bg-surface" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && (
          <Chip tone="accent">
            {t("home.viewingNow", { defaultValue: "正在看" })}
          </Chip>
        )}
      </h3>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-[3px]">
        {lines.map((line) => (
          <div key={line.tag} className="contents">
            <dt className="text-badge text-fg-3">{line.tag}</dt>
            <dd
              className="af-num truncate text-badge text-fg-2"
              title={line.value}
            >
              {line.value}
            </dd>
          </div>
        ))}
      </dl>

      <footer className="mt-2.5 flex min-w-0 items-center gap-1.5">
        <Chip tone={chip.tone}>
          {t(chip.textKey, { defaultValue: chip.textDefault })}
        </Chip>
        {needsAttention && (
          <Chip tone="warn">
            {t("nav.needsAttention", { defaultValue: "需要处理" })}
          </Chip>
        )}
        {signedIn && config && !config.connected && !needsAttention && (
          <Chip tone="mute">
            {t("platformConnection.appLocal", { defaultValue: "本机配置" })}
          </Chip>
        )}
        <span className="ms-auto shrink-0 text-badge text-fg-3 group-hover:text-action-text">
          {t("home.openDetail", { defaultValue: "配置详情 →" })}
        </span>
      </footer>
    </button>
  );
}
