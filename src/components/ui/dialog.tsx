import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/**
 * 对话框（Ink & Grid）：14px 圆角、发丝描边、af-pop 阴影，遮罩用 --overlay。
 * zIndex 分四档，浮层叠放顺序和抽屉、菜单一致：
 * base 40 < nested 50 < alert 60（确认框）< top 110（覆盖一切的提示）。
 * 点遮罩默认不关闭（表单草稿容易被误点丢掉），需要的话调用处自己接 onInteractOutside。
 */
const ZINDEX = {
  base: "z-40",
  nested: "z-50",
  alert: "z-[60]",
  top: "z-[110]",
} as const;

type DialogLayer = keyof typeof ZINDEX;

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    zIndex?: DialogLayer;
  }
>(({ className, zIndex = "base", ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 bg-overlay duration-200",
      "data-[state=open]:animate-in data-[state=open]:fade-in-0",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      ZINDEX[zIndex],
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    zIndex?: DialogLayer;
    variant?: "default" | "fullscreen";
    overlayClassName?: string;
  }
>(
  (
    {
      className,
      children,
      zIndex = "base",
      variant = "default",
      overlayClassName,
      ...props
    },
    ref,
  ) => {
    const shell =
      variant === "fullscreen"
        ? "fixed inset-0 flex h-screen w-screen flex-col bg-app text-fg-1"
        : "fixed left-1/2 top-1/2 flex max-h-[90vh] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col " +
          "rounded-dialog border border-hairline bg-surface text-fg-1 shadow-af-pop " +
          "duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 " +
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

    return (
      <DialogPortal>
        <DialogOverlay zIndex={zIndex} className={overlayClassName} />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(shell, ZINDEX[zIndex], className)}
          onInteractOutside={(event) => {
            if (variant === "default") event.preventDefault();
          }}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "hairline-b flex shrink-0 flex-col gap-1 px-6 pb-4 pt-5 text-start",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "hairline-t flex shrink-0 flex-row items-center justify-end gap-2 px-6 py-4",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-title text-fg-1", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-caption leading-relaxed text-fg-2", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
};
