import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Settings, Wallet } from "lucide-react";
import afLogo from "@/assets/icons/logo.png";
import { platformKeyApi } from "@/lib/api/platformKey";
import { Button } from "@/components/ui/button";
import { HoverTip } from "@/components/ui/hover-tip";
import { DRAG_REGION_ATTR, DRAG_REGION_STYLE, isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { GlobalPage, View } from "@/lib/navigation";

const NAV_ITEMS: Array<{
  page: GlobalPage | "home";
  labelKey: string;
  fallback: string;
}> = [
  { page: "home", labelKey: "nav.overview", fallback: "总览" },
  { page: "usage", labelKey: "nav.usage", fallback: "用量" },
];

const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

interface TopBarProps {
  view: View;
  /** 当前视图是否属于总览（首页与客户端详情都算） */
  overviewActive: boolean;
  onHome: () => void;
  onOpenPage: (page: GlobalPage) => void;
  onOpenSettings: () => void;
  settingsActive: boolean;
  hasUpdate?: boolean;
  windowControls?: ReactNode;
  /** 全局页有未保存的操作时锁住导航 */
  navLocked?: boolean;
}

/**
 * 常驻顶栏（Paper & Signal 的唯一全局外壳）。
 *
 * 左边是平台字标与两个一级入口（总览、用量），右边是实时钱包、设置与窗口按钮；
 * 当前页的信号是一条 2px 电光蓝短线，不做整格底色。页面自己的标题、
 * 页签和操作仍在内容区，顶栏只负责「我在哪、还能去哪、余额多少」。
 */
export function TopBar({
  view,
  overviewActive,
  onHome,
  onOpenPage,
  onOpenSettings,
  settingsActive,
  hasUpdate = false,
  windowControls,
  navLocked = false,
}: TopBarProps) {
  const { t } = useTranslation();
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

  const currentPage =
    view === "skillsDiscovery" ? "skills" : view === "home" ? "home" : view;
  const isActive = (page: (typeof NAV_ITEMS)[number]["page"]) =>
    page === "home" ? overviewActive : currentPage === page;

  return (
    <header
      className={cn(
        "relative z-30 flex h-[52px] shrink-0 items-stretch gap-2 border-b border-hairline bg-app/95 pe-2 ps-4 supports-[backdrop-filter]:bg-app/85 supports-[backdrop-filter]:backdrop-blur-sm",
        isMac() && "ps-[76px]",
      )}
      {...DRAG_REGION_ATTR}
      style={DRAG_REGION_STYLE as React.CSSProperties}
    >
      {/* 平台字标：任何一页点它都回总览 */}
      <a
        href="#main-content"
        className="fixed start-2 top-2 z-50 -translate-y-14 rounded-control bg-surface px-2 py-1 text-caption shadow-md focus-visible:translate-y-0"
      >
        {t("nav.skipToContent", { defaultValue: "跳到主要内容" })}
      </a>
      <button
        type="button"
        onClick={onHome}
        aria-current={overviewActive ? "page" : undefined}
        className="group flex shrink-0 items-center gap-2.5 pe-5 text-start"
        style={NO_DRAG}
      >
        <img
          src={afLogo}
          alt=""
          draggable={false}
          className="h-[21px] w-auto shrink-0"
        />
        <span className="flex flex-col justify-center">
          <span className="text-[14px] font-semibold leading-[16px] tracking-[-0.02em] text-fg-1">
            AIFusion
          </span>
          <span className="af-kicker text-[8.5px] leading-[11px] text-fg-3">
            Platform console
          </span>
        </span>
      </button>

      <span aria-hidden="true" className="my-auto h-5 w-px bg-hairline" />

      {/* 一级导航：文本 + 底部信号线，没有图标，像一列章节 */}
      <nav
        aria-label={t("nav.mainLabel", { defaultValue: "主导航" })}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar"
        style={NO_DRAG}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.page);
          return (
            <button
              key={item.page}
              type="button"
              disabled={navLocked}
              aria-current={active ? "page" : undefined}
              onClick={() =>
                item.page === "home" ? onHome() : onOpenPage(item.page)
              }
              className={cn(
                "af-nav-mark relative inline-flex shrink-0 items-center px-3.5 text-caption transition-colors",
                active
                  ? "font-semibold text-fg-1"
                  : "text-fg-2 hover:text-fg-1",
                navLocked && "cursor-not-allowed opacity-45",
              )}
              data-active={active}
            >
              {t(item.labelKey, { defaultValue: item.fallback })}
            </button>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-1.5" style={NO_DRAG}>
        <HoverTip
          content={t("nav.walletHint", {
            defaultValue:
              "用本机保存的平台密钥实时查询美元钱包余额，每分钟刷新一次",
          })}
          side="bottom"
          disableHoverableContent
        >
          <div
            role="img"
            aria-label={`${t("nav.walletBalance", { defaultValue: "钱包余额" })} ${amount}`}
            className="flex h-8 items-center gap-2 rounded-control border border-hairline px-2.5"
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
              ? t("nav.settingsHasUpdate", {
                  defaultValue: "设置 · AIFusion 有新版本",
                })
              : t("nav.settings", { defaultValue: "设置" })
          }
          side="bottom"
          disableHoverableContent
        >
          <Button
            variant="quiet"
            size="icon-compact"
            onClick={onOpenSettings}
            aria-label={t("nav.settings", { defaultValue: "设置" })}
            aria-current={settingsActive ? "page" : undefined}
            className={cn(
              "relative h-8 w-8",
              settingsActive && "bg-selected text-fg-1 hover:bg-selected",
            )}
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} />
            {hasUpdate && (
              <span
                aria-hidden="true"
                className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-action-text"
              />
            )}
          </Button>
        </HoverTip>

        {windowControls && (
          <div className="ms-0.5 flex items-center border-s border-hairline ps-1.5">
            {windowControls}
          </div>
        )}
      </div>
    </header>
  );
}
