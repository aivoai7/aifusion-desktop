import { createContext, useContext, type ReactNode } from "react";
import { DRAG_REGION_ATTR, DRAG_REGION_STYLE } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** 由外壳提供：Linux 自绘窗口按钮要接在每一屏页头的最右端。 */
export const WindowControlsContext = createContext<ReactNode>(null);

/**
 * 由外壳提供的常驻页头部件（去掉侧栏之后，页头就是唯一的全局外壳）：
 * · brand 坐在最左端，点它回首页总览——首页是唯一的入口，页头必须自带回程；
 * · actions 排在页面自己的操作之后、窗口按钮之前，余额与设置齿轮在任何一页都在。
 */
export interface HeaderChrome {
  brand?: ReactNode;
  actions?: ReactNode;
}

export const HeaderChromeContext = createContext<HeaderChrome>({});

const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

interface AppPageHeaderProps {
  /** 标题前的可操作元素（二级页的返回按钮）；和 icon 二选一 */
  leading?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  /** 应用页用 15px 的名字 + 13px 的页面名；全局页和设置用 19px 的页面标题 */
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
   * 覆盖整块内容区的二级面板（全屏编辑器、抽屉）：不挂外壳的品牌与常驻操作。
   * 它们自带返回按钮，再挂一份「回首页」只会多出一个回程和两条重复的余额、齿轮。
   */
  bare?: boolean;
  className?: string;
}

/**
 * 内容区页头（Ink & Grid）：高 48，整条可拖动窗口，底部一条发丝线和内容区分层。
 * 标题靠字号与负字距分层，不加分隔线、不加底色。
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
  const { brand: shellBrand, actions: shellActions } =
    useContext(HeaderChromeContext);
  const brand = bare ? null : shellBrand;
  const globalActions = bare ? null : shellActions;

  return (
    <header
      className={cn(
        "hairline-b flex h-12 shrink-0 items-center gap-4 pe-4 ps-5",
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
        {brand && (
          <span className="flex shrink-0 items-center" style={NO_DRAG}>
            {brand}
          </span>
        )}
        {brand && (
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 self-center bg-hairline"
          />
        )}
        {leading && (
          <span className="-ms-1.5 flex shrink-0 items-center" style={NO_DRAG}>
            {leading}
          </span>
        )}
        {icon && (
          <span
            aria-hidden="true"
            className="pointer-events-none flex h-[22px] w-[22px] shrink-0 items-center justify-center text-fg-1"
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
              <span className="whitespace-nowrap text-body text-fg-3">
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
      {globalActions && (
        <div className="flex shrink-0 items-center gap-2" style={NO_DRAG}>
          {globalActions}
        </div>
      )}
      {windowControls && (
        <div className="flex shrink-0 items-center gap-0.5" style={NO_DRAG}>
          {windowControls}
        </div>
      )}
    </header>
  );
}
