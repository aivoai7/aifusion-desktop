/**
 * 平台在部分客户端（如 Claude Desktop）里用 `__AIFUSION_MODEL__` 这类占位符，
 * 由写入本机配置时替换成真实模型名。界面直接展示占位符会显得像配置坏了，
 * 所以统一在渲染前过滤掉，回落到「由平台下发」。
 */
const PLACEHOLDER_MODEL_ID = /^__[A-Z0-9_]+__$/;

export function isPlaceholderModelId(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && PLACEHOLDER_MODEL_ID.test(value.trim());
}

/** 能安全展示的模型 ID；占位符或空值返回 null。 */
export function visibleModelId(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return isPlaceholderModelId(value) ? null : value;
}
