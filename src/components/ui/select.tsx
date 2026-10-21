import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";

/**
 * 下拉选择（Ink & Grid）：触发器和输入框同一套外观（fieldClass，高 32 / 圆角 6 /
 * 发丝描边），展开时保持聚焦态；列表是 10px 圆角 + af-pop 的浮层，
 * 选项高 28、圆角 6，选中项左侧一个 azure 勾。
 */
const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      fieldClass,
      "flex h-8 items-center justify-between gap-2 whitespace-nowrap text-start",
      "data-[placeholder]:text-fg-3",
      "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/25",
      "[&>span]:truncate",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown
        className="h-3.5 w-3.5 shrink-0 text-fg-3"
        strokeWidth={1.5}
      />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-[100] max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[8rem] overflow-y-auto overflow-x-hidden",
        "rounded-panel border border-hairline bg-popover text-popover-foreground shadow-af-pop",
        "duration-120 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
        "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="hairline-b flex cursor-default items-center justify-center bg-popover py-1">
        <ChevronUp className="h-3.5 w-3.5 text-fg-3" strokeWidth={1.5} />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="hairline-t flex cursor-default items-center justify-center bg-popover py-1">
        <ChevronDown className="h-3.5 w-3.5 text-fg-3" strokeWidth={1.5} />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1 text-badge font-medium uppercase tracking-[0.06em] text-fg-3",
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-control py-1.5 ps-7 pe-2 text-body outline-none",
      "transition-colors duration-100 focus:bg-selected data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
      className,
    )}
    {...props}
  >
    <span className="absolute start-2 flex h-3.5 w-3.5 items-center justify-center text-action-text">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("mx-1 my-1 h-px bg-hairline", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
