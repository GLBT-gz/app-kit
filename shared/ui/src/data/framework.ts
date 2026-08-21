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
      desc: "数据管理面板当前子标签（浏览器存储 / 本地存储）",
      default: "storage" as string,
    },

    // ── 浏览器面板（BrowserConfigPanel / useBrowserBaseData） ──

    /** 浏览器配置面板侧边栏宽度 */
    "core-bcp-sidebar-width": {
      storage: "localStorage",
      category: "layout",
      desc: "浏览器配置面板侧边栏宽度（可拖拽调整）",
      default: 185,
    },
    /** 浏览器配置面板当前激活的浏览器标签 */
    "core-active-browser-tab": {
      storage: "localStorage",
      category: "layout",
      desc: "浏览器配置面板当前激活的浏览器标签",
      default: null as string | null,
    },
    /** 当前选中的浏览器类型 */
    "core-current-browser": {
      storage: "localStorage",
      category: "preference",
      desc: "浏览器面板当前选中的浏览器类型",
      default: "" as string,
    },
    /** 当前选中的用户数据 Profile */
    "core-current-profile": {
      storage: "localStorage",
      category: "preference",
      desc: "浏览器面板当前选中的用户数据 Profile",
      default: null as { name: string; userDataDir: string; id: string } | null,
    },
    /** 是否隐藏不可控的 Profile 卡片 */
    "core-hide-uncontrollable": {
      storage: "localStorage",
      category: "preference",
      desc: "是否隐藏不可控的 Profile 卡片",
      default: false,
    },

    // ── 全局字体选择（TopBar） ──

    /** 全局字体选择（{ font: "maple" | "maple-cn" | "system" | ... }） */
    "core-font-config": {
      storage: "localStorage",
      category: "preference",
      desc: "全局字体选择配置",
      default: { font: "maple" } as { font: string },
    },

    // ── 浏览器相关缓存 ──

    /** 浏览器列表缓存（检测结果，不含图标） */
    "core-browsers-cache": {
      storage: "localStorage",
      category: "cache",
      desc: "浏览器列表缓存（检测结果）",
      default: [] as unknown[],
    },
    /** 浏览器可执行文件路径配置缓存 */
    "core-cfg-exe-paths": {
      storage: "localStorage",
      category: "cache",
      desc: "浏览器可执行文件路径配置缓存",
      default: {} as Record<string, string>,
    },
    /** 浏览器用户数据目录配置缓存 */
    "core-cfg-userdata-dirs": {
      storage: "localStorage",
      category: "cache",
      desc: "浏览器用户数据目录配置缓存",
      default: {} as Record<string, string[]>,
    },

    // ── 数据管理快照 ──

    /** 数据管理快照（最多保留 5 份） */
    "core-snapshots": {
      storage: "localStorage",
      category: "cache",
      desc: "数据管理快照（保存时 localStorage 全量备份）",
      default: [] as unknown[],
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

/** 浏览器可见用户数据目录列表（BrowserConfigPanel 按 browser_type 动态生成） */
registerRawDataItem("core-visible-dirs-", {
  storage: "localStorage",
  category: "cache",
  desc: "浏览器可见用户数据目录列表（core-visible-dirs-{browser_type}）",
  default: null,
  matchMode: "prefix",
  onDelete: "allowed",
});
