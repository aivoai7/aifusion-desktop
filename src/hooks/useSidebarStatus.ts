import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { AppId } from "@/lib/api";
import { useProxyStatusQuery } from "@/lib/query/proxy";
import { proxyApi } from "@/lib/api/proxy";
import { MODE_APP_IDS, isModeAppId } from "@/config/appConfig";
import type { AppMode } from "@/types/proxy";

export interface AppNavStatus {
  mode: AppMode;
  /** 需要处理：在路由 / 聚合，但路由服务没在运行 */
  alert: boolean;
}

/**
 * 客户端的状态：走没走本机路由、路由服务停了没有。
 * 名字沿用「sidebar」，但侧栏已经去掉——现在只有首页九宫格读它。
 */
export function useSidebarStatus() {
  const { data: proxyStatus } = useProxyStatusQuery();
  // 和应用页的模式行同一份数据（["providers", app, "mode"]），进出模式时一起刷新
  const modeQueries = useQueries({
    queries: MODE_APP_IDS.map((app) => ({
      queryKey: ["providers", app, "mode"],
      queryFn: () => proxyApi.getAppMode(app),
    })),
  });

  const serviceRunning = proxyStatus?.running ?? false;
  const modes = MODE_APP_IDS.map((_, index) => modeQueries[index]?.data?.mode);
  const modeKey = modes.join(",");

  const appStatus = useMemo(() => {
    return (app: AppId): AppNavStatus => {
      if (!isModeAppId(app)) {
        return { mode: "direct", alert: false };
      }
      const mode = modes[MODE_APP_IDS.indexOf(app)] ?? "direct";
      return {
        mode,
        alert:
          mode !== "direct" && proxyStatus !== undefined && !serviceRunning,
      };
    };
    // modes 是每次渲染新建的数组，用 modeKey 判断变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxyStatus, serviceRunning, modeKey]);

  return { appStatus };
}
