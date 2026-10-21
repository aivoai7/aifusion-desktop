import { Monitor, Terminal } from "lucide-react";
import type { AppId } from "@/lib/api";
import { APP_LABELS } from "@/config/appConfig";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";

/** 应用名取自 `config/appConfig`（唯一出处）；品牌名不翻译，所有语言写原文。 */
export const APP_DISPLAY_NAME = APP_LABELS;

const APP_ICON_NAME: Record<AppId, string> = {
  claude: "claude",
  "claude-desktop": "claude",
  codex: "openai",
  gemini: "gemini",
  grokbuild: "grok",
  opencode: "opencode",
  openclaw: "openclaw",
  hermes: "hermes",
  pi: "pi",
  mcode: "minimax",
};

// Claude Code 和 Claude Desktop 共用一个 mark，靠右下角的小角标区分终端与桌面
const APP_BADGE_ICON: Partial<Record<AppId, typeof Terminal>> = {
  claude: Terminal,
  "claude-desktop": Monitor,
};

interface AppGlyphProps {
  app: AppId;
  /** 图标边长：行内 14–16，页头 20 */
  size?: number;
  /** 角标底色要和所在的行一致，否则看起来像缺了一块 */
  badgeClassName?: string;
  /**
   * plain：只有 logo（表格、卡片里密集出现时用）。
   * tile：logo 坐进 22×22 的方底座（弱底 + 发丝描边），侧栏和页头用它，
   *        十个应用的视觉重量才一致——蓝的、彩色的 logo 直接排一列会很乱。
   */
  variant?: "plain" | "tile";
  className?: string;
}

/** 应用图标 + 角标（装饰性，名称由旁边的文字或按钮的 aria-label 提供）。 */
export function AppGlyph({
  app,
  size = 16,
  badgeClassName,
  variant = "plain",
  className,
}: AppGlyphProps) {
  const BadgeIcon = APP_BADGE_ICON[app];
  const badge = BadgeIcon ? (
    <span
      className={cn(
        "absolute -bottom-1 -right-1 flex h-[11px] w-[11px] items-center justify-center rounded-[3px] bg-sidebar text-fg-2",
        badgeClassName,
      )}
    >
      <BadgeIcon className="h-[9px] w-[9px]" strokeWidth={3} />
    </span>
  ) : null;

  const glyph = (
    <ProviderIcon
      icon={APP_ICON_NAME[app]}
      name=""
      size={variant === "tile" ? Math.round(size * 0.8) : size}
      showFallback={false}
    />
  );

  if (variant === "tile") {
    const edge = size + 6;
    return (
      <span
        aria-hidden="true"
        className={cn("relative inline-flex shrink-0", className)}
        style={{ width: edge, height: edge }}
      >
        <span
          className={cn(
            "flex h-full w-full items-center justify-center rounded-control",
            "border border-hairline bg-subtle text-fg-1",
          )}
        >
          {glyph}
        </span>
        {badge}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: size + 2, height: size + 2 }}
    >
      {glyph}
      {badge}
    </span>
  );
}
