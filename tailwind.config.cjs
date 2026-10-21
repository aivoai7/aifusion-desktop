/**
 * AIFusion · Ink & Grid —— Tailwind 主题
 *
 * 全部颜色都指到 src/index.css 的 CSS 变量上，换肤只改变量、不改这里。
 * 命名沿用既有工具类（bg-surface / text-fg-1 / bg-action / rounded-panel …），
 * 这样 166 个组件能整体换肤；新加的 hairline / azure / heat 是给重做中的
 * 页面用的原生名。
 *
 * 注意：纯 var() 颜色不支持 `/50` 这类透明度修饰符，需要透明度时改用
 * color-mix 或 index.css 里预先算好的 *-soft 变量。
 */
module.exports = {
  content: ["./src/index.html", "./src/tray-panel.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", ".dark"],
  theme: {
    extend: {
      // 禁用态统一 0.45，和 [aria-disabled] 的观感对齐
      opacity: { 45: "0.45" },

      colors: {
        // shadcn 兼容层（Radix 组件与旧代码还在用 hsl 三元组）
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",

        // Ink & Grid 表面：应用底 / 侧栏 / 弱底 / 选中底 / 卡片
        app: "var(--bg-app)",
        sidebar: "var(--bg-sidebar)",
        subtle: "var(--bg-subtle)",
        selected: "var(--bg-selected)",
        surface: "var(--bg-card)",
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
        "border-strong": "var(--border-strong)",

        // 三档文字
        fg: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
        },

        // azure 操作色族（替换上游的橙）
        action: {
          DEFAULT: "var(--action-bg)",
          fg: "var(--action-fg)",
          hover: "var(--action-hover)",
          text: "var(--action-text)",
          soft: "var(--action-soft)",
        },
        azure: {
          300: "#8fb4ff",
          400: "#7aa8ff",
          500: "#4c8dff",
          600: "#2f6ae0",
          700: "#2456bd",
          800: "#1b4093",
        },

        inverse: {
          DEFAULT: "var(--inverse-bg)",
          fg: "var(--inverse-fg)",
          hover: "var(--inverse-hover)",
        },
        overlay: "var(--overlay)",
        "control-off": "var(--control-off)",

        // 连接形态：直连 / 本机路由 / 聚合
        direct: {
          DEFAULT: "var(--direct-fill)",
          text: "var(--direct-text)",
          soft: "var(--direct-soft)",
          solid: "var(--direct-solid)",
          on: "var(--direct-on)",
          border: "var(--direct-border)",
        },
        route: {
          DEFAULT: "var(--route-fill)",
          text: "var(--route-text)",
          soft: "var(--route-soft)",
          solid: "var(--route-solid)",
          on: "var(--route-on)",
          border: "var(--route-border)",
        },
        stack: {
          DEFAULT: "var(--stack-fill)",
          text: "var(--stack-text)",
          soft: "var(--stack-soft)",
          solid: "var(--stack-solid)",
          on: "var(--stack-on)",
          border: "var(--stack-border)",
        },

        success: {
          DEFAULT: "var(--success)",
          text: "var(--success-text)",
          soft: "var(--success-soft)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          text: "var(--warning-text)",
          soft: "var(--warning-soft)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          text: "var(--danger-text)",
          soft: "var(--danger-soft)",
        },

        // 会话阅读页的 Agent 主题色：text-agent-claude / border-agent-gemini …
        agent: {
          claude: "var(--agent-claude)",
          codex: "var(--agent-codex)",
          gemini: "var(--agent-gemini)",
          opencode: "var(--agent-opencode)",
          pi: "var(--agent-pi)",
          generic: "var(--agent-generic)",
        },
        diff: {
          add: "var(--diff-add-bg)",
          del: "var(--diff-del-bg)",
        },

        // 图表与热力图
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          grid: "var(--chart-grid)",
        },
        heat: {
          1: "var(--heat-1)",
          2: "var(--heat-2)",
          3: "var(--heat-3)",
          4: "var(--heat-4)",
        },

        // 少数写死色值的第三方对齐点（recharts / 品牌字块）
        blue: {
          400: "#7aa8ff",
          500: "#4c8dff",
          600: "#2f6ae0",
        },
        gray: {
          50: "#f4f6fb",
          100: "#eef2f9",
          200: "#e2eaf8",
          300: "#cfd8e8",
          400: "#9aa6bf",
          500: "#66738f",
          600: "#4c5871",
          700: "#2b3852",
          800: "#1a2437",
          900: "#101725",
          950: "#0a0e17",
        },
        green: {
          100: "var(--success-soft)",
          500: "var(--success)",
        },
        red: {
          100: "var(--danger-soft)",
          500: "var(--danger)",
        },
        amber: {
          100: "var(--warning-soft)",
          500: "var(--warning)",
        },
      },

      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        // 旧类名保留为别名，页面重做完成后统一删掉
        "v7-sm": "var(--shadow-sm)",
        "v7-md": "var(--shadow-md)",
        "v7-lg": "var(--shadow-lg)",
        // Ink & Grid：卡片只在内高光 + 落影，弹层多一层发丝外描边
        "af-pop": "var(--shadow-lg), 0 0 0 1px var(--hairline)",
        "af-rail": "inset 2px 0 0 0 var(--action-bg)",
      },

      // 只写 border / divide 不带颜色时用主题边框色；不设的话 Tailwind 默认浅灰，深色下成了白线
      borderColor: {
        DEFAULT: "var(--hairline)",
      },

      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "10px",
        // 控件 6px、卡片 10px、弹层 14px、对话框 14px
        control: "6px",
        panel: "10px",
        dialog: "14px",
      },

      fontSize: {
        // 字号角色：小字收紧、数字等宽，标题靠字重与负字距分层
        badge: ["11px", { lineHeight: "15px", fontWeight: "500" }],
        caption: ["12px", { lineHeight: "18px" }],
        body: ["13px", { lineHeight: "20px" }],
        strong: ["13.5px", { lineHeight: "20px", fontWeight: "550" }],
        section: ["13px", { lineHeight: "20px", fontWeight: "590", letterSpacing: "-0.01em" }],
        title: ["15px", { lineHeight: "22px", fontWeight: "600", letterSpacing: "-0.015em" }],
        page: ["19px", { lineHeight: "26px", fontWeight: "600", letterSpacing: "-0.022em" }],
        metric: ["26px", { lineHeight: "32px", fontWeight: "600", letterSpacing: "-0.03em" }],
      },

      fontFamily: {
        // 界面字：Windows 走 Segoe UI Variable，中文走微软雅黑 UI
        sans: [
          '"Segoe UI Variable Text"',
          '"Segoe UI"',
          "Inter",
          '"Microsoft YaHei UI"',
          '"Microsoft YaHei"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Helvetica Neue"',
          "Arial",
          "system-ui",
          "sans-serif",
        ],
        // 数字与代码：KPI、表格、模型 ID 全部等宽 tabular
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          '"Cascadia Mono"',
          "Consolas",
          '"Liberation Mono"',
          "Menlo",
          "monospace",
        ],
      },

      animation: {
        "fade-in": "fadeIn 0.16s ease-out",
        "slide-up": "slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slideDown 0.18s ease-out",
        "slide-in-right": "slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "accordion-down": "accordion-down 0.18s ease-out",
        "accordion-up": "accordion-up 0.14s ease-in",
      },

      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideDown: {
          "0%": { transform: "translateY(-100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideInRight: {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
    },
  },
  // animate-in / fade-in-0 / zoom-in-95 …：Radix 浮层（菜单、弹层、对话框、提示）的进出场
  plugins: [require("tailwindcss-animate")],
};
