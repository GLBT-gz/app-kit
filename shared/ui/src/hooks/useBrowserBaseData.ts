import { useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BCPBrowser } from "../components/BrowserConfigPanel";
import { safeGetJSON, safeSetJSON } from "../localStorageKeys";
import { useBrowserStore, updateStoreExePaths, updateStoreUserDataDirs } from "../data/browserStore";

const LS_THEME = "core-theme-cache";

/** 从 localStorage 读取主题配置 */
function loadThemeFromCache(): { darkMode: boolean; accentHue: number; pinOnTop: boolean; themeTimestamp: number } | null {
  const saved = safeGetJSON<{ mode: "dark" | "light"; accentHue: number; pinOnTop: boolean }>(LS_THEME);
  if (!saved) return null;
  return {
    darkMode: saved.mode === "dark",
    accentHue: saved.accentHue,
    pinOnTop: saved.pinOnTop,
    themeTimestamp: Date.now(),
  };
}

/** 从 localStorage 恢复选中状态等缓存数据 */
function loadCache(): { activeBrowser: string | null; theme: { darkMode: boolean; accentHue: number; pinOnTop: boolean; themeTimestamp: number } | null; selectedBrowser: string; selectedProfile: { name: string; userDataDir: string; id: string } | null } {
  return {
    activeBrowser: safeGetJSON<string | null>("core-active-browser-tab") ?? null,
    theme: loadThemeFromCache(),
    selectedBrowser: safeGetJSON<string>("core-current-browser") ?? "",
    selectedProfile: safeGetJSON<{ name: string; userDataDir: string; id: string } | null>("core-current-profile") ?? null,
  };
}

export interface BrowserBaseData {
  browsers: BCPBrowser[];
  exePaths: Record<string, string>;
  userDataDirs: Record<string, string[]>;
  theme: { darkMode: boolean; accentHue: number; pinOnTop: boolean } | null;
  /** 后端主题数据的时间戳，用于 AppLayout 双端同步。undefined=尚未加载 */
  themeTimestamp: number | undefined;
  loading: boolean;

  selectedBrowser: string;
  setSelectedBrowser: (bt: string) => void;
  selectedProfile: { name: string; userDataDir: string; id: string } | null;
  setSelectedProfile: (p: { name: string; userDataDir: string; id: string } | null) => void;

  /**
   * 持久化更新 exePaths。
   * 接受 SetStateAction，同时更新 state 和 localStorage。
   * 这是浏览器路径配置的**唯一写入入口**。
   */
  updateExePaths: Dispatch<SetStateAction<Record<string, string>>>;
  /**
   * 持久化更新 userDataDirs。
   * 接受 SetStateAction，同时更新 state 和 localStorage。
   * 这是浏览器用户数据目录的**唯一写入入口**。
   */
  updateUserDataDirs: Dispatch<SetStateAction<Record<string, string[]>>>;

  /**
   * @deprecated 使用 updateExePaths / updateUserDataDirs 代替。
   * 旧的批量同步接口，保留以兼容尚未迁移的调用方。
   */
  syncBrowserConfig: (config: {
    exePaths: Record<string, string>;
    userDataDirs: Record<string, string[]>;
  }) => void;
}

/**
 * 全局唯一的浏览器数据加载 hook。
 *
 * ## 按需检测（不再启动即检测）
 * - 浏览器列表 / 路径 / 目录来自单一数据源 browserStore，首次渲染**同步**从 localStorage 恢复缓存
 * - 应用启动**不触发**后端检测（detectBrowsers 昂贵：注册表 + 目录扫描 + 头像缩略图），
 *   因此不再拖慢整体页面加载
 * - 仅当进入「全局浏览器配置 / 当前浏览器配置」页面时，由对应组件调用 refreshBrowserData()
 *   触发一次检测，完成后增量合并到 store
 *
 * ## 默认选择
 * - 如果缓存中 `selectedBrowser` 为空但有浏览器列表，自动选中第一个
 *
 * ## 全局共享
 * - 所有项目共用此 hook，无需在各 App.tsx 维护重复的初始化逻辑
 */
export function useBrowserBaseData(): BrowserBaseData {
  const { browsers, exePaths, userDataDirs, loading } = useBrowserStore();

  // 选中状态 / 主题等本地状态（仅依赖 localStorage 缓存，不依赖后端检测）
  const cache = loadCache();
  const [theme] = useState<{
    darkMode: boolean; accentHue: number; pinOnTop: boolean;
  } | null>(cache.theme);
  const [themeTimestamp] = useState<number | undefined>(cache.theme?.themeTimestamp);

  // 缓存中 selectedBrowser 为空但有浏览器列表 → 默认选第一个
  const quickBt = safeGetJSON<string>("core-current-browser");
  const initBt = quickBt || cache.selectedBrowser || cache.activeBrowser || (browsers.length > 0 ? browsers[0].browser_type : "");
  const [selectedBrowser, setSelectedBrowserState] = useState(initBt);
  const setSelectedBrowser = useCallback((bt: string) => {
    setSelectedBrowserState(bt);
    safeSetJSON("core-current-browser", bt);
  }, []);
  const [selectedProfile, setSelectedProfileState] = useState<{
    name: string; userDataDir: string; id: string;
  } | null>(cache.selectedProfile);
  const setSelectedProfile = useCallback((p: { name: string; userDataDir: string; id: string } | null) => {
    setSelectedProfileState(p);
    safeSetJSON("core-current-profile", p);
  }, []);

  // ── 持久化更新方法（委托 browserStore，单一写入入口） ──

  /** 持久化更新 exePaths：同时更新 state 和 localStorage */
  const updateExePaths = useCallback((action: SetStateAction<Record<string, string>>) => {
    updateStoreExePaths(action);
  }, []);

  /** 持久化更新 userDataDirs：同时更新 state 和 localStorage */
  const updateUserDataDirs = useCallback((action: SetStateAction<Record<string, string[]>>) => {
    updateStoreUserDataDirs(action);
  }, []);

  /**
   * @deprecated 批量同步接口，内部委托给 updateExePaths / updateUserDataDirs。
   * 保留以兼容尚未迁移的旧调用方（000、003）。
   */
  const syncBrowserConfig = useCallback((config: {
    exePaths: Record<string, string>;
    userDataDirs: Record<string, string[]>;
  }) => {
    updateExePaths(config.exePaths);
    updateUserDataDirs(config.userDataDirs);
  }, [updateExePaths, updateUserDataDirs]);

  return {
    browsers,
    exePaths,
    userDataDirs,
    theme,
    themeTimestamp,
    loading,
    selectedBrowser,
    setSelectedBrowser,
    selectedProfile,
    setSelectedProfile,
    updateExePaths,
    updateUserDataDirs,
    syncBrowserConfig,
  };
}
