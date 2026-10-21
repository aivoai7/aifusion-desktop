import * as React from "react";

import { cn } from "@/lib/utils";

type CheckedState = boolean | "indeterminate";

interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "checked" | "type" | "onChange"
  > {
  checked?: CheckedState;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * 勾选框：原生 input（表单、键盘、屏幕阅读器都不用另外桥接），外观走 index.css 的
 * .ui-checkbox —— 16px 见方、4px 圆角、发丝描边，选中是 azure 底 + 反白勾，
 * 半选（indeterminate）是横杠。半选只由 checked 决定，DOM 的 indeterminate 属性
 * 在每个渲染周期同步一次，避免受控更新后残留。
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      checked,
      onChange,
      onCheckedChange,
      "aria-checked": ariaChecked,
      ...props
    },
    ref,
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const mixed = checked === "indeterminate";

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    React.useLayoutEffect(() => {
      if (inputRef.current) inputRef.current.indeterminate = mixed;
    });

    return (
      <input
        {...props}
        ref={inputRef}
        type="checkbox"
        className={cn("ui-checkbox", className)}
        checked={mixed ? false : checked}
        aria-checked={mixed ? "mixed" : ariaChecked}
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.target.checked);
        }}
      />
    );
  },
);

Checkbox.displayName = "Checkbox";

export { Checkbox };
export type { CheckboxProps, CheckedState };
