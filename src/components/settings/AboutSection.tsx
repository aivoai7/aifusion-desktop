import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { getVersion } from "@tauri-apps/api/app";
import { settingsApi } from "@/lib/api";
import { useUpdate } from "@/contexts/UpdateContext";
import { Badge } from "@/components/ui/badge";
import { SettingsBlock } from "@/components/settings/SettingsLayout";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";
import { WHATS_NEW_ENTRIES, entriesUpTo } from "@/lib/whatsNew";
import appIcon from "@/assets/icons/app-icon.png";
import { extractErrorMessage } from "@/utils/errorUtils";

interface AboutSectionProps {
  isPortable: boolean;
}

// 应用自身版本（getVersion，本地毫秒级、无网络）也缓存一份，纯为重挂时免去 loading 闪烁。
let appVersionCache: string | null = null;

/**
 * 设置 → 关于：版本、便携模式、检查更新 / 安装并重启。
 * 命令行应用的安装与升级在独立的「应用」页。
 */
export function AboutSection({ isPortable }: AboutSectionProps) {
  const { t } = useTranslation();
  // 惰性初始化自模块缓存：重挂时首帧即渲染上次的值，避免 loading 闪烁；首次挂载缓存
  // 为空则回退到原始初值（null / loading）。
  const [version, setVersion] = useState<string | null>(() => appVersionCache);
  const [isLoadingVersion, setIsLoadingVersion] = useState(
    () => appVersionCache === null,
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const recentEntries = useMemo(
    () => (version ? entriesUpTo(WHATS_NEW_ENTRIES, version) : []),
    [version],
  );

  const { hasUpdate, updateInfo, resetDismiss, isChecking } = useUpdate();

  useEffect(() => {
    let active = true;
    const loadAppVersion = async () => {
      try {
        const appVersion = await getVersion();
        appVersionCache = appVersion;
        if (active) {
          setVersion(appVersion);
        }
      } catch (error) {
        console.error("[AboutSection] Failed to load app version", error);
        if (active) {
          setVersion(null);
        }
      } finally {
        if (active) {
          setIsLoadingVersion(false);
        }
      }
    };

    void loadAppVersion();
    return () => {
      active = false;
    };
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    if (hasUpdate) {
      if (isPortable) {
        try {
          await settingsApi.openPortableUpdateDownload(
            updateInfo?.availableVersion ?? "",
          );
        } catch (error) {
          console.error("[AboutSection] Portable update failed", error);
        }
        return;
      }

      setIsDownloading(true);
      try {
        resetDismiss();
        const installed = await settingsApi.installUpdateAndRestart();
        if (!installed) {
          toast.success(t("settings.upToDate"), { closeButton: true });
        }
      } catch (error) {
        console.error("[AboutSection] Update failed", error);
        toast.error(t("settings.updateFailed"), {
          description: extractErrorMessage(error) || undefined,
          closeButton: true,
        });
        try {
          await settingsApi.checkUpdates();
        } catch (fallbackError) {
          console.error(
            "[AboutSection] Failed to open fallback updater",
            fallbackError,
          );
        }
      } finally {
        setIsDownloading(false);
      }
      return;
    }

    try {
      // 桌面版由 AIFusion 平台分发，没有配置 Tauri updater endpoint。
      // 这里直接打开平台下载页，避免调用注定失败的更新检查。
      await settingsApi.checkUpdates();
      toast.success(t("settings.checkUpdateOpened"), { closeButton: true });
    } catch (error) {
      console.error("[AboutSection] Check update failed", error);
      toast.error(t("settings.checkUpdateFailed"), {
        description: extractErrorMessage(error) || undefined,
        closeButton: true,
      });
    }
  }, [
    hasUpdate,
    isPortable,
    resetDismiss,
    t,
    updateInfo?.availableVersion,
  ]);

  const displayVersion = version ?? t("common.unknown");

  return (
    <SettingsBlock
      title={t("settings.sections.about", { defaultValue: "关于" })}
    >
      <div className="overflow-hidden rounded-[4px] border border-hairline bg-surface">
        <div className="flex flex-wrap items-start gap-4 px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border border-hairline bg-app">
            <img src={appIcon} alt="" className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="af-kicker">
              {t("settings.desktopClient", { defaultValue: "Desktop client" })}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-title text-fg-1">AIFusion</span>
              {isPortable && (
                <Badge
                  variant="secondary"
                  className="gap-1 px-1.5 py-0 text-badge"
                >
                  <Info className="h-3 w-3" />
                  {t("settings.portableMode")}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-fg-2">
              {isLoadingVersion ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="af-num">
                  {t("common.version", { defaultValue: "版本" })} v
                  {displayVersion}
                </span>
              )}
              <span aria-hidden="true" className="h-3 w-px bg-hairline" />
              <span>Windows · Tauri + WebView</span>
            </div>
          </div>
          <Button
            type="button"
            variant={hasUpdate ? "solid" : "neutral"}
            size="regular"
            onClick={handleCheckUpdate}
            disabled={isChecking || isDownloading}
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("settings.updating")}
              </>
            ) : hasUpdate ? (
              <>
                <Download className="h-3.5 w-3.5" />
                {t("settings.updateTo", {
                  version: updateInfo?.availableVersion ?? "",
                })}
              </>
            ) : isChecking ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                {t("settings.checking")}
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                {t("settings.checkForUpdates")}
              </>
            )}
          </Button>
        </div>

        {hasUpdate && updateInfo && (
          <div className="space-y-1 border-t border-hairline px-5 py-4 text-body">
            <p className="font-medium text-fg-1">
              {t("settings.updateAvailable", {
                version: updateInfo.availableVersion,
              })}
            </p>
            {updateInfo.notes && (
              <p className="line-clamp-3 text-fg-2">{updateInfo.notes}</p>
            )}
            {isPortable && (
              <p className="text-fg-2">{t("settings.portableUpdateHint")}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline px-5 py-3">
          <span className="text-badge text-fg-3">
            {t("settings.aboutHint", {
              defaultValue:
                "模型、密钥与用量由 AIFusion 平台统一管理，本机只保留登录凭据。",
            })}
          </span>
          {recentEntries.length > 0 && (
            <Button
              type="button"
              variant="quiet"
              size="compact"
              className="ms-auto"
              onClick={() => setWhatsNewOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("whatsNew.recentTitle")}
            </Button>
          )}
        </div>
      </div>

      <WhatsNewDialog
        open={whatsNewOpen}
        onClose={() => setWhatsNewOpen(false)}
        entries={recentEntries}
      />
    </SettingsBlock>
  );
}
