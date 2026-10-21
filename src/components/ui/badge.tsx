import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * 状态徽章（Ink & Grid）：小方块胶囊，18px 高、圆角 5、发丝描边。
 * 数字与英文走等宽（调用处加 af-num），中文标签保持界面字。
 * 上游用的是圆形大胶囊 + 透明度悬停；这里改成贴合网格的方角，颜色由调用处的
 * tone 类（text-success / bg-success-soft …）决定，变体只兜底四种语义。
 */
const badgeVariants = cva(
  "inline-flex h-[18px] items-center gap-1 rounded-[5px] border px-1.5 text-badge font-medium leading-none whitespace-nowrap transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-hairline bg-subtle text-fg-2",
        destructive: "border-transparent bg-danger text-white",
        outline: "border-hairline-strong bg-transparent text-fg-1",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

/**
 * 语义胶囊（Ink & Grid）：20px 高、圆角 99、同色浅底 + 同色文字，无描边。
 * 用于「已连接 / 直连 / 可升级 / 未配置」这类状态标记，颜色只由 tone 决定，
 * 调用处不要再叠加底色类。底色走 index.css 预算好的 *-soft 变量，
 * 不用 `/NN` 透明度修饰符（纯 var() 颜色不支持）。
 */
const chipVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2 text-badge font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        ok: "bg-success-soft text-success-text",
        info: "bg-direct-soft text-direct-text",
        route: "bg-route-soft text-route-text",
        stack: "bg-stack-soft text-stack-text",
        warn: "bg-warning-soft text-warning-text",
        danger: "bg-danger-soft text-danger-text",
        accent: "bg-action-soft text-action-text",
        mute: "border-hairline bg-subtle text-fg-3",
      },
    },
    defaultVariants: { tone: "mute" },
  },
);

const CHIP_DOT: Record<string, string> = {
  ok: "bg-success",
  info: "bg-direct",
  route: "bg-route",
  stack: "bg-stack",
  warn: "bg-warning",
  danger: "bg-danger",
  accent: "bg-action",
  mute: "bg-fg-3",
};

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  /** 前面带一个 5px 语义色圆点 */
  dot?: boolean;
}

function Chip({ className, tone, dot, children, ...props }: ChipProps) {
  return (
    <span className={cn(chipVariants({ tone }), className)} {...props}>
      {dot && (
        <span
          aria-hidden
          className={cn(
            "h-[5px] w-[5px] shrink-0 rounded-full",
            CHIP_DOT[tone ?? "mute"],
          )}
        />
      )}
      {children}
    </span>
  );
}

export { Badge, badgeVariants, Chip, chipVariants };
