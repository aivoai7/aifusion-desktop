import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  /** default：30×18（设置行）；sm：26×16（表格、卡片里成排的开关） */
  size?: "default" | "sm";
}

/**
 * 开关（Ink & Grid）：轨道发丝描边 + 弱底，开 = azure 底 + 反白圆点，
 * 关 = --control-off 底 + 白点。尺寸沿用 30×18 / 26×16 两档，
 * 点击热区用 before 扩到轨道外 8px，小开关也好点。
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, size = "default", ...props }, ref) => {
  const small = size === "sm";
  return (
    <SwitchPrimitives.Root
      ref={ref}
      data-size={size}
      className={cn(
        "peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 ease-out",
        "before:absolute before:-inset-x-2 before:-inset-y-2 before:content-['']",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "border-transparent data-[state=checked]:bg-action data-[state=unchecked]:bg-control-off",
        small ? "h-4 w-[26px]" : "h-[18px] w-[30px]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block rounded-full shadow-sm ring-0",
          "transition-[transform,background-color] duration-150 ease-out",
          "data-[state=unchecked]:translate-x-0",
          small
            ? "h-3 w-3 data-[state=checked]:translate-x-2.5"
            : "h-3.5 w-3.5 data-[state=checked]:translate-x-3",
          "data-[state=checked]:bg-action-fg data-[state=unchecked]:bg-white",
        )}
      />
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
