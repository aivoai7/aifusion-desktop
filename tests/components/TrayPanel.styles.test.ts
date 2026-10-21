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

function cardFor(platform: "windows" | "macos", dark: boolean) {
  root.classList.toggle("dark", dark);
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
  it.each([false, true])("keeps Windows cards opaque (dark=%s)", (dark) => {
    const style = cardFor("windows", dark);
    // Ink & Grid 卡面：浅墨白 / 深墨蓝，必须是实色（整窗 Acrylic 已移除）
    expect(style.backgroundColor).toBe(
      dark ? "rgb(16, 23, 37)" : "rgb(247, 249, 253)",
    );
    expect(getComputedStyle(root).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  it.each([false, true])(
    "preserves the macOS overlay on native glass (dark=%s)",
    (dark) => {
      const style = cardFor("macos", dark);
      // 玻璃在原生层，网页只叠一层很淡的墨色
      expect(style.backgroundColor).toBe(
        dark ? "rgba(16, 23, 37, 0.5)" : "rgba(244, 246, 251, 0.55)",
      );
      expect(style.boxShadow).toContain("0 8px 20px");
      expect(getComputedStyle(root).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    },
  );
});
