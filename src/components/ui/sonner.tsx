import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/components/theme-provider";

/**
 * 全局提示（sonner，unstyled）：底部居中堆叠，卡片底 + 发丝描边 + af-pop。
 * 状态只靠图标颜色区分（成功绿 / 失败红 / 警告琥珀 / 提示灰），
 * 整条 toast 不上彩底——密集操作时一屏三四条彩色条很吵。
 *
 * 别给 toast 加 position 类：sonner 靠 absolute + transform 堆叠，
 * 改成 relative 会乱飞。它的自带选择器比 Tailwind 类更具体，所以整条都自己画。
 */
export function Toaster() {
  const { theme } = useTheme();
  const sonnerTheme = theme === "system" ? "system" : theme;

  return (
    <SonnerToaster
      position="bottom-center"
      theme={sonnerTheme}
      toastOptions={{
        duration: 2000,
        unstyled: true,
        classNames: {
          toast:
            "group flex w-full items-center gap-2.5 rounded-panel border border-hairline bg-surface py-2.5 pe-3.5 ps-3 text-body text-fg-1 shadow-af-pop",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "text-body font-medium",
          description: "text-caption text-fg-2",
          icon: "flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-danger",
          warning: "[&_[data-icon]]:text-warning",
          info: "[&_[data-icon]]:text-fg-2",
          loading: "[&_[data-icon]]:text-fg-2",
          // 关闭按钮压在右上角（RTL 时在左上角）
          closeButton:
            "absolute -end-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-surface text-fg-2 shadow-sm transition-colors hover:text-fg-1 [&>svg]:h-3 [&>svg]:w-3",
          actionButton:
            "h-6 shrink-0 rounded-control px-2 text-caption font-medium text-action-text transition-colors hover:bg-subtle",
          cancelButton:
            "h-6 shrink-0 rounded-control px-2 text-caption text-fg-2 transition-colors hover:bg-subtle",
        },
      }}
    />
  );
}
