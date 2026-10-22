import React, { createContext, useContext, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

type Theme = "light" | "dark" | "system";

interface ThemeProviderProps {
  children: React.ReactNode;
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

/**
 * 桌面端固定 Mission Control 深色：界面里没有浅色/跟随系统开关，
 * 残留的 light / system 存储值也不再读取（浅色 token 已被 index.css 覆盖掉，
 * 读了也只会让原生标题栏和面板跟内容脱节）。
 *
 * 这里只剩两件事：
 * 1. 把 <html> 钉在 dark —— 首帧由 src/index.html 的内联脚本负责，这里兜底；
 * 2. 让原生窗口（Windows / macOS 标题栏）跟着深色，避免墨底内容配亮色窗框。
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  React.useEffect(() => {
    const root = window.document.documentElement;
    root.classList.add("dark");
    root.classList.remove("light");
  }, []);

  React.useEffect(() => {
    invoke("set_window_theme", { theme: "dark" }).catch((e) => {
      // 不在 Tauri 环境（测试、纯浏览器预览）里忽略
      console.debug("Failed to set native window theme:", e);
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: "dark",
      setTheme: () => {
        // 固定深色：保留签名兼容旧调用点，不做任何事
      },
    }),
    [],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
