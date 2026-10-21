"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * 深色气泡（Ink & Grid）：反色底 + 6px 方角胶囊，只给纯图标按钮报名字。
 * 上游用的是大圆角 pill；这里跟着控件圆角走，气泡和它指着的按钮是同一种形状。
 * 最大宽度 260，超出换行；淡入 100ms，不做位移。
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        "z-[130] max-w-[260px] select-none rounded-control bg-inverse px-2.5 py-1.5",
        "text-caption font-medium leading-snug text-inverse-fg shadow-md",
        "duration-100 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0",
        "data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
