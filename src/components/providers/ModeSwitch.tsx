import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppId } from "@/lib/api";
import type { AppMode } from "@/types/proxy";
import { useProxyStatus } from "@/hooks/useProxyStatus";

interface ModeSwitchProps {
  app: AppId;
  /** 当前生效的模式；stack（聚合）时两个胶囊都不高亮。 */
  mode: AppMode;
  /** 平台密钥没下来时不给切：路由的目标就是平台那家。 */
  disabled?: boolean;
}

/**
 * 连接方式切换（直连 / 路由）。
 *
 * 路由 = 客户端配置指向本机路由服务，由它转发到平台网关（带用量记录与故障转移）；
 * 直连 = 客户端配置直接写平台网关地址。进入路由时后端会顺手把路由服务拉起来，
 * 路由目标沿用当前供应商（本构建里就是平台下发的那家），所以不需要再弹确认框。
 *
 * 成功与失败的提示由 `useProxyStatus` 里的 mutation 统一弹，这里只负责按钮态。
 */
export function ModeSwitch({ app, mode, disabled }: ModeSwitchProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { setTakeoverForApp, isPending: isBusy } = useProxyStatus();
  const [pending, setPending] = useState<AppMode | null>(null);

  const options: { value: AppMode; label: string; enabled: boolean }[] = [
    {
      value: "direct",
      label: t("mode.names.direct", { defaultValue: "直连" }),
      enabled: true,
    },
    {
      value: "route",
      label: t("mode.names.route", { defaultValue: "路由" }),
      enabled: true,
    },
  ];

  const pick = async (next: AppMode) => {
    if (next === mode || pending) return;
    setPending(next);
    try {
      await setTakeoverForApp({
        appType: app,
        enabled: next !== "direct",
        stack: false,
      });
    } catch {
      // 失败原因后端已经弹过了，这里只把按钮放回可点状态
    } finally {
      setPending(null);
      queryClient.invalidateQueries({ queryKey: ["providers", app] });
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
    }
  };

  return (
    <div
      role="group"
      aria-label={t("platformConnection.modeSwitchLabel", {
        defaultValue: "切换连接方式",
      })}
      className="inline-flex h-6 shrink-0 items-center gap-[2px] rounded-full border border-hairline bg-subtle p-[2px]"
    >
      {options.map((option) => {
        const active = option.value === mode;
        const loading = pending === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled || !option.enabled || Boolean(pending) || isBusy}
            onClick={() => void pick(option.value)}
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-full px-2 text-badge leading-none transition-colors",
              active
                ? option.value === "route"
                  ? "bg-route-soft text-route-text"
                  : "bg-selected text-fg-1"
                : "text-fg-3 hover:text-fg-1",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
