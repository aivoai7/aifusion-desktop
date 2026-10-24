import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 全局页的报头（Paper & Signal）。
 *
 * 与首页同一套排版：英文 kicker、28px 标题、灰色说明、右侧操作。
 * 页头本身占满宽度画底线，内容宽度收敛到 1160，和首页、设置对齐。
 * 页面自己的滚动区在下面，报头不参与滚动。
 */
export function PageMasthead({
  kicker,
  title,
  subtitle,
  titleExtra,
  actions,
  children,
  className,
}: {
  /** 等宽大写小字，例如 Usage / MCP / Skills */
  kicker: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** 标题旁的帮助按钮或状态 */
  titleExtra?: ReactNode;
  actions?: ReactNode;
  /** 报头下面、同一宽度里的筛选行或页签 */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn("shrink-0 border-b border-hairline", className)}
    >
      <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-end justify-between gap-x-8 gap-y-4 px-8 pb-5 pt-6">
        <div className="min-w-0">
          <div className="af-kicker flex items-center gap-2">
            <span aria-hidden="true" className="af-kicker-dot" />
            {kicker}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-display text-fg-1">{title}</h1>
            {titleExtra}
          </div>
          {subtitle && (
            <p className="mt-1.5 max-w-2xl text-body text-fg-2">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children && (
        <div className="mx-auto w-full max-w-[1160px] px-8">{children}</div>
      )}
    </header>
  );
}
