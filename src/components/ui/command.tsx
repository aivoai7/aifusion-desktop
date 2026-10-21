import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 命令面板 / 可搜索下拉的骨架（cmdk）。外观跟其它浮层一致：
 * 卡片底 + 发丝描边 + af-pop 阴影；搜索行下面一条发丝线，选项圆角 6、
 * 悬停用选中底（--bg-selected），选中项左侧留 1px azure 细条。
 */

const Command = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-panel bg-popover text-popover-foreground",
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

const CommandInput = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div
    className="hairline-b flex items-center gap-2.5 px-3 focus-within:outline-none"
    cmdk-input-wrapper=""
  >
    <Search
      aria-hidden="true"
      strokeWidth={1.5}
      className="h-3.5 w-3.5 shrink-0 text-fg-3"
    />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "h-10 w-full flex-1 rounded-none bg-transparent text-body text-fg-1 outline-none ring-0",
        "placeholder:text-fg-3 disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      "max-h-[320px] overflow-y-auto overflow-x-hidden overscroll-contain",
      className,
    )}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-8 text-center text-caption text-fg-2"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-fg-1",
      "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
      "[&_[cmdk-group-heading]]:text-badge [&_[cmdk-group-heading]]:font-medium",
      "[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em]",
      "[&_[cmdk-group-heading]]:text-fg-3",
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandItem = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex select-none items-center gap-2 rounded-control px-2 py-1.5 text-body text-fg-1 outline-none",
      "cursor-default transition-colors duration-100",
      "data-[selected=true]:bg-selected",
      "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45",
      "[&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-fg-3",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
};
