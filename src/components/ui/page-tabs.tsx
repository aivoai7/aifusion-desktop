import * as React from "react";
import { cn } from "@/lib/utils";
import { TabUnderline, useSlidingIndicator } from "./sliding-indicator";

/**
 * 下划线页签：页面级导航（换的是整块内容，例如用量页的「请求日志 / 供应商 / …」）。
 * 分段控件只留给模式和页内筛选，两者别混用。
 * Ink & Grid 的选中态靠 2px azure 横线 + 一级文字，不加底色，
 * 横线是一块独立的滑块（TabUnderline），切换时从上一项滑过去。
 */
export interface PageTabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface PageTabsProps<T extends string> {
  items: PageTabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  "aria-label": string;
  /** 页签行右侧的附加内容（筛选、操作按钮） */
  trailing?: React.ReactNode;
  /** 给 tab 按钮生成 id，方便 tabpanel 用 aria-labelledby 指回来 */
  idPrefix?: string;
  /** 与 tabpanel 关联时传入 */
  controls?: string;
  /**
   * default：一级页签（36 高、13px，压住整行底线）；
   * sm：一级页签下面的二级页签（32 高、12px，不画整行底线），两层叠起来层级才分得清。
   */
  size?: "default" | "sm";
  className?: string;
}

export function PageTabs<T extends string>({
  items,
  value,
  onValueChange,
  trailing,
  idPrefix,
  controls,
  size = "default",
  className,
  ...rest
}: PageTabsProps<T>) {
  const small = size === "sm";
  const refs = React.useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const enabled = items.filter((item) => !item.disabled);
  const indicator = useSlidingIndicator<HTMLDivElement>(
    '[aria-selected="true"]',
    value,
  );

  // 方向键 / Home / End 在可用页签间循环，焦点跟着一起走（tablist 约定）
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = enabled.findIndex((item) => item.value === value);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % enabled.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = enabled[next].value;
    onValueChange(target);
    refs.current[target]?.focus();
  };

  return (
    <div
      className={cn(
        "flex items-end gap-4",
        small ? "h-8 gap-3" : "hairline-b h-9",
        className,
      )}
    >
      <div
        ref={indicator.ref}
        role="tablist"
        aria-label={rest["aria-label"]}
        className={cn(
          "relative flex h-full items-end",
          small ? "gap-3" : "gap-4",
        )}
      >
        <TabUnderline
          rect={indicator.rect}
          animate={indicator.animate}
          className={small ? undefined : "-bottom-px"}
        />
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              ref={(element) => {
                refs.current[item.value] = element;
              }}
              type="button"
              role="tab"
              id={idPrefix ? `${idPrefix}-${item.value}` : undefined}
              aria-selected={selected}
              aria-controls={controls}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onValueChange(item.value)}
              onKeyDown={onKeyDown}
              className={cn(
                "h-full whitespace-nowrap border-b-2 border-transparent px-0.5 transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:text-fg-3",
                small
                  ? "inline-flex items-center gap-1.5 text-caption"
                  : "-mb-px text-body",
                selected
                  ? "font-semibold text-fg-1"
                  : "font-medium text-fg-2 hover:text-fg-1",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {trailing && (
        <>
          <div className="flex-1" />
          <div className="flex h-full items-center">{trailing}</div>
        </>
      )}
    </div>
  );
}
