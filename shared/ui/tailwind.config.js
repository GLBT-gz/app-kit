/** @type {import('tailwindcss').Config} */
export default {
  content: ["../../projects/*/src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  // 禁用 Preflight，避免覆盖原有基础样式
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        background: "var(--bg-app)",
        foreground: "var(--text-primary)",
        topbar: "var(--bg-topbar)",
        nav: "var(--bg-nav)",
        content: "var(--bg-content)",
        secondary: "var(--text-secondary)",
        muted: {
          DEFAULT: "var(--text-secondary)",
          foreground: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          light: "var(--accent-light)",
        },
        success: "var(--success)",
        error: "var(--error)",
        border: "var(--border)",
        input: "var(--border-input)",
        card: {
          DEFAULT: "var(--bg-card)",
          hover: "var(--bg-card-hover)",
        },
        badge: "var(--bg-badge)",
        label: "var(--text-label)",
        "btn-text": "var(--btn-text)",
      },
      fontFamily: {
        mono: ['"Maple Mono"', "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
