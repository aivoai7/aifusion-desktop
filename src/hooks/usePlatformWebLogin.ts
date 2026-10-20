import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { platformKeyApi, type PlatformLoginResult } from "@/lib/api";
import { PLATFORM_KEY_STATUS_QUERY_KEY } from "@/lib/query";
import { toast } from "@/lib/toast";
import { extractErrorMessage } from "@/utils/errorUtils";

export interface PlatformWebLoginController {
  login: () => Promise<PlatformLoginResult | null>;
  cancel: () => Promise<void>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * 网页登录 + 下发结果的共享流程。
 *
 * 设置页和平台连接卡共用：用系统默认浏览器打开官网，登录成功后自动取回 Key
 * 并下发；完成后刷新密钥状态与供应商列表，并统一提示个别应用同步失败等非致命问题。
 * 用户取消等待（返回 null）不当作错误。
 */
export function usePlatformWebLogin(): PlatformWebLoginController {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const cancel = useCallback(async () => {
    try {
      await platformKeyApi.cancelLoginWeb();
    } catch (e) {
      console.error("Failed to cancel platform web login:", e);
    }
  }, []);

  const login = useCallback(async () => {
    if (busy) {
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await platformKeyApi.loginWeb();
      if (!result) {
        return null;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: PLATFORM_KEY_STATUS_QUERY_KEY,
        }),
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
      ]);
      toast.success(t("platformKey.loggedIn"));
      if (result.syncFailures.length > 0) {
        toast.warning(
          t("platformKey.syncWarning", {
            apps: result.syncFailures.join("; "),
          }),
        );
      }
      return result;
    } catch (e) {
      const message = extractErrorMessage(e) || String(e);
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, queryClient, t]);

  return { login, cancel, busy, error, clearError };
}
