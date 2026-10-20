/**
 * 是否在应用页展示供应商 / 渠道列表。
 *
 * 这个构建只对接 AIFusion 自有平台：供应商与渠道由平台统一下发，客户端
 * 不展示渠道卡片，也不提供手动添加。旧的渠道列表实现仍保留在
 * `App.tsx` 的 `renderProviderChannels` 里，需要放开时把这个开关改成
 * true 即可（集成测试会 mock 成 true 继续覆盖那条路径）。
 */
export const SHOW_PROVIDER_CHANNELS = false;
