import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, MoreHorizontal } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { VisibleApps } from "@/types";
import { KNOWN_APP_TYPES, type AppTypeFilter } from "@/types/usage";
import type { EnvConflict } from "@/types/env";
import {
  providersQueryOptions,
  proxyKeys,
  useProvidersQuery,
  useSettingsQuery,
} from "@/lib/query";
import {
  providersApi,
  type AppId,
  type ProviderSwitchEvent,
} from "@/lib/api";
import { checkAllEnvConflicts, checkEnvConflicts } from "@/lib/api/env";
import { useOpenClawHealth } from "@/hooks/useOpenClaw";
import { useOpenHermesWebUI } from "@/hooks/useHermes";
import { hermesApi } from "@/lib/api/hermes";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useUsageCacheBridge } from "@/hooks/useUsageCacheBridge";
import {
  useTrayAppPageSeen,
  useTrayNavigation,
} from "@/hooks/useTrayNavigation";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { extractErrorMessage } from "@/utils/errorUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { isLinux, isWindows } from "@/lib/platform";
import {
  APP_STORAGE_KEY,
  appPageBelongsTo,
  isAppPage,
  readStoredView,
  sharedFeatureAppOf,
  storeView,
  type GlobalPage,
  type View,
} from "@/lib/navigation";
import {
  AppPageHeader,
  WindowControlsContext,
} from "@/components/shell/AppPageHeader";
import { WindowControls } from "@/components/shell/WindowControls";
import { TopBar } from "@/components/shell/TopBar";
import { ClientSwitcher } from "@/components/shell/ClientSwitcher";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { ProfileSwitcher } from "@/components/profiles/ProfileSwitcher";
import { PlatformConnectionPanel } from "@/components/providers/PlatformConnectionPanel";
import { HomeOverview } from "@/components/home/HomeOverview";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { discardUnsavedChanges, hasUnsavedChanges } from "@/lib/unsavedChanges";
import { AppsPage } from "@/components/apps/AppsPage";
import { checkToolUpdatesInBackground } from "@/components/apps/useToolManagement";
import { UsagePage } from "@/components/usage/UsagePage";
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";
import PromptPanel from "@/components/prompts/PromptPanel";
import { PROMPT_APP_IDS } from "@/lib/query/prompts";
import UnifiedSkillsPanel from "@/components/skills/UnifiedSkillsPanel";
import { DeepLinkImportDialog } from "@/components/DeepLinkImportDialog";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";
import { WhatsNewNotice } from "@/components/WhatsNewDialog";
import { Button } from "@/components/ui/button";
import { HoverTip } from "@/components/ui/hover-tip";
import { PageTabs } from "@/components/ui/page-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import { invalidatePiProviderCaches } from "@/lib/query/pi";
import WorkspaceFilesPanel from "@/components/workspace/WorkspaceFilesPanel";
import EnvPanel from "@/components/openclaw/EnvPanel";
import ToolsPanel from "@/components/openclaw/ToolsPanel";
import AgentsDefaultsPanel from "@/components/openclaw/AgentsDefaultsPanel";
import OpenClawHealthBanner from "@/components/openclaw/OpenClawHealthBanner";
import HermesMemoryPanel, {
  HermesMemorySaveButton,
} from "@/components/hermes/HermesMemoryPanel";
import { APP_IDS, DEFAULT_VISIBLE_APPS, isModeAppId } from "@/config/appConfig";

interface SyncStatusUpdatedPayload {
  source?: string;
  status?: string;
  error?: string;
}

type OpenClawConfigTab = "env" | "tools" | "agents";

const getInitialApp = (): AppId => {
  const saved = localStorage.getItem(APP_STORAGE_KEY) as AppId | null;
  if (saved && APP_IDS.includes(saved)) {
    return saved;
  }
  return "claude";
};

function App() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const sharedFeatureApp = sharedFeatureAppOf(activeApp);
  const [currentView, setCurrentView] = useState<View>(readStoredView);
  const [openclawConfigTab, setOpenclawConfigTab] =
    useState<OpenClawConfigTab>("env");
  const [promptsApp, setPromptsApp] = useState<AppId>(() =>
    PROMPT_APP_IDS.includes(sharedFeatureApp) ? sharedFeatureApp : "claude",
  );
  const [mcpManagementBusy, setMcpManagementBusy] = useState(false);
  const [skillsNavigationBusy, setSkillsNavigationBusy] = useState(false);
  const [promptNavigationBusy, setPromptNavigationBusy] = useState(false);

  useEffect(() => {
    storeView(currentView);
  }, [currentView]);

  const { data: settingsData } = useSettingsQuery();
  // Windows 一律去掉系统标题栏，用页头里的应用内窗口按钮；Linux 由设置决定
  const useAppWindowControls =
    isWindows() || (isLinux() && (settingsData?.useAppWindowControls ?? false));
  const visibleApps = useMemo<VisibleApps>(
    () => ({
      ...DEFAULT_VISIBLE_APPS,
      ...settingsData?.visibleApps,
    }),
    [settingsData?.visibleApps],
  );

  const getFirstVisibleApp = (): AppId => {
    return APP_IDS.find((app) => visibleApps[app]) ?? "claude";
  };

  useEffect(() => {
    if (!visibleApps[activeApp]) {
      setActiveApp(getFirstVisibleApp());
    }
  }, [visibleApps, activeApp]);

  // 启动后把其他可见应用的配置列表预取进缓存：第一次切过去直接有数据，不先画骨架
  const providersPrefetchedRef = useRef(false);
  useEffect(() => {
    if (!settingsData || providersPrefetchedRef.current) return;
    providersPrefetchedRef.current = true;
    for (const app of APP_IDS) {
      if (app !== activeApp && visibleApps[app]) {
        void queryClient.prefetchQuery(providersQueryOptions(app));
      }
    }
  }, [settingsData, visibleApps, activeApp, queryClient]);

  // 「启动时检查应用更新」（默认关）：打开了才在后台查一次
  const checkToolUpdatesOnStartup =
    settingsData?.checkToolUpdatesOnStartup ?? false;
  const startupToolCheckDoneRef = useRef(false);
  useEffect(() => {
    if (!checkToolUpdatesOnStartup || startupToolCheckDoneRef.current) return;
    startupToolCheckDoneRef.current = true;
    void checkToolUpdatesInBackground();
  }, [checkToolUpdatesOnStartup]);

  // 应用专属页（工作区、记忆…）只属于它的应用；换了应用就回到该应用的详情页
  useEffect(() => {
    if (isAppPage(currentView) && !appPageBelongsTo(currentView, activeApp)) {
      setCurrentView("providers");
    }
  }, [activeApp, currentView]);

  const [envConflicts, setEnvConflicts] = useState<EnvConflict[]>([]);
  const [showEnvBanner, setShowEnvBanner] = useState(false);

  const mainScrollRef = useRef<HTMLElement>(null);
  const providerScrollContainerRef = useRef<HTMLDivElement>(null);

  useUsageCacheBridge();

  useLayoutEffect(() => {
    if (currentView !== "providers") return;

    for (const container of [
      mainScrollRef.current,
      providerScrollContainerRef.current,
    ]) {
      if (container) {
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }
    }
  }, [activeApp, currentView]);

  const { isRunning: isProxyRunning } = useProxyStatus();
  const currentAppUsesProxy = isModeAppId(activeApp);

  const { data } = useProvidersQuery(activeApp, {
    isProxyRunning: currentAppUsesProxy && isProxyRunning,
  });
  const providers = useMemo(() => data?.providers ?? {}, [data]);
  const currentProviderId = data?.currentProviderId ?? "";
  const isOpenClawView = activeApp === "openclaw" && isAppPage(currentView);
  const { data: openclawHealthWarnings = [] } =
    useOpenClawHealth(isOpenClawView);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;

    const setupListener = async () => {
      try {
        const off = await providersApi.onSwitched(
          async (event: ProviderSwitchEvent) => {
            // 按前缀失效：故障转移只改路由指针，「路由中」标记读的是
            // ["providers", app, "mode"]，只 refetch 列表会让它停在旧那家
            await queryClient.invalidateQueries({
              queryKey: ["providers", event.appType],
            });
            if (event.appType === "pi") {
              await invalidatePiProviderCaches(queryClient);
            }
          },
        );
        if (!active) {
          off();
          return;
        }
        unsubscribe = off;
      } catch (error) {
        console.error("[App] Failed to subscribe provider switch event", error);
      }
    };

    void setupListener();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [queryClient]);

  useTauriEvent("universal-provider-synced", async () => {
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to update tray menu", error);
    }
  });

  // 应用项目后刷新相关缓存（providers 由既有 provider-switched 监听承接；
  // proxy 状态由后端直接改 DB，不走 mutation，必须显式刷新）
  useTauriEvent("profile-applied", async () => {
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    await queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await queryClient.invalidateQueries({
      queryKey: proxyKeys.takeoverStatus,
    });
    await queryClient.invalidateQueries({ queryKey: proxyKeys.status });
    await queryClient.invalidateQueries({
      queryKey: ["providers", "claude-desktop"],
    });
  });

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "webdav-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.webdavSync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "s3-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.s3Sync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<{ appType: string; providerName: string }>(
    "proxy-official-warning",
    (payload) => {
      toast.warning(
        t("notifications.proxyOfficialWarning", {
          name: payload.providerName,
          defaultValue: `${payload.providerName} 走平台直连，本机路由接管不了，请求仍会按直连发出`,
        }),
        { duration: 8000 },
      );
    },
  );

  useEffect(() => {
    // settingsData 未加载时跳过，避免用 fallback false 覆盖 Rust 侧已设好的装饰状态
    if (!settingsData) return;

    const syncWindowDecorations = async () => {
      try {
        await getCurrentWindow().setDecorations(!useAppWindowControls);
      } catch (error) {
        console.error("[App] Failed to update window decorations", error);
      }
    };

    void syncWindowDecorations();
  }, [useAppWindowControls, settingsData]);

  useEffect(() => {
    const checkEnvOnStartup = async () => {
      try {
        const allConflicts = await checkAllEnvConflicts();
        const flatConflicts = Object.values(allConflicts).flat();

        if (flatConflicts.length > 0) {
          setEnvConflicts(flatConflicts);
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on startup:",
          error,
        );
      }
    };

    checkEnvOnStartup();
  }, []);

  useEffect(() => {
    const checkMigration = async () => {
      try {
        const migrated = await invoke<boolean>("get_migration_result");
        if (migrated) {
          toast.success(
            t("migration.success", { defaultValue: "配置迁移成功" }),
            { closeButton: true },
          );
        }
      } catch (error) {
        console.error("[App] Failed to check migration result:", error);
      }
    };

    checkMigration();
  }, [t]);

  useEffect(() => {
    const checkSkillsMigration = async () => {
      try {
        const result = await invoke<{ count: number; error?: string } | null>(
          "get_skills_migration_result",
        );
        if (result?.error) {
          toast.error(t("migration.skillsFailed"), {
            description: t("migration.skillsFailedDescription"),
            closeButton: true,
          });
          console.error("[App] Skills SSOT migration failed:", result.error);
          return;
        }
        if (result && result.count > 0) {
          toast.success(t("migration.skillsSuccess", { count: result.count }), {
            closeButton: true,
          });
          await queryClient.invalidateQueries({ queryKey: ["skills"] });
        }
      } catch (error) {
        console.error("[App] Failed to check skills migration result:", error);
      }
    };

    checkSkillsMigration();
  }, [t, queryClient]);

  useEffect(() => {
    const checkEnvOnSwitch = async () => {
      try {
        if (activeApp === "mcode") return;
        const conflicts = await checkEnvConflicts(activeApp);

        if (conflicts.length > 0) {
          setEnvConflicts((prev) => {
            const existingKeys = new Set(
              prev.map((c) => `${c.varName}:${c.sourcePath}`),
            );
            const newConflicts = conflicts.filter(
              (c) => !existingKeys.has(`${c.varName}:${c.sourcePath}`),
            );
            return [...prev, ...newConflicts];
          });
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on app switch:",
          error,
        );
      }
    };

    checkEnvOnSwitch();
  }, [activeApp]);

  const currentViewRef = useRef(currentView);
  const managementBusy =
    mcpManagementBusy || skillsNavigationBusy || promptNavigationBusy;
  const managementBusyRef = useRef(false);
  managementBusyRef.current = managementBusy;

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  // ─── 导航 ───────────────────────────────────────────────────────────────
  // MCP / Skills / 提示词在进行中的操作会锁住导航（卸载面板会丢掉进行中的状态）

  // 整页编辑器里有未保存的修改：先确认，确认放弃后再执行这次导航
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const confirmLeave = (proceed: () => void) => {
    if (!hasUnsavedChanges()) return false;
    setPendingLeave(() => proceed);
    return true;
  };

  const selectApp = (app: AppId) => {
    if (managementBusyRef.current) return;
    if (confirmLeave(() => selectApp(app))) return;
    setActiveApp(app);
    localStorage.setItem(APP_STORAGE_KEY, app);
    setCurrentView("providers");
  };

  /** 首页总览：去掉侧栏后它是唯一入口，页头最左端的品牌块就指回这里。 */
  const openHome = () => {
    if (managementBusyRef.current) return;
    // 再点当前页不会离开：不弹确认，也不能清掉编辑页的未保存登记
    if (currentViewRef.current === "home") return;
    if (confirmLeave(() => openHome())) return;
    setCurrentView("home");
  };

  const openPage = (page: GlobalPage) => {
    if (managementBusyRef.current) return;
    // 再点当前页不会离开：不弹确认，也不能清掉编辑页的未保存登记
    if (currentViewRef.current === page) return;
    if (confirmLeave(() => openPage(page))) return;
    if (page === "prompts" && currentViewRef.current !== "prompts") {
      // 提示词页默认选中最后用过的那个应用
      setPromptsApp(
        PROMPT_APP_IDS.includes(sharedFeatureApp) ? sharedFeatureApp : "claude",
      );
    }
    setCurrentView(page);
  };
  useTrayAppPageSeen(currentView === "providers" ? activeApp : null);

  useTrayNavigation((navigation) => {
    const navigate = () => {
      if (!navigation.app) return;
      selectApp(navigation.app);
    };
    if (managementBusyRef.current || !confirmLeave(navigate)) navigate();
  });

  // 首页那一排入口、⌘K 进用量统计看全部应用；只有应用页 ⋯ 进来时带应用筛选
  const openPageFromNav = (page: GlobalPage) => {
    if (page === "usage") setUsageAppFilter("all");
    openPage(page);
  };

  const [usageAppFilter, setUsageAppFilter] = useState<AppTypeFilter>("all");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.body.style.overflow === "hidden") return;
      if (managementBusyRef.current) return;
      if (isTextEditableTarget(event.target)) return;

      const view = currentViewRef.current;
      if (view === "skillsDiscovery") {
        event.preventDefault();
        setCurrentView("skills");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const [launchDashboardOpen, setLaunchDashboardOpen] = useState(false);
  const openHermesWebUI = useOpenHermesWebUI(() =>
    setLaunchDashboardOpen(true),
  );

  // ─── 应用页 ─────────────────────────────────────────────────────────────

  // 应用页 ⋯ →「查看此应用的用量」：带上这个应用的筛选（Claude Desktop 的流量并在 Claude 里）
  const usageAppOf = (app: AppId): AppTypeFilter | null => {
    const type = app === "claude-desktop" ? "claude" : app;
    return (KNOWN_APP_TYPES as ReadonlyArray<string>).includes(type)
      ? (type as AppTypeFilter)
      : null;
  };
  const activeUsageApp = usageAppOf(activeApp);

  const appMenu = (
    <DropdownMenu>
      <HoverTip content={t("common.more")}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="quiet"
            size="icon-compact"
            className="h-8 w-8"
            aria-label={t("appPage.moreActions", {
              name: APP_DISPLAY_NAME[activeApp],
            })}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </HoverTip>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem onSelect={() => openPage("sessions")}>
          {t("appPage.viewSessions")}
        </DropdownMenuItem>
        {activeUsageApp && (
          <DropdownMenuItem
            onSelect={() => {
              setUsageAppFilter(activeUsageApp);
              openPage("usage");
            }}
          >
            {t("appPage.viewUsage")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => openPage("apps")}>
          {t("appPage.installAndUpgrade")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const appPageName =
    currentView === "workspace"
      ? t("appPage.workspace")
      : currentView === "openclawConfig"
        ? t("appPage.openclawConfig")
        : currentView === "hermesMemory"
          ? t("appPage.memory")
          : t("appPage.providers");

  // 顶栏常驻之后，客户端页的页头只承载「返回总览 + 切客户端 + 本页操作」
  const renderAppPageHeader = () => (
    <AppPageHeader
      variant="app"
      leading={
        <HoverTip
          content={t("nav.backHome", { defaultValue: "返回总览" })}
          disableHoverableContent
        >
          <Button
            variant="quiet"
            size="icon-compact"
            onClick={openHome}
            aria-label={t("nav.backHome", { defaultValue: "返回总览" })}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
          </Button>
        </HoverTip>
      }
      title={
        <ClientSwitcher
          app={activeApp}
          visibleApps={visibleApps}
          onSelect={selectApp}
          disabled={managementBusy}
        />
      }
      subtitle={
        activeApp === "openclaw" || activeApp === "hermes"
          ? undefined
          : appPageName
      }
      actions={
        <>
          {currentView === "providers" &&
            activeApp !== "mcode" &&
            (settingsData?.showProfileSwitcher ?? false) && (
              <ProfileSwitcher activeApp={activeApp} />
            )}
          {activeApp === "hermes" && (
            <Button
              variant="quiet"
              size="regular"
              onClick={() => void openHermesWebUI()}
            >
              {t("appPage.webUi")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          {currentView === "hermesMemory" && <HermesMemorySaveButton />}
          {appMenu}
        </>
      }
    />
  );

  // OpenClaw / Hermes 没有模式 tab，那一行放它们自己的页面导航。
  // 换整块内容的是页面导航，用下划线页签；分段控件只留给模式和页内筛选。
  const renderAppSegments = () => {
    if (activeApp === "openclaw") {
      return (
        <div className="shrink-0 px-5 pt-2">
          <PageTabs
            aria-label={APP_DISPLAY_NAME.openclaw}
            idPrefix="openclaw-page"
            value={currentView}
            onValueChange={(view) => setCurrentView(view)}
            items={[
              { value: "providers", label: t("appPage.providers") },
              { value: "workspace", label: t("appPage.workspace") },
              { value: "openclawConfig", label: t("appPage.openclawConfig") },
            ]}
          />
        </div>
      );
    }
    if (activeApp === "hermes") {
      return (
        <div className="shrink-0 px-5 pt-2">
          <PageTabs
            aria-label={APP_DISPLAY_NAME.hermes}
            idPrefix="hermes-page"
            value={currentView}
            onValueChange={(view) => setCurrentView(view)}
            items={[
              { value: "providers", label: t("appPage.providers") },
              { value: "hermesMemory", label: t("appPage.memory") },
            ]}
          />
        </div>
      );
    }
    return null;
  };

  // 这个构建只对接 AIFusion 自有平台：应用页不展示渠道卡片，只显示平台连接状态
  const renderProviderList = () => (
    <div
      ref={providerScrollContainerRef}
      id="main-content"
      className="min-h-0 flex-1 overflow-y-auto scroll-stable overflow-x-hidden"
    >
      <PlatformConnectionPanel
        app={activeApp}
        providers={providers}
        currentProviderId={currentProviderId}
        visibleApps={visibleApps}
        onOpenPage={openPageFromNav}
        onOpenApp={selectApp}
      />
    </div>
  );

  const renderAppPage = () => {
    const body = (() => {
      switch (currentView) {
        case "workspace":
          return <WorkspaceFilesPanel />;
        case "openclawConfig":
          return (
            <>
              {/* 二级页签：小一号、不画整行底线，挂在一级页签下面 */}
              <div className="shrink-0 px-5 pt-1">
                <PageTabs
                  size="sm"
                  aria-label={t("appPage.openclawConfig")}
                  idPrefix="openclaw-config"
                  controls="main-content"
                  value={openclawConfigTab}
                  onValueChange={setOpenclawConfigTab}
                  items={[
                    { value: "env", label: t("openclaw.env.title") },
                    { value: "tools", label: t("openclaw.tools.title") },
                    { value: "agents", label: t("openclaw.agents.title") },
                  ]}
                />
              </div>
              <div
                id="main-content"
                role="tabpanel"
                aria-labelledby={`openclaw-config-${openclawConfigTab}`}
                className="min-h-0 flex-1 overflow-y-auto scroll-stable"
              >
                {openclawConfigTab === "env" ? (
                  <EnvPanel />
                ) : openclawConfigTab === "tools" ? (
                  <ToolsPanel />
                ) : (
                  <AgentsDefaultsPanel />
                )}
              </div>
            </>
          );
        case "hermesMemory":
          return (
            <div
              id="main-content"
              className="min-h-0 flex-1 overflow-y-auto scroll-stable"
            >
              <HermesMemoryPanel onOpenWebUI={openHermesWebUI} />
            </div>
          );
        default:
          return renderProviderList();
      }
    })();

    return (
      <>
        {renderAppPageHeader()}
        {renderAppSegments()}
        {isOpenClawView && openclawHealthWarnings.length > 0 && (
          <OpenClawHealthBanner warnings={openclawHealthWarnings} />
        )}
        {body}
      </>
    );
  };

  // ─── 全局页 ─────────────────────────────────────────────────────────────

  const renderGlobalPage = () => {
    switch (currentView) {
      case "usage":
        return <UsagePage initialAppType={usageAppFilter} />;
      case "mcp":
        return (
          <UnifiedMcpPanel onInteractionBlockedChange={setMcpManagementBusy} />
        );
      case "skills":
      case "skillsDiscovery":
        // 「已安装 / 发现」合成一页；旧的 skillsDiscovery 视图直接打开「发现」段
        return (
          <UnifiedSkillsPanel
            initialView={
              currentView === "skillsDiscovery" ? "discover" : "installed"
            }
            onNavigationBlockedChange={setSkillsNavigationBusy}
          />
        );
      case "prompts":
        return (
          <div id="main-content" className="flex min-h-0 flex-1 flex-col">
            <PromptPanel
              appId={promptsApp}
              apps={PROMPT_APP_IDS.filter(
                (app) =>
                  visibleApps[app] ||
                  (app === "claude" && visibleApps["claude-desktop"]) ||
                  app === promptsApp,
              )}
              onAppChange={setPromptsApp}
              onNavigationBlockedChange={setPromptNavigationBusy}
            />
          </div>
        );
      case "sessions":
        // 页头（含 ⋯ 菜单）由会话页自己画：菜单里的操作都在页面状态里
        return (
          <SessionManagerPage
            key={sharedFeatureApp}
            appId={sharedFeatureApp}
            fromApp={activeApp}
          />
        );
      case "apps":
        return <AppsPage />;
      default:
        return null;
    }
  };

  const renderContent = () => {
    if (currentView === "home") {
      return (
        <HomeOverview
          visibleApps={visibleApps}
          activeApp={activeApp}
          onOpenApp={selectApp}
          onOpenPage={openPageFromNav}
        />
      );
    }
    return isAppPage(currentView) ? renderAppPage() : renderGlobalPage();
  };

  return (
    <WindowControlsContext.Provider
      value={useAppWindowControls ? <WindowControls /> : null}
    >
      <div className="flex h-screen flex-col overflow-hidden bg-app text-fg-1 selection:bg-selected">
        <TopBar
          view={currentView}
          overviewActive={currentView === "home" || isAppPage(currentView)}
          onHome={openHome}
          onOpenPage={(page) => openPageFromNav(page)}
          windowControls={useAppWindowControls ? <WindowControls /> : null}
          navLocked={managementBusy}
        />
        <main
          ref={mainScrollRef}
          id="content-area"
          className="relative isolate flex min-w-0 flex-1 flex-col overflow-hidden bg-app"
        >
          {showEnvBanner && envConflicts.length > 0 && (
            <EnvWarningBanner
              conflicts={envConflicts}
              onDismiss={() => {
                setShowEnvBanner(false);
                sessionStorage.setItem("env_banner_dismissed", "true");
              }}
              onDeleted={async () => {
                try {
                  const allConflicts = await checkAllEnvConflicts();
                  const flatConflicts = Object.values(allConflicts).flat();
                  setEnvConflicts(flatConflicts);
                  if (flatConflicts.length === 0) {
                    setShowEnvBanner(false);
                  }
                } catch (error) {
                  console.error(
                    "[App] Failed to re-check conflicts after deletion:",
                    error,
                  );
                }
              }}
            />
          )}
          <div
            key={
              currentView === "home"
                ? "home"
                : isAppPage(currentView)
                  ? "app"
                  : currentView
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            {renderContent()}
          </div>
        </main>
      </div>

      <ConfirmDialog
        isOpen={pendingLeave !== null}
        title={t("common.unsavedLeaveTitle")}
        message={t("common.unsavedLeaveMessage")}
        confirmText={t("common.unsavedLeaveConfirm")}
        cancelText={t("common.unsavedLeaveCancel")}
        zIndex="top"
        onConfirm={() => {
          const proceed = pendingLeave;
          setPendingLeave(null);
          discardUnsavedChanges();
          proceed?.();
        }}
        onCancel={() => setPendingLeave(null)}
      />

      <ConfirmDialog
        isOpen={launchDashboardOpen}
        title={t("hermes.webui.launchConfirmTitle")}
        message={t("hermes.webui.launchConfirmMessage")}
        confirmText={t("hermes.webui.launchConfirmAction")}
        variant="info"
        onConfirm={() => {
          setLaunchDashboardOpen(false);
          void (async () => {
            try {
              await hermesApi.launchDashboard();
              toast.success(t("hermes.webui.launching"));
            } catch (error) {
              toast.error(t("hermes.webui.launchFailed"), {
                description: extractErrorMessage(error) || undefined,
              });
            }
          })();
        }}
        onCancel={() => setLaunchDashboardOpen(false)}
      />

      <DeepLinkImportDialog />
      <FirstRunNoticeDialog />
      <WhatsNewNotice />
    </WindowControlsContext.Provider>
  );
}

export default App;
