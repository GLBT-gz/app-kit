/** 集中管理所有 localStorage key，避免硬编码分散 */

import { getAllRegisteredItems } from "./data/registry";

export const LS_KEYS = {
  // ── 框架独立 key ──

  /** 浏览位置路径（例如 ['设置','数据管理']） */
  NAV_LOCATION: "core-nav-location",
  /** 设置面板侧边栏宽度 */
  SIDEBAR_WIDTH: "core-sidebar-width",
  /** 浏览器配置面板侧边栏宽度 */
  BCP_SIDEBAR_WIDTH: "core-bcp-sidebar-width",
  /** 是否隐藏不可控 Profile */
  HIDE_UNCONTROLLABLE: "core-hide-uncontrollable",
  /** 快捷键映射 */
  SHORTCUTS: "core-shortcuts",
  /** 主题配置（深色/浅色模式、强调色、窗口置顶） */
  THEME: "core-theme-config",
  /** 全局字体选择（"maple" | "maple-cn" | "system"） */
  FONT: "core-font-config",
  /** 数据管理面板当前子标签（本地存储/本地文件），独立于 NAV_LOCATION */
  DATA_MGR_SUBTAB: "core-data-mgr-subtab",
} as const;

/** 安全写入 localStorage */
export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage 满或无权限时静默失败 */
  }
}

/** 安全读取 localStorage */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 内存缓存：避免同一 key 的 JSON.parse 重复执行。
 *
 * ## 为什么需要
 * 刷新页面后，多个组件会独立读取并解析同一个 localStorage key。每次 JSON.parse 同步
 * 阻塞主线程，叠加 WebView2 首次 localStorage IPC 的额外延迟，导致首帧 3-4 秒
 * 滚轮无响应。
 *
 * ## 原理
 * - safeGetJSON 首次读取时走 localStorage IPC + JSON.parse，结果缓存到内存 Map
 * - safeSetJSON 写入时同步更新内存缓存
 * - 后续读取直接命中内存，零延迟
 * - clearAllGlbtCache 同时清除内存缓存
 */
const jsonCache = new Map<string, unknown>();

/** 安全读取并解析 JSON */
export function safeGetJSON<T>(key: string): T | null {
  // 内存缓存命中 → 跳过 localStorage IPC + JSON.parse
  if (jsonCache.has(key)) {
    return jsonCache.get(key) as T | null;
  }
  const raw = safeGetItem(key);
  if (!raw) {
    jsonCache.set(key, null);
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as T;
    jsonCache.set(key, parsed);
    return parsed;
  } catch {
    jsonCache.set(key, null);
    return null;
  }
}

/** 安全写入 JSON */
export function safeSetJSON(key: string, value: unknown): void {
  // 同步更新内存缓存（消除后续读取的 IPC + JSON.parse 开销）
  jsonCache.set(key, value);
  safeSetItem(key, JSON.stringify(value));
}

/** 安全删除 localStorage + 同步清除 jsonCache */
export function safeRemoveJSON(key: string): void {
  jsonCache.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* 静默 */
  }
}

/** 清空所有 AppKit 应用相关的 localStorage 缓存
 *
 * - 按已知前缀选择性删除，不调用 localStorage.clear() 以免误清同源其他应用数据
 * - 尊重注册表 onDelete: "blocked" 的项，始终保留
 * - `extraPrefixes` 可用于传入项目专属命名空间（如 `["001-"]`）
 *
 * AboutPanel 的"重置全部"及 DataManager 的批量删除均使用此函数。 */
export function clearAllAppkitCache(extraPrefixes?: string[]): void {
  jsonCache.clear();
  const prefixes = ["core-", "appkit-", ...(extraPrefixes ?? [])];
  // 从注册表收集 onDelete: "blocked" 的 key，这些项永远保留
  const preserved = new Set<string>();
  try {
    for (const item of getAllRegisteredItems()) {
      if (item.onDelete === "blocked" && item.storage === "localStorage") {
        preserved.add(item.key);
      }
    }
  } catch {
    /* registry 未就绪时静默，按前缀删除全部 */
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && !preserved.has(key) && prefixes.some((p) => key.startsWith(p))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* 静默 */
  }
}
