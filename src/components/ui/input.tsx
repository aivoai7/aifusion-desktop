import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 输入框 / 文本域共用的外观（Ink & Grid「输入」）：
 * 高 32、圆角 6、发丝强描边；聚焦时描边换 azure 并给 2px 柔光环，出错时红描边。
 * Input 和自定义 Textarea / Select 触发器都拼这一串，保证三者的边、底、光环一致。
 */
export const fieldClass = cn(
  "w-full rounded-control border border-hairline-strong bg-surface px-2.5 text-body text-fg-1",
  "transition-[border-color,box-shadow,background-color] duration-150",
  "placeholder:text-fg-3",
  "focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-destructive/25",
  "disabled:cursor-not-allowed disabled:opacity-45",
);

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        fieldClass,
        // 行高靠 flex + py 控制，免得不同浏览器给 input 的默认高度不一样
        "flex h-8 items-center py-1",
        "file:mr-2 file:border-0 file:bg-transparent file:py-0 file:text-body file:font-medium file:text-fg-1",
        className,
      )}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
