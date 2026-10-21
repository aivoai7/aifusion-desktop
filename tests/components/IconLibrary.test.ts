import { describe, expect, it } from "vitest";
import {
  getIcon,
  getIconMetadata,
  getIconUrl,
  hasIcon,
  iconList,
  isUrlIcon,
} from "@/icons/extracted";

/**
 * 图标索引的契约测试：ProviderIcon 依赖这几个查询函数的行为，
 * 重命名文件或改映射表时先在这里失败，而不是在界面上变成破图。
 */
describe("AIFusion 图标索引", () => {
  it("内联字形按小写键查找，大小写写法都能命中", () => {
    expect(hasIcon("claude")).toBe(true);
    expect(hasIcon("Claude")).toBe(true);
    expect(getIcon("CLAUDE")).toBe(getIcon("claude"));
    const claude = getIcon("claude");
    expect(claude.length).toBeGreaterThan(50);
    expect(claude.trim().startsWith("<")).toBe(true);
  });

  it("没有登记过的名字返回空串而不是抛错", () => {
    expect(hasIcon("不存在的服务商")).toBe(false);
    expect(getIcon("不存在的服务商")).toBe("");
    expect(getIconUrl("不存在的服务商")).toBe("");
    expect(isUrlIcon("不存在的服务商")).toBe(false);
  });

  it("光栅 / 大 SVG 走 URL 分支，拿到 vite 解析出来的资源地址", () => {
    expect(isUrlIcon("teamorouter")).toBe(true);
    expect(getIconUrl("TeamoRouter")).toBeTruthy();
    expect(hasIcon("teamorouter")).toBe(true);
  });

  it("默认着色只在品牌登记过才有，未登记的交给调用方", () => {
    expect(getIconMetadata("claude")?.defaultColor).toBeTruthy();
    expect(getIconMetadata("不存在的服务商")).toBeUndefined();
  });

  it("iconList 覆盖字形与图片两条来源且已排序", () => {
    expect(iconList.length).toBeGreaterThan(100);
    expect(iconList).toContain("claude");
    expect(iconList).toContain("teamorouter");
    expect([...iconList].sort()).toEqual(iconList);
  });
});
