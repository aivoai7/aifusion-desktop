import { useRef, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Folder,
  Globe,
  Info,
  Layers,
  LayoutDashboard,
  Route,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import type { AppId } from "@/lib/api";
import { platformKeyApi } from "@/lib/api/platformKey";
import type { VisibleApps } from "@/types";
import { APP_IDS } from "@/config/appConfig";
import type { SettingsSection, View } from "@/lib/navigation";
import { isAppPage } from "@/lib/navigation";
import { useUpdate } from "@/contexts/UpdateContext";
import { sidebarWidth, useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { useSidebarStatus, type AppNavStatus } from "@/hooks/useSidebarStatus";
import { HoverTip } from "@/components/ui/hover-tip";
import { DRAG_REGION_ATTR, DRAG_REGION_STYLE, isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import afLogo from "@/assets/icons/logo.png";
import { APP_DISPLAY_NAME, AppGlyph } from "./AppGlyph";

const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

type IconComponent = ComponentType<{
  className?: string;
  strokeWidth?: number | string;
}>;

interface SidebarProps {
  activeApp: AppId;
  view: View;
  visibleApps: VisibleApps;
  settingsSection: SettingsSection;
  onSelectApp: (app: AppId) => void;
  onSelectHome: () => void;
  onSelectSettingsSection: (section: SettingsSection) => void;
  onExitSettings: () => void;
}

type DirectoryProps = SidebarProps & { collapsed: boolean };

/**
 * 主导航（Ink & Grid）：品牌条 → 分组目录（唯一滚动的区域）→ 余额条。
 *
 * 和上游的形状区别：
 * · 目录按「工作区 / 客户端 / 系统」分组，每组一条 11px 大写字距标签，
 *   分组之间用发丝线，不再靠一条 border-t 硬切。
 * · 行高 30、行宽随侧栏（不再是写死的 184px），选中行除了选中底还在左边缘
 *   画一条 2px azure 竖条——密集列表里靠底色分不出「哪一行是当前页」。
 * · 应用 logo 一律坐进 22px 方底座，十个应用的视觉重量才一致。
 *
 * 收起时是 72（mac 84）宽的图标轨；开合宽度一步到位，边缘滑动由盖板 transform
 * 动画画出（见 useSidebarCollapsed）。收起时名字由 HoverTip 从右侧报。
 * 进入设置后整条侧栏换成设置目录。
 */
export function Sidebar(props: SidebarProps) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLElement>(null);
  const { collapsed, toggle } = useSidebarCollapsed(navRef);
  const inSettings = props.view === "settings";

  return (
    <nav
      ref={navRef}
      aria-label={t("nav.mainLabel")}
      className="relative flex h-full shrink-0 flex-col overflow-hidden whitespace-nowrap border-e border-hairline bg-sidebar text-body text-fg-1"
      style={{ width: sidebarWidth(collapsed) }}
    >
      <a
        href="#main-content"
        className="absolute -start-[999px] top-2 z-10 rounded-control bg-surface px-2 py-1 text-caption shadow-md focus:start-2"
      >
        {t("nav.skipToContent")}
      </a>
      <SidebarTopBar collapsed={collapsed} onToggle={toggle} />
      {inSettings ? (
        <SettingsDirectory {...props} collapsed={collapsed} />
      ) : (
        <MainDirectory {...props} collapsed={collapsed} />
      )}
    </nav>
  );
}

// ─── 品牌条 ────────────────────────────────────────────────────────────────

function SidebarTopBar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const tipSide = collapsed ? "right" : "left";
  const label = collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar");
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;

  const toggleButton = (
    <HoverTip content={label} side={tipSide} disableHoverableContent>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        style={NO_DRAG}
        className="flex h-7 w-7 items-center justify-center rounded-control text-fg-3 transition-colors duration-100 hover:bg-subtle hover:text-fg-1"
      >
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </HoverTip>
  );

  const dragRow = (className: string) => (
    <div
      className={className}
      {...DRAG_REGION_ATTR}
      style={DRAG_REGION_STYLE as React.CSSProperties}
    />
  );

  const brand = (
    <span
      className="pointer-events-none flex min-w-0 items-center gap-2"
      {...DRAG_REGION_ATTR}
    >
      <img
        src={afLogo}
        alt=""
        draggable={false}
        className="h-[22px] w-auto shrink-0"
      />
      <span className="truncate text-strong font-semibold text-fg-1">
        AIFusion
      </span>
    </span>
  );

  const brandRow = (className: string) => (
    <div
      className={className}
      {...DRAG_REGION_ATTR}
      style={DRAG_REGION_STYLE as React.CSSProperties}
    >
      {brand}
      <span className="pointer-events-none me-auto" {...DRAG_REGION_ATTR} />
      {toggleButton}
    </div>
  );

  // macOS：红绿灯占着顶条左边约 70px，品牌行放到它下面一行（中心 y≈44）。
  // 收起时图标轨只有 72 宽放不下品牌，只留一个居中的切换按钮，同样贴近红绿灯。
  if (isMac()) {
    return (
      <>
        {dragRow("h-11 shrink-0")}
        {collapsed ? (
          <div className="-mt-4 flex h-8 shrink-0 items-center justify-center">
            {toggleButton}
          </div>
        ) : (
          brandRow(
            "-mt-[18px] mb-1 flex h-9 shrink-0 items-center gap-2 pe-2 ps-4",
          )
        )}
      </>
    );
  }

  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center gap-1 px-2",
        collapsed ? "justify-center" : "justify-between",
      )}
      {...DRAG_REGION_ATTR}
      style={DRAG_REGION_STYLE as React.CSSProperties}
    >
      {!collapsed && brand}
      {toggleButton}
    </div>
  );
}

// ─── 分组与行 ──────────────────────────────────────────────────────────────

/** 分组标签：11px 大写 + 字距，收起时不画（图标轨放不下，靠分隔线分组）。 */
function NavGroup({
  collapsed,
  label,
  first = false,
}: {
  collapsed: boolean;
  label: string;
  first?: boolean;
}) {
  if (collapsed) {
    return first ? null : <div className="mx-3 my-2 h-px bg-hairline" />;
  }
  return (
    <div
      className={cn(
        "px-4 pb-1 pt-3 text-badge font-medium uppercase tracking-[0.08em] text-fg-3",
        first && "pt-1",
      )}
    >
      {label}
    </div>
  );
}

interface RowProps {
  collapsed: boolean;
  selected?: boolean;
  icon?: IconComponent;
  /** 应用页签用 logo 底座，其它行用线条图标 */
  glyph?: ReactNode;
  label: string;
  /** 整行的悬停说明（比 label 多说点什么时才挂） */
  title?: string;
  /** 行尾小字（版本号、计数），数组时排两行 */
  trailing?: string | string[];
  /** 行尾小字的完整说法（读屏用） */
  trailingLabel?: string;
  /** 需要处理：行尾红点 / 收起时角标 */
  alert?: string;
  /** 有更新：小圆点 */
  dot?: boolean;
  dotTone?: "neutral" | "success";
  /** 圆点放行的最右端（设置目录的「关于」），默认放图标角上 */
  endDot?: boolean;
  /** 底栏两格并排：宽度由父级平分 */
  compact?: boolean;
  onClick: () => void;
}

/**
 * 侧栏的一行。选中态 = 选中底 + 左缘 2px azure 竖条（::before），
 * 竖条只在展开时画：图标轨只有 72 宽，行本身已经是居中的方块。
 */
function SidebarRow({
  collapsed,
  selected = false,
  icon: Icon,
  glyph,
  label,
  title,
  trailing,
  trailingLabel,
  alert,
  dot = false,
  dotTone = "neutral",
  endDot = false,
  compact = false,
  onClick,
}: RowProps) {
  const ring = selected ? "border-selected" : "border-sidebar";
  const dotFill = dotTone === "success" ? "bg-success" : "bg-fg-1";
  const lines = trailing == null ? [] : Array.isArray(trailing) ? trailing : [trailing];
  const accessibleName = [label, trailingLabel ?? lines.join(" · "), alert]
    .filter(Boolean)
    .join(" · ");

  const mark = (
    <span aria-hidden="true" className="relative flex shrink-0 text-fg-2">
      {glyph ??
        (Icon ? (
          <Icon
            className={collapsed ? "h-5 w-5" : "h-[18px] w-[18px]"}
            strokeWidth={1.5}
          />
        ) : null)}
      {dot && (collapsed || !endDot) && (
        <span
          className={cn(
            "absolute -end-1 -top-[3px] h-2.5 w-2.5 rounded-full border-2",
            dotFill,
            ring,
          )}
        />
      )}
      {collapsed && alert && (
        <span
          className={cn(
            "absolute -end-[7px] -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 bg-danger text-action-fg",
            ring,
          )}
        >
          <AlertGlyph className="h-2 w-2" />
        </span>
      )}
    </span>
  );

  const rowClass = cn(
    "relative flex shrink-0 items-center gap-2 rounded-control text-start transition-colors duration-100 hover:bg-subtle",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
    collapsed
      ? "mx-auto h-8 w-12 justify-center"
      : "mx-2 h-[30px] w-[calc(100%-16px)] px-2",
    selected && "bg-selected hover:bg-selected",
    selected && !collapsed && "font-medium",
  );

  const rail =
    !collapsed && selected ? (
      <span
        aria-hidden="true"
        className="absolute -start-2 top-1/2 h-[18px] w-[2px] -translate-y-1/2 rounded-full bg-action"
      />
    ) : null;

  if (collapsed) {
    return (
      <HoverTip content={title ?? accessibleName} side="right" disableHoverableContent>
        <button
          type="button"
          onClick={onClick}
          aria-label={title ?? accessibleName}
          aria-current={selected ? "page" : undefined}
          className={rowClass}
        >
          {mark}
        </button>
      </HoverTip>
    );
  }

  const hoverContent =
    title && title !== label ? title : trailingLabel ? accessibleName : undefined;

  return (
    <HoverTip content={hoverContent} side={compact ? "top" : "right"} disableHoverableContent>
      <button
        type="button"
        onClick={onClick}
        aria-label={trailingLabel ? accessibleName : undefined}
        aria-current={selected ? "page" : undefined}
        className={cn(rowClass, compact ? "min-w-0 flex-1" : undefined)}
      >
        {rail}
        {mark}
        {lines.length === 0 ? (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        ) : (
          <>
            {/* 有行尾小字时名字不截断：放不下让小字折行（两行正好塞进 30px 行高） */}
            <span className="shrink-0 grow">{label}</span>
            <span className="af-num min-w-0 text-end text-caption leading-[13px] text-fg-3">
              {lines.map((line) => (
                <span
                  key={line}
                  className={lines.length > 1 ? "block whitespace-nowrap" : undefined}
                >
                  {line}
                </span>
              ))}
            </span>
          </>
        )}
        {alert && (
          <span
            role="img"
            aria-label={alert}
            title={alert}
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
          />
        )}
        {dot && endDot && (
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotFill)}
          />
        )}
      </button>
    </HoverTip>
  );
}

function AlertGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 4v10" />
      <path d="M12 20h.01" />
    </svg>
  );
}

// ─── 主目录 ────────────────────────────────────────────────────────────────

function MainDirectory({
  collapsed,
  activeApp,
  view,
  visibleApps,
  onSelectApp,
  onSelectHome,
}: DirectoryProps) {
  const { t } = useTranslation();
  const { appStatus } = useSidebarStatus();
  const apps = APP_IDS.filter((app) => visibleApps[app]);
  const onAppPage = isAppPage(view);

  return (
    <>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pb-2 pt-0.5",
          // 图标轨只有 72 宽，放不下滚动条
          collapsed && "no-scrollbar",
        )}
      >
        <NavGroup
          collapsed={collapsed}
          first
          label={t("nav.groupWorkspace", { defaultValue: "工作台" })}
        />
        <SidebarRow
          collapsed={collapsed}
          selected={view === "home"}
          icon={LayoutDashboard}
          label={t("nav.home", { defaultValue: "首页总览" })}
          onClick={onSelectHome}
        />

        <NavGroup
          collapsed={collapsed}
          label={t("nav.groupClients", { defaultValue: "客户端" })}
        />
        <div role="group" aria-label={t("nav.appsGroup")} className="flex flex-col">
          {apps.map((app) => (
            <AppNavItem
              key={app}
              app={app}
              collapsed={collapsed}
              selected={onAppPage && activeApp === app}
              status={appStatus(app)}
              onSelect={() => onSelectApp(app)}
            />
          ))}
        </div>
      </div>
      <WalletFooter collapsed={collapsed} />
    </>
  );
}

/**
 * 侧栏底部的钱包余额：一行读数，不是卡片。
 * 用本机保存的平台 Key 走网关 /v1/wallet/balance 取真实美元余额，每分钟刷新；
 * 未登录或平台没有这个接口时保留 $— 占位，不显示 0 或估算值。
 */
function WalletFooter({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const label = t("nav.walletBalance");
  const hint = t("nav.walletHint");
  const { data: balance } = useQuery({
    queryKey: ["platformWalletBalance"],
    queryFn: () => platformKeyApi.walletBalance(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const amount =
    typeof balance === "number" && Number.isFinite(balance)
      ? `$${balance.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "$—";
  const summary = `${label} · ${amount}`;

  if (collapsed) {
    return (
      <div className="hairline-t shrink-0 px-2 py-2">
        <HoverTip content={summary} side="right" disableHoverableContent>
          <div
            role="img"
            aria-label={summary}
            className="mx-auto flex h-8 w-12 items-center justify-center rounded-control text-fg-3"
          >
            <Wallet className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </div>
        </HoverTip>
      </div>
    );
  }

  return (
    <div className="hairline-t shrink-0 px-4 py-2.5" title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-caption text-fg-3">
          <Wallet className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="truncate">{label}</span>
        </span>
        <span className="af-num shrink-0 text-strong text-fg-1">{amount}</span>
      </div>
      <div className="mt-0.5 text-badge text-fg-3">
        {typeof balance === "number" ? "USD" : t("nav.walletUnavailable")}
      </div>
    </div>
  );
}

function modeTag(
  status: AppNavStatus,
  t: (key: string) => string,
): { label: string; className: string } | null {
  if (status.mode === "route") {
    return { label: t("nav.mode.route"), className: "bg-route-soft text-route-text" };
  }
  if (status.mode === "stack") {
    return { label: t("nav.mode.stack"), className: "bg-stack-soft text-stack-text" };
  }
  return null;
}

function AppNavItem({
  app,
  collapsed,
  selected,
  status,
  onSelect,
}: {
  app: AppId;
  collapsed: boolean;
  selected: boolean;
  status: AppNavStatus;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const name = APP_DISPLAY_NAME[app];
  const tag = modeTag(status, t);
  const modeName =
    status.mode === "route"
      ? t("nav.mode.route")
      : status.mode === "stack"
        ? t("nav.mode.stack")
        : null;
  const tip = status.alert
    ? `${name} · ${t("nav.needsAttention")}`
    : modeName
      ? `${name} · ${modeName}`
      : name;
  const badgeBg = selected ? "bg-selected" : "bg-sidebar";

  return (
    <SidebarRow
      collapsed={collapsed}
      selected={selected}
      label={name}
      title={tip === name ? undefined : tip}
      alert={status.alert ? t("nav.needsAttention") : undefined}
      trailing={
        // 选中的应用不再显示模式标签：页头下面的模式行已经写明
        tag && !selected ? tag.label : undefined
      }
      onClick={onSelect}
      glyph={
        <span className="relative flex">
          <AppGlyph
            app={app}
            size={collapsed ? 20 : 16}
            variant={collapsed ? "plain" : "tile"}
            badgeClassName={badgeBg}
          />
          {collapsed &&
            (() => {
              const marker = status.alert
                ? { className: "bg-danger text-action-fg", icon: AlertGlyph }
                : status.mode === "stack"
                  ? { className: "bg-stack-solid text-stack-on", icon: Layers }
                  : status.mode === "route"
                    ? { className: "bg-route-solid text-route-on", icon: Route }
                    : null;
              return marker ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -end-[7px] -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2",
                    selected ? "border-selected" : "border-sidebar",
                    marker.className,
                  )}
                >
                  <marker.icon className="h-2 w-2" />
                </span>
              ) : null;
            })()}
        </span>
      }
    />
  );
}

// ─── 设置目录 ──────────────────────────────────────────────────────────────

const SETTINGS_ITEMS: { section: SettingsSection; icon: IconComponent }[] = [
  { section: "general", icon: SlidersHorizontal },
  { section: "appConfig", icon: Folder },
  { section: "routing", icon: Route },
  { section: "network", icon: Globe },
  { section: "data", icon: Database },
  { section: "about", icon: Info },
];

function SettingsDirectory({
  collapsed,
  settingsSection,
  onSelectSettingsSection,
  onExitSettings,
}: DirectoryProps) {
  const { t } = useTranslation();
  const { hasUpdate } = useUpdate();
  const { data: version } = useQuery({
    queryKey: ["app-version"],
    queryFn: () => getVersion(),
    staleTime: Infinity,
  });

  return (
    <>
      <SidebarRow
        collapsed={collapsed}
        icon={ArrowLeft}
        label={t("nav.back")}
        onClick={onExitSettings}
      />
      <NavGroup collapsed={collapsed} first label={t("nav.settings")} />
      <div role="group" aria-label={t("nav.settings")} className="flex min-h-0 flex-1 flex-col">
        {SETTINGS_ITEMS.map(({ section, icon }) => (
          <SidebarRow
            key={section}
            collapsed={collapsed}
            selected={settingsSection === section}
            icon={icon}
            label={t(`settings.sections.${section}`)}
            dot={section === "about" && hasUpdate}
            dotTone="success"
            endDot
            title={
              section === "about" && hasUpdate
                ? t("nav.settingsHasUpdate")
                : undefined
            }
            onClick={() => onSelectSettingsSection(section)}
          />
        ))}
      </div>
      {!collapsed && version && (
        <div className="hairline-t shrink-0 px-4 py-2.5 text-caption text-fg-3">
          <span className="af-num">AIFusion v{version}</span>
        </div>
      )}
    </>
  );
}

export type { SidebarProps };
