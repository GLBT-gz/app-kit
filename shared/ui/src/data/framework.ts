// ============================================================
// 框架级数据注册
//
// 模板（AppLayout）自身管理的公共数据，全局注册到 DataManager。
// 各项目无需在 data.ts 中重复声明。
//
// 包括：
// - 导航位置（上次访问的页面路径）
// - 侧边栏宽度（设置面板）
// - 快捷键映射
// - 主题配置
// ============================================================

import { registerDataItems, registerRawDataItem } from "./registry";

// 模块加载时自动注册，无需手动调用
registerDataItems(
  "1.0.0",
  {
    layout: {
      label: "布局与导航",
      onDelete: "allowed",
    },
    cache: {
      label: "缓存",
      onDelete: "allowed",
    },
    preference: {
      label: "用户偏好",
      onDelete: "warn",
    },
  },
  {
    /** 导航位置路径，如 ['设置','数据管理'] */
    "core-nav-location": {
      storage: "localStorage",
      category: "layout",
      desc: "上次访问的页面路径",
      default: [] as string[],
    },
    /** 设置面板侧边栏宽度 */
    "core-sidebar-width": {
      storage: "localStorage",
      category: "layout",
      desc: "设置面板侧边栏宽度",
      default: 175,
    },
    /** 快捷键映射 */
    "core-shortcuts": {
      storage: "localStorage",
      category: "layout",
      desc: "键盘快捷键自定义映射",
      default: {} as Record<string, string>,
      fieldDescriptions: {
        "back-to-home": "返回首页",
        "toggle-settings": "打开设置面板",
        "toggle-pin": "切换窗口置顶",
        "toggle-theme": "切换白天/黑夜主题",
      },
    },

    // ── 主题配置 ──

    /** 主题配置（深色/浅色模式、强调色、窗口置顶） */
    "core-theme-config": {
      storage: "localStorage",
      category: "preference",
      desc: "主题配置（深色/浅色模式、强调色、窗口置顶）",
      default: { mode: "dark" as "dark" | "light", accentHue: 210, pinOnTop: false },
    },

    /** 数据管理面板当前子标签（独立于 NAV_LOCATION 存储，避免切换设置 Tab 后丢失） */
    "core-data-mgr-subtab": {
      storage: "localStorage",
      category: "layout",
      desc: "数据管理面板当前子标签（本地存储 / 本地文件）",
      default: "storage" as string,
    },
  },
);

// ── 动态前缀 key ──

/** 日志缓存（LogPanel 组件按 storageKey 存储） */
registerRawDataItem("log-cache:", {
  storage: "localStorage",
  category: "cache",
  desc: "日志缓存（log-cache:{storageKey}，由 LogPanel 管理）",
  default: null,
  matchMode: "prefix",
  onDelete: "allowed",
});
