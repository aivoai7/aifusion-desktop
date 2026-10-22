import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { APP_IDS } from "@/config/appConfig";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_DISPLAY_NAME, AppGlyph } from "@/components/shell/AppGlyph";

/**
 * 客户端详情页标题里的切换器：点名字换客户端，不用先回总览。
 * 菜单只列首页可见的客户端，顺序与总览一致。
 */
export function ClientSwitcher({
  app,
  visibleApps,
  onSelect,
  disabled = false,
}: {
  app: AppId;
  visibleApps: VisibleApps;
  onSelect: (app: AppId) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const apps = APP_IDS.filter((item) => visibleApps[item]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={t("appPage.switchClient", {
            defaultValue: "切换客户端",
          })}
          className="-ms-1 flex min-w-0 items-center gap-2 rounded-control px-1 py-0.5 text-start transition-colors hover:bg-subtle disabled:pointer-events-none disabled:opacity-45"
        >
          <AppGlyph app={app} size={18} badgeClassName="bg-app" />
          <span className="min-w-0 truncate">{APP_DISPLAY_NAME[app]}</span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-fg-3"
            strokeWidth={1.8}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[220px] rounded-panel"
      >
        <DropdownMenuLabel className="af-kicker px-2 py-1.5 text-[9px]">
          {t("appPage.clients", { defaultValue: "客户端" })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {apps.map((item) => {
          const current = item === app;
          return (
            <DropdownMenuItem
              key={item}
              onSelect={() => {
                if (!current) onSelect(item);
              }}
              className="gap-2.5"
            >
              <AppGlyph app={item} size={16} badgeClassName="bg-popover" />
              <span className="min-w-0 flex-1 truncate">
                {APP_DISPLAY_NAME[item]}
              </span>
              {current && (
                <Check
                  className="h-3.5 w-3.5 shrink-0 text-action-text"
                  strokeWidth={2}
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
