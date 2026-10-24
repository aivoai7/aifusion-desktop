import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { platformKeyApi } from "@/lib/api/platformKey";
import { BrandMark } from "@/components/shell/BrandMark";
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
  windowControls?: ReactNode;
  /** 全局页有未保存的操作时锁住导航 */
  navLocked?: boolean;
}

/**
 * 常驻顶栏（Night Ops）。
 *
 * 左边是字标与两个一级入口（总览、用量），右边是实时钱包与窗口按钮；
 * 当前页的信号是一条 2px 青绿短线并带柔光。页面自己的标题、页签和操作
 * 仍在内容区，顶栏只负责「我在哪、还能去哪、余额多少」。
 */
export function TopBar({
  view,
  overviewActive,
  onHome,
  onOpenPage,
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
        "relative z-30 flex h-[46px] shrink-0 items-stretch gap-3 border-b border-hairline bg-app/95 pe-2 ps-4 supports-[backdrop-filter]:bg-app/80 supports-[backdrop-filter]:backdrop-blur-md",
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
        className="group flex shrink-0 items-center gap-2.5 pe-1 text-start"
        style={NO_DRAG}
      >
        <BrandMark />
        <span className="flex flex-col justify-center">
          <span className="text-[14px] font-semibold leading-[16px] tracking-[-0.02em] text-fg-1">
            AIFusion
          </span>
          <span className="af-kicker text-[8px] leading-[10px] text-fg-3">
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
                "af-nav-mark relative inline-flex shrink-0 items-center px-3 text-[12.5px] transition-colors",
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

      <div className="flex shrink-0 items-center gap-2" style={NO_DRAG}>
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
            className="flex h-[26px] items-center gap-1.5 rounded-full border border-hairline-strong px-2.5"
          >
            <Wallet
              className="h-3 w-3 shrink-0 text-fg-3"
              strokeWidth={1.6}
            />
            <span className="af-num text-[11.5px] leading-none text-fg-1">
              {amount}
            </span>
          </div>
        </HoverTip>

        {windowControls && (
          <div className="flex items-center overflow-hidden rounded-[7px] border border-hairline-strong">
            {windowControls}
          </div>
        )}
      </div>
    </header>
  );
}
