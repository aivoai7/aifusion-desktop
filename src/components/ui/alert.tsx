import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * 提示块（Ink & Grid）：卡片底 + 发丝描边 + 左侧 2px 强调条。
 * 上游靠整圈彩色描边区分严重级别；这里描边保持中性，级别只走强调条和文字色，
 * 一屏出现多条时不会变成一片彩框。图标绝对定位在左上，正文给它让出 7 个单位。
 */
const alertVariants = cva(
  "relative w-full overflow-hidden rounded-panel border border-hairline bg-surface py-3 ps-9 pe-4 text-body text-fg-1 " +
    "[&>svg]:absolute [&>svg]:start-4 [&>svg]:top-3.5 [&>svg]:h-4 [&>svg]:w-4 " +
    "[&>svg~*]:ps-0 [&>svg+div]:translate-y-[-2px]",
  {
    variants: {
      variant: {
        default: "before:bg-fg-3",
        destructive:
          "text-danger-text before:bg-danger [&>svg]:text-danger [&>h5]:text-danger-text",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    // 强调条是 ::before，变体类（before:bg-*）只换它的颜色
    className={cn(
      "before:absolute before:inset-y-0 before:start-0 before:w-[2px] before:content-['']",
      alertVariants({ variant }),
      className,
    )}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-0.5 text-section leading-tight tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-caption text-fg-2 [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
