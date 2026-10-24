import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  resolve(__dirname, "../../src/tray-panel/tray-panel.css"),
  "utf8",
);
const root = document.documentElement;
const originalClassName = root.className;
const originalGlass = root.dataset.glass;
const originalLayout = root.dataset.layout;
let canvas: HTMLDivElement;

beforeAll(() => document.head.append(stylesheet));
afterAll(() => stylesheet.remove());
afterEach(() => {
  canvas.remove();
  root.className = originalClassName;
  if (originalGlass === undefined) delete root.dataset.glass;
  else root.dataset.glass = originalGlass;
  if (originalLayout === undefined) delete root.dataset.layout;
  else root.dataset.layout = originalLayout;
});

function cardFor(platform: "windows" | "macos") {
  root.classList.add("dark");
  root.dataset.glass = platform === "macos" ? "native" : "frosted";
  root.dataset.layout = platform === "macos" ? "floating" : "joined";
  canvas = document.createElement("div");
  canvas.dataset.platform = platform;
  const card = document.createElement("div");
  card.className = "tp-card";
  canvas.append(card);
  document.body.append(canvas);
  return getComputedStyle(card);
}

describe("TrayPanel backgrounds stay scoped to each platform", () => {
  it("keeps Windows cards opaque on the Night Ops card face", () => {
    const style = cardFor("windows");
    // 面板固定深色：实色卡面 #0a0f13（整窗 Acrylic 已移除，不能透出桌面内容）
    expect(style.backgroundColor).toBe("rgb(10, 15, 19)");
    expect(getComputedStyle(root).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  it("preserves the macOS overlay on native glass", () => {
    const style = cardFor("macos");
    // 玻璃在原生层，网页只叠一层很淡的墨底
    expect(style.backgroundColor).toBe("rgba(10, 15, 19, 0.55)");
    expect(style.boxShadow).toContain("0 8px 20px");
    expect(getComputedStyle(root).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });
});
