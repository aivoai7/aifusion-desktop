/**
 * 旧版（cc-switch 时期）的本地存储键 → AIFusion 键。
 *
 * 只迁一次：新键已有值时以新键为准，随后删掉旧键。迁移失败不影响启动，
 * 用户最多丢一次界面偏好，不会影响配置或密钥。
 */
const KEY_PAIRS: Array<[legacy: string, current: string]> = [
  ["cc-switch-theme", "aifusion-theme"],
  ["cc-switch-last-view", "aifusion-last-view"],
  ["cc-switch-last-app", "aifusion-last-app"],
  [
    "cc-switch.sessionReader.expandTimelines",
    "aifusion.sessionReader.expandTimelines",
  ],
  ["cc-switch.sessionReader.outline", "aifusion.sessionReader.outline"],
  ["cc-switch.sessionManager.groupMode", "aifusion.sessionManager.groupMode"],
  [
    "cc-switch.sessionManager.expandedProjects",
    "aifusion.sessionManager.expandedProjects",
  ],
  ["cc-switch.usage.tab", "aifusion.usage.tab"],
  ["cc-switch.usage.rangePreset", "aifusion.usage.rangePreset"],
  ["cc-switch.usage.trendMetric", "aifusion.usage.trendMetric"],
  ["cc-switch.usage.heatmapMetric", "aifusion.usage.heatmapMetric"],
  ["cc-switch:skills:install-to", "aifusion:skills:install-to"],
  ["ccswitch:update:dismissedVersion", "aifusion:update:dismissedVersion"],
  ["cc-switch-tray-tab", "aifusion-tray-tab"],
  ["cc-switch-tray-usage-range", "aifusion-tray-usage-range"],
  ["cc-switch-tray-usage-metric", "aifusion-tray-usage-metric"],
];

const LEGACY_CACHE_PREFIX = "cc-switch-cache:";
const CURRENT_CACHE_PREFIX = "aifusion-cache:";

export function migrateLegacyStorage(): void {
  try {
    for (const [legacy, current] of KEY_PAIRS) {
      const value = localStorage.getItem(legacy);
      if (value == null) continue;
      if (localStorage.getItem(current) == null) {
        localStorage.setItem(current, value);
      }
      localStorage.removeItem(legacy);
    }

    // 读数缓存可再生，迁过去只是少一次冷启动
    const cacheKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_CACHE_PREFIX)) cacheKeys.push(key);
    }
    for (const legacy of cacheKeys) {
      const current = `${CURRENT_CACHE_PREFIX}${legacy.slice(
        LEGACY_CACHE_PREFIX.length,
      )}`;
      const value = localStorage.getItem(legacy);
      if (value != null && localStorage.getItem(current) == null) {
        localStorage.setItem(current, value);
      }
      localStorage.removeItem(legacy);
    }
  } catch {
    // 隐私模式、配额满等情况读不到存储也不该挡住启动
  }
}
