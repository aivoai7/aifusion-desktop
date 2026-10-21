import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * AIFusion · Ink & Grid 按钮。
 *
 * 视觉约定（与上游 cc-switch 的「暖橙 + 按下缩放」区分开）：
 * · 一个视图只允许一个实心按钮（default / solid），其余走 neutral 描边或 quiet 透明。
 * · 圆角固定 6px（rounded-control），描边用发丝线 --hairline / --hairline-strong。
 * · 按下去是 1px 位移（active:translate-y-px），不做缩放回弹——缩放会让相邻
 *   文字和图标一起抖，密集表格里很吵。打开菜单 / 弹层的触发器连位移都不给。
 * · 焦点环只在键盘模态下出现（见 index.css 的 [data-keyboard] 规则）。
 */
const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-body font-medium " +
  "transition-[background-color,color,border-color,transform,box-shadow,filter] duration-150 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-1 " +
  "disabled:pointer-events-none disabled:opacity-45";

/** 实心按钮共有的落影与按下位移 */
const lifted = "shadow-sm active:translate-y-px [&[aria-haspopup]]:active:translate-y-0";

const buttonVariants = cva(base, {
  variants: {
    variant: {
      // azure 实心主操作
      default: `border border-transparent bg-action text-action-fg font-semibold hover:bg-action-hover ${lifted}`,
      destructive: `border border-transparent bg-danger text-white hover:brightness-110 ${lifted}`,
      // 描边：白底 + 发丝强描边，悬停描边提亮、垫弱底
      outline:
        "border border-hairline-strong bg-surface text-fg-1 hover:border-fg-3 hover:bg-subtle",
      secondary: "text-fg-2 hover:bg-subtle hover:text-fg-1",
      ghost: "text-fg-2 hover:bg-subtle hover:text-fg-1",
      mcp: `border border-transparent bg-action text-action-fg font-semibold hover:bg-action-hover ${lifted}`,
      link: "text-action-text underline-offset-4 hover:underline",
      // ── 重做后的三个正式档位：solid / neutral / quiet ──
      solid: `border border-transparent bg-action text-action-fg font-semibold hover:bg-action-hover ${lifted}`,
      neutral:
        "border border-hairline-strong bg-transparent text-fg-1 hover:bg-selected " +
        "disabled:opacity-100 disabled:border-hairline disabled:text-fg-3",
      quiet: "border border-transparent text-fg-1 hover:bg-subtle",
      // 连接形态实心：只在模式切换的主操作上出现
      direct: `border border-transparent bg-direct-solid text-direct-on font-semibold hover:brightness-110 ${lifted}`,
      route: `border border-transparent bg-route-solid text-route-on font-semibold hover:brightness-110 ${lifted}`,
      stack: `border border-transparent bg-stack-solid text-stack-on font-semibold hover:brightness-110 ${lifted}`,
    },
    size: {
      // 三档高度：32（页头、主操作）/ 28（卡片、对话框）/ 36（少数大按钮）；图标按钮同档见方
      default: `h-8 px-3.5 ${lifted}`,
      sm: `h-7 px-3 ${lifted}`,
      lg: `h-9 px-4 ${lifted}`,
      icon: `h-8 w-8 p-0 ${lifted}`,
      compact: `h-7 px-3 text-body ${lifted}`,
      regular: `h-8 px-3.5 text-body ${lifted}`,
      "icon-compact": `h-7 w-7 p-0 text-fg-2 hover:text-fg-1 ${lifted}`,
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
