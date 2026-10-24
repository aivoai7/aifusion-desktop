import { useEffect, useState } from "react";
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
import { BrandMark } from "@/components/shell/BrandMark";
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
 * - 还没有平台密钥：整屏登录页（Night Ops）。左边说清楚「装好即用、密钥只留在本机」，
 *   右边只做一件事——用浏览器登录。客户端自动取回 Key 并下发到所有客户端，
 *   用户不接触 API Key。
 * - 已有密钥但没看过欢迎提示：展示原来的平台说明弹窗。
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
  const [version, setVersion] = useState("");

  useEffect(() => {
    void getVersion()
      .then((value) => setVersion(value))
      .catch(() => undefined);
  }, []);

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
      const currentVersion = version || (await getVersion().catch(() => undefined));
      await settingsApi.save({
        ...rest,
        firstRunNoticeConfirmed: true,
        newLayoutNoticeConfirmed: true,
        whatsNewSeenVersion: markSeen(
          settings.whatsNewSeenVersion,
          currentVersion,
        ),
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

  const handleClose = () => {
    if (webLogin.busy) {
      void webLogin.cancel();
    }
    void handleAcknowledge();
  };

  if (!needsKey) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-md" zIndex="top">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-fg-1" />
              {t("firstRunNotice.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <DialogDescription className="whitespace-pre-line leading-relaxed">
              {t("firstRunNotice.bodyDefault")}
            </DialogDescription>
            <DialogDescription className="whitespace-pre-line leading-relaxed">
              {t("firstRunNotice.bodyOfficial")}
            </DialogDescription>
          </div>
          <DialogFooter>
            <Button onClick={() => void handleAcknowledge()}>
              {t("firstRunNotice.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const facts = [
    {
      title: t("firstRunNotice.loginFact1Title", {
        defaultValue: "浏览器完成登录",
      }),
      desc: t("firstRunNotice.loginFact1Desc", {
        defaultValue: "系统默认浏览器打开官网，复用已有登录态",
      }),
    },
    {
      title: t("firstRunNotice.loginFact2Title", {
        defaultValue: "密钥只留在本机",
      }),
      desc: t("firstRunNotice.loginFact2Desc", {
        defaultValue: "写入本地加密存储，界面与日志都不显示明文",
      }),
    },
    {
      title: t("firstRunNotice.loginFact3Title", {
        defaultValue: "十个客户端一次对齐",
      }),
      desc: t("firstRunNotice.loginFact3Desc", {
        defaultValue: "Claude Code / Codex / Gemini CLI / OpenCode 等",
      }),
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent variant="fullscreen" zIndex="top" className="p-0">
        <DialogTitle className="sr-only">
          {t("firstRunNotice.keyTitle")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("firstRunNotice.keyBody")}
        </DialogDescription>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[1.05fr_.95fr]">
          {/* ── 左：品牌与三件事 ───────────────────────────────────── */}
          <div
            className="relative flex min-h-[560px] flex-col justify-between overflow-hidden border-e border-hairline px-12 py-12 xl:px-14 xl:py-14"
            style={{
              backgroundImage:
                "radial-gradient(600px 320px at 0% 100%, rgba(61,219,208,.10), transparent 65%), linear-gradient(180deg, rgba(10,15,19,.55), transparent)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <BrandMark size={30} />
              <span className="af-kicker flex items-center gap-2">
                <span className="h-[5px] w-[5px] rounded-full bg-action shadow-[0_0_10px_var(--action-bg)]" />
                {t("firstRunNotice.loginEyebrow", {
                  defaultValue: "Desktop client",
                })}
              </span>
            </div>

            <div className="max-w-[520px] py-10">
              <h2 className="m-0 text-[38px] font-semibold leading-[1.12] tracking-[-0.035em] text-fg-1 xl:text-[40px]">
                {t("firstRunNotice.loginHeadline1", {
                  defaultValue: "装好即用，",
                })}
                <br />
                <em className="not-italic text-action-text">
                  {t("firstRunNotice.loginHeadline2", {
                    defaultValue: "密钥自动到位",
                  })}
                </em>
                。
              </h2>
              <p className="mt-4 max-w-[440px] text-body leading-6 text-fg-2">
                {t("firstRunNotice.loginLead", {
                  defaultValue:
                    "用浏览器登录一次 AIFusion 平台，客户端会自动取回密钥并写进十个 AI 工具的配置——不需要复制粘贴，也不需要在每个工具里填一遍。",
                })}
              </p>
              <div className="mt-7 max-w-[460px] border-t border-hairline">
                {facts.map((fact, index) => (
                  <div
                    key={fact.title}
                    className="flex gap-3 border-b border-hairline py-3.5"
                  >
                    <span className="af-num shrink-0 pt-0.5 text-[10px] text-fg-3">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-fg-1">
                        {fact.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-fg-3">
                        {fact.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.14em] text-fg-3">
              <span>
                {t("firstRunNotice.loginFooter", {
                  defaultValue: "Secure loopback · one-time state",
                })}
              </span>
              <span>{version ? `v${version}` : "—"}</span>
            </div>
          </div>

          {/* ── 右：唯一的动作 ─────────────────────────────────────── */}
          <div className="relative flex items-center justify-center px-7 py-12 xl:px-12">
            <div
              className="w-full max-w-[392px] rounded-dialog border border-hairline-strong p-6"
              style={{
                background:
                  "linear-gradient(180deg, rgba(18,27,32,.75), rgba(10,15,19,.92))",
              }}
            >
              <h3 className="m-0 text-[17px] font-semibold tracking-[-0.01em] text-fg-1">
                {t("firstRunNotice.keyTitle")}
              </h3>
              <p className="mt-1.5 text-[11.5px] leading-5 text-fg-3">
                {t("firstRunNotice.loginCardHint", {
                  defaultValue: "登录后会自动下发密钥到本机，无需手动填写。",
                })}
              </p>

              <Button
                variant="solid"
                className="mt-5 h-10 w-full justify-center text-[13px]"
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
                  : t("firstRunNotice.webLogin", {
                      defaultValue: "用浏览器登录",
                    })}
              </Button>

              <div className="my-4 h-px bg-hairline" />

              <Button
                variant="neutral"
                className="h-9 w-full justify-center"
                onClick={handleClose}
              >
                {t("firstRunNotice.keySkip", { defaultValue: "稍后设置" })}
              </Button>

              {(webLogin.busy || webLogin.error) && (
                <p
                  className={
                    "mt-3 text-[11px] leading-5 " +
                    (webLogin.error ? "text-danger" : "text-fg-2")
                  }
                >
                  {webLogin.busy
                    ? t("firstRunNotice.webLoginWaiting", {
                        defaultValue:
                          "已打开系统浏览器，请在浏览器中完成登录；完成后会自动回到 AIFusion。",
                      })
                    : webLogin.error}
                </p>
              )}

              <div className="mt-3 flex gap-2 text-[10.5px] leading-[1.65] text-fg-3">
                <span aria-hidden="true" className="shrink-0">
                  ⓘ
                </span>
                <span>
                  {t("firstRunNotice.loginNote", {
                    defaultValue:
                      "浏览器登录成功后会自动回到这里。密钥不会出现在日志、截图或任何网络地址里。",
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
