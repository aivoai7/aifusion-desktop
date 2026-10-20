import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { Loader2, LogIn, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  PLATFORM_KEY_STATUS_QUERY_KEY,
  usePlatformKeyStatusQuery,
  useSettingsQuery,
} from "@/lib/query";
import { settingsApi } from "@/lib/api";
import { markSeen } from "@/lib/whatsNew";
import { usePlatformWebLogin } from "@/hooks/usePlatformWebLogin";

/**
 * 首次运行引导。
 *
 * - 还没有平台密钥：引导用户打开平台官网登录，客户端自动取回 Key 并下发到
 *   所有客户端，用户不接触 API Key。
 * - 已有密钥但没看过欢迎提示：展示原有的平台说明。
 *
 * 未取到密钥时关闭弹窗只在本会话生效，下次启动仍会提示——没有 Key 时
 * 所有客户端调用都会 401。
 */
export function FirstRunNoticeDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const { data: keyStatus } = usePlatformKeyStatusQuery();
  const webLogin = usePlatformWebLogin();

  const [dismissed, setDismissed] = useState(false);

  const needsKey = keyStatus != null && !keyStatus.configured;
  const needsWelcome =
    keyStatus?.configured === true &&
    settings != null &&
    settings.firstRunNoticeConfirmed !== true;
  const isOpen = !dismissed && (needsKey || needsWelcome);

  const handleAcknowledge = async () => {
    if (!settings) {
      setDismissed(true);
      return;
    }
    try {
      const { webdavSync: _, ...rest } = settings;
      // 新装用户看的就是新界面、新版本，「界面改版了」弹窗和更新摘要一并记成已看过
      const version = await getVersion().catch(() => undefined);
      await settingsApi.save({
        ...rest,
        firstRunNoticeConfirmed: true,
        newLayoutNoticeConfirmed: true,
        whatsNewSeenVersion: markSeen(settings.whatsNewSeenVersion, version),
      });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      console.error("Failed to save firstRunNoticeConfirmed:", e);
    } finally {
      setDismissed(true);
    }
  };

  const finishLogin = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: PLATFORM_KEY_STATUS_QUERY_KEY,
      }),
      queryClient.invalidateQueries({ queryKey: ["providers"] }),
    ]);
    await handleAcknowledge();
  };

  // 用系统默认浏览器打开平台官网，登录成功后自动回传 Key。
  const handleWebLogin = async () => {
    const result = await webLogin.login();
    if (result) {
      await finishLogin();
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (webLogin.busy) {
            void webLogin.cancel();
          }
          void handleAcknowledge();
        }
      }}
    >
      <DialogContent className="max-w-md" zIndex="top">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {needsKey ? (
              <LogIn className="h-5 w-5 text-fg-1" />
            ) : (
              <Sparkles className="h-5 w-5 text-fg-1" />
            )}
            {needsKey
              ? t("firstRunNotice.keyTitle")
              : t("firstRunNotice.title")}
          </DialogTitle>
        </DialogHeader>

        {needsKey ? (
          <div className="space-y-3 px-6 py-5">
            <DialogDescription className="whitespace-pre-line leading-relaxed">
              {t("firstRunNotice.keyBody")}
            </DialogDescription>
            <Button
              variant="neutral"
              className="w-full"
              onClick={() =>
                void (webLogin.busy ? webLogin.cancel() : handleWebLogin())
              }
            >
              {webLogin.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {webLogin.busy
                ? t("platformKey.cancelWaiting", {
                    defaultValue: "取消等待",
                  })
                : t("firstRunNotice.webLogin")}
            </Button>
            <p className="text-caption text-fg-2">
              {webLogin.busy
                ? t("firstRunNotice.webLoginWaiting")
                : t("firstRunNotice.webLoginHint")}
            </p>
            {webLogin.error && (
              <p className="text-caption text-danger">{webLogin.error}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3 px-6 py-5">
            <DialogDescription className="whitespace-pre-line leading-relaxed">
              {t("firstRunNotice.bodyDefault")}
            </DialogDescription>
            <DialogDescription className="whitespace-pre-line leading-relaxed">
              {t("firstRunNotice.bodyOfficial")}
            </DialogDescription>
          </div>
        )}

        <DialogFooter>
          {needsKey ? (
            <Button
              variant="quiet"
              onClick={() => {
                if (webLogin.busy) {
                  void webLogin.cancel();
                }
                void handleAcknowledge();
              }}
            >
              {t("firstRunNotice.keySkip")}
            </Button>
          ) : (
            <Button onClick={() => void handleAcknowledge()}>
              {t("firstRunNotice.confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
