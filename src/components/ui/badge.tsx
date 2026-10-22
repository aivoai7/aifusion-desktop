import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * 状态徽章（Paper & Signal）：18px 高、近方角、发丝描边。
 * 数字与英文走等宽（调用处加 af-num），中文标签保持界面字。
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
 * 语义标记（Paper & Signal）：18px 高、3px 方角，浅底 + 同色文字。
 * 直连是常态，保持中性；只有路由 / 聚合 / 警告才借用色彩。
 * 底色走 index.css 预算好的 *-soft 变量，不用 `/NN` 修饰符。
 */
const chipVariants = cva(
  "inline-flex h-[18px] shrink-0 items-center gap-1.5 rounded-[3px] border border-transparent px-1.5 text-badge font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        ok: "bg-success-soft text-success-text",
        info: "border-hairline bg-surface text-fg-2",
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
