import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Settings, Wallet } from "lucide-react";
import afLogo from "@/assets/icons/logo.png";
import { platformKeyApi } from "@/lib/api/platformKey";
import { Button } from "@/components/ui/button";
import { HoverTip } from "@/components/ui/hover-tip";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * 页头外壳的两块常驻部件（v9：侧栏去掉了，页头是全局导航的唯一外壳）。
 *
 * 品牌块坐最左，点它回首页总览——首页是客户端的唯一入口，所以回程必须在任何
 * 一页都在手边；余额与设置齿轮靠右，排在页面自己的操作之后、窗口按钮之前。
 */

interface HeaderBrandProps {
  onHome: () => void;
  /** 当前就在首页：仍是一个按钮（再点不离开），但标出 aria-current */
  active?: boolean;
}

export function HeaderBrand({ onHome, active = false }: HeaderBrandProps) {
  const { t } = useTranslation();
  const label = t("nav.home", { defaultValue: "首页总览" });
  const tip = t("header.backHome", { defaultValue: "回首页总览" });

  return (
    <>
      {/* 页头成了唯一的导航，键盘用户要能一步跳到正文 */}
      <a
        href="#main-content"
        className="fixed start-2 top-2 z-50 -translate-y-14 rounded-control bg-surface px-2 py-1 text-caption shadow-md focus-visible:translate-y-0"
      >
        {t("nav.skipToContent")}
      </a>
      <button
        type="button"
        onClick={onHome}
        aria-label={label}
        title={tip}
        aria-current={active ? "page" : undefined}
        className={cn(
          "-ms-1.5 flex shrink-0 items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-subtle",
          // macOS 的红绿灯占着窗口左上角，品牌块要让开约 76px
          isMac() && "ms-[76px]",
        )}
      >
        <img
          src={afLogo}
          alt=""
          draggable={false}
          className="pointer-events-none h-[18px] w-auto shrink-0"
        />
        <span className="pointer-events-none text-body font-semibold tracking-tight text-fg-1">
          AIFusion
        </span>
      </button>
    </>
  );
}

interface GlobalHeaderActionsProps {
  onOpenSettings: () => void;
  /** 当前在设置页：齿轮按下去高亮，再点回原来那页 */
  settingsActive?: boolean;
  /** 有新版本：齿轮挂一个小绿点（原来在侧栏「关于」上） */
  hasUpdate?: boolean;
}

/**
 * 页头右端的余额与设置。
 *
 * 余额用本机保存的平台 Key 走网关取真实美元数，每分钟刷新一次；没登录或平台
 * 没有这个接口时留 $— 占位，不显示 0、也不显示估算值。
 */
export function GlobalHeaderActions({
  onOpenSettings,
  settingsActive = false,
  hasUpdate = false,
}: GlobalHeaderActionsProps) {
  const { t } = useTranslation();
  const label = t("nav.walletBalance", { defaultValue: "钱包余额" });
  const { data: balance } = useQuery({
    queryKey: ["platformWalletBalance"],
    queryFn: () => platformKeyApi.walletBalance(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const amount =
    typeof balance === "number" && Number.isFinite(balance)
      ? `$${balance.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "$—";

  return (
    <>
      <HoverTip
        content={`${label} · ${t("home.walletHint", {
          defaultValue: "实时读取平台钱包",
        })}`}
        side="bottom"
        disableHoverableContent
      >
        <div
          role="img"
          aria-label={`${label} ${amount}`}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-subtle px-2.5"
        >
          <Wallet
            className="h-3.5 w-3.5 shrink-0 text-fg-3"
            strokeWidth={1.5}
          />
          <span className="af-num text-caption leading-none text-fg-1">
            {amount}
          </span>
        </div>
      </HoverTip>
      <HoverTip
        content={
          hasUpdate
            ? t("nav.settingsHasUpdate", { defaultValue: "有新版本" })
            : t("nav.settings")
        }
        side="bottom"
        disableHoverableContent
      >
        <Button
          variant="quiet"
          size="icon-compact"
          onClick={onOpenSettings}
          aria-label={t("nav.settings")}
          aria-current={settingsActive ? "page" : undefined}
          className={cn(
            "relative",
            settingsActive && "bg-selected text-fg-1 hover:bg-selected",
          )}
        >
          <Settings className="h-4 w-4" strokeWidth={1.5} />
          {hasUpdate && (
            <span
              aria-hidden="true"
              className="absolute end-0 top-0 h-2 w-2 rounded-full border-2 border-app bg-success"
            />
          )}
        </Button>
      </HoverTip>
    </>
  );
}
