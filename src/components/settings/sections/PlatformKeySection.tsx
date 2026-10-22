import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsBlock } from "@/components/settings/SettingsLayout";
import { platformKeyApi } from "@/lib/api";
import {
  PLATFORM_KEY_STATUS_QUERY_KEY,
  usePlatformKeyStatusQuery,
} from "@/lib/query";
import { usePlatformWebLogin } from "@/hooks/usePlatformWebLogin";
import { toast } from "@/lib/toast";
import { extractErrorMessage } from "@/utils/errorUtils";

/**
 * 设置 → 平台连接。
 *
 * 主路径是「网页登录」：打开平台官网，用户在官网里完成登录，成功后客户端
 * 自动取回一把可用的 API Key，存进本机 SQLite 并立即下发到所有客户端页签
 * 的「AIFusion 平台」供应商。官网账号与 Cookie 都不会保存在本机。
 */
export function PlatformKeySection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status, isLoading } = usePlatformKeyStatusQuery();
  const webLogin = usePlatformWebLogin();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const configured = status?.configured === true;
  const displayError = error ?? webLogin.error;

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await platformKeyApi.clear();
      await queryClient.invalidateQueries({
        queryKey: PLATFORM_KEY_STATUS_QUERY_KEY,
      });
      setClearOpen(false);
      toast.success(t("platformKey.cleared"));
    } catch (e) {
      setError(extractErrorMessage(e) || String(e));
    } finally {
      setBusy(false);
    }
  };

  const statusText = isLoading
    ? t("platformKey.loading")
    : configured
      ? t("platformKey.configured")
      : t("platformKey.notConfigured");

  const sourceText =
    status?.source === "environment"
      ? t("platformKey.sourceEnvironment")
      : status?.source === "user"
        ? t("platformKey.sourceUser")
        : null;

  const loginButtonLabel = webLogin.busy
    ? t("platformKey.cancelWaiting", { defaultValue: "取消等待" })
    : configured
      ? t("platformKey.relogin")
      : t("platformKey.webLogin");

  return (
    <>
      <SettingsBlock
        title={t("platformKey.title")}
        help={{ title: t("platformKey.title"), body: t("platformKey.help") }}
      >
        <div className="overflow-hidden rounded-[4px] border border-hairline bg-surface">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
            <Chip tone={configured ? "ok" : "warn"} dot>
              {statusText}
            </Chip>
            <span className="min-w-0 flex-1">
              <span className="block text-caption text-fg-1">
                {t("platformKey.label")}
              </span>
              <span className="mt-0.5 block text-badge text-fg-3">
                {sourceText
                  ? `${sourceText} · ${t("platformKey.webLoginHint")}`
                  : t("platformKey.webLoginHint")}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Button
                size="compact"
                onClick={() =>
                  void (webLogin.busy ? webLogin.cancel() : webLogin.login())
                }
                disabled={!webLogin.busy && busy}
              >
                {webLogin.busy ? (
                  <X className="h-3.5 w-3.5" />
                ) : (
                  <LogIn className="h-3.5 w-3.5" />
                )}
                {loginButtonLabel}
              </Button>
              {configured && (
                <Button
                  variant="quiet"
                  size="compact"
                  onClick={() => setClearOpen(true)}
                  disabled={busy || webLogin.busy}
                >
                  {t("platformKey.clear")}
                </Button>
              )}
            </span>
          </div>
          {webLogin.busy || displayError ? (
            <p
              className={
                displayError
                  ? "border-t border-hairline px-4 py-2 text-caption text-danger"
                  : "border-t border-hairline px-4 py-2 text-caption text-fg-3"
              }
            >
              {webLogin.busy
                ? t("platformKey.webLoginWaiting")
                : displayError}
            </p>
          ) : null}
        </div>
      </SettingsBlock>

      <ConfirmDialog
        isOpen={clearOpen}
        title={t("platformKey.clearTitle")}
        message={t("platformKey.clearMessage")}
        confirmText={t("platformKey.clear")}
        pending={busy}
        onConfirm={() => void handleClear()}
        onCancel={() => setClearOpen(false)}
      />
    </>
  );
}
