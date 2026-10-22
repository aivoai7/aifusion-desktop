import { createContext, useContext, type ReactNode } from "react";
import { DRAG_REGION_ATTR, DRAG_REGION_STYLE } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** 由外壳提供：整页面板盖住顶栏时，窗口按钮要接在面板页头的最右端。 */
export const WindowControlsContext = createContext<ReactNode>(null);

const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

interface AppPageHeaderProps {
  /** 标题前的可操作元素（二级页的返回按钮）；和 icon 二选一 */
  leading?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  /** 应用页用 16px 的名字 + 13px 的页面名；全局页和设置用 22px 的页面标题 */
  variant?: "app" | "page";
  /** 应用页的页面名（如「供应商」），灰字跟在应用名后面 */
  subtitle?: ReactNode;
  /** 标题后面的「?」、徽标、计数等 */
  titleExtra?: ReactNode;
  /** 右侧操作区：主按钮放最后一个、⋯ 放它后面 */
  actions?: ReactNode;
  /** 标题可能很长（如会话阅读页的会话名）：标题占满剩余宽度，放不下就截断 */
  truncateTitle?: boolean;
  /**
   * 覆盖整块内容区的二级面板（全屏编辑器、抽屉）：额外挂窗口按钮。
   * 常驻品牌、余额、设置与一级导航都在顶栏，这里不再重复。
   */
  bare?: boolean;
  className?: string;
}

/**
 * 内容区页头（Paper & Signal）：整条可拖动窗口，底部一条标尺线与内容分层。
 * 顶栏是唯一全局外壳；这里只回答「当前在哪一页」，并承载页面自己的操作。
 */
export function AppPageHeader({
  leading,
  icon,
  title,
  variant = "page",
  subtitle,
  titleExtra,
  actions,
  truncateTitle = false,
  bare = false,
  className,
}: AppPageHeaderProps) {
  const windowControls = useContext(WindowControlsContext);

  return (
    <header
      className={cn(
        "hairline-b flex shrink-0 items-center gap-4 pe-4 ps-6",
        variant === "page" ? "h-[60px]" : "h-12",
        className,
      )}
      {...DRAG_REGION_ATTR}
      style={DRAG_REGION_STYLE as React.CSSProperties}
    >
      {/* Tauri 只认按下的元素自身带拖动属性：标题区、标题、占位条都要带，整条才能拖窗口 */}
      <div
        {...DRAG_REGION_ATTR}
        className={cn(
          "flex min-w-0 items-center gap-2.5",
          truncateTitle ? "flex-1" : "shrink-0",
        )}
      >
        {leading && (
          <span className="-ms-2 flex shrink-0 items-center" style={NO_DRAG}>
            {leading}
          </span>
        )}
        {icon && (
          <span
            aria-hidden="true"
            className="pointer-events-none flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-hairline bg-surface text-fg-1"
          >
            {icon}
          </span>
        )}
        <h1
          {...DRAG_REGION_ATTR}
          className={cn(
            "m-0 whitespace-nowrap",
            variant === "app" ? "text-title text-fg-1" : "text-page text-fg-1",
            truncateTitle && "min-w-0 truncate",
          )}
        >
          {title}
        </h1>
        {(subtitle || titleExtra) && (
          <div className="flex items-center gap-1.5" style={NO_DRAG}>
            {subtitle && (
              <span className="whitespace-nowrap text-caption text-fg-3">
                {subtitle}
              </span>
            )}
            {titleExtra}
          </div>
        )}
      </div>
      {!truncateTitle && <div {...DRAG_REGION_ATTR} className="flex-1" />}
      {actions && (
        <div
          className="flex min-w-0 shrink items-center justify-end gap-2"
          style={NO_DRAG}
        >
          {actions}
        </div>
      )}
      {bare && windowControls && (
        <div className="flex shrink-0 items-center gap-0.5" style={NO_DRAG}>
          {windowControls}
        </div>
      )}
    </header>
  );
}
