import { useState, useEffect, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { detectBrowsers } from "../api";
import type { BCPBrowser } from "../components/BrowserConfigPanel";
import { safeGetJSON, safeSetJSON, LS_KEYS } from "../localStorageKeys";
import { populateBrowserIcons, stripBrowserCache } from "../utils/browser-icons";

/** 从 localStorage 读取主题配置 */
function loadThemeFromCache(): { darkMode: boolean; accentHue: number; pinOnTop: boolean; themeTimestamp: number } | null {
  const saved = safeGetJSON<{ mode: "dark" | "light"; accentHue: number; pinOnTop: boolean }>(LS_KEYS.THEME);
  if (!saved) return null;
  return {
    darkMode: saved.mode === "dark",
    accentHue: saved.accentHue,
    pinOnTop: saved.pinOnTop,
    themeTimestamp: Date.now(),
  };
}

const LS_BROWSERS = "core-browsers-cache";
const LS_EXE_PATHS = "core-cfg-exe-paths";
const LS_USERDATA_DIRS = "core-cfg-userdata-dirs";

/** 从 localStorage 同步读取浏览器路径配置 */
function loadExePathsCache(): Record<string, string> {
  return safeGetJSON<Record<string, string>>(LS_EXE_PATHS) ?? {};
}

/** 从 localStorage 同步读取用户数据目录配置 */
function loadUserDataDirsCache(): Record<string, string[]> {
  return safeGetJSON<Record<string, string[]>>(LS_USERDATA_DIRS) ?? {};
}

/** 从 localStorage 恢复浏览器缓存数据 */
function loadCache(): { browsers: BCPBrowser[]; activeBrowser: string | null; theme: { darkMode: boolean; accentHue: number; pinOnTop: boolean; themeTimestamp: number } | null; selectedBrowser: string; selectedProfile: { name: string; userDataDir: string; id: string } | null } {
  return {
    browsers: safeGetJSON<BCPBrowser[]>(LS_BROWSERS) ?? [],
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
 * ## 前端先行
 * - 首次渲染**同步**从 localStorage 恢复全量数据（浏览器列表、路径、选中状态、主题）
 * - UI 立即展示缓存内容，不等后端
 * - 后端 `loadConfig()` + `detectBrowsers()` 完成后覆盖，确保数据最新
 *
 * ## 默认选择
 * - 如果缓存中 `selectedBrowser` 为空但有浏览器列表，自动选中第一个
 *
 * ## 全局共享
 * - 所有项目共用此 hook，无需在各 App.tsx 维护重复的初始化逻辑
 */
export function useBrowserBaseData(): BrowserBaseData {
  // ══════════════════════════════════════════════
  //  同步恢复全量缓存
  // ══════════════════════════════════════════════
  const cache = loadCache();

  const [browsers, setBrowsers] = useState<BCPBrowser[]>(cache.browsers);
  const [exePaths, setExePaths] = useState<Record<string, string>>(() => {
    // 同步从 localStorage 恢复路径配置，避免首次渲染空状态导致下游回退到检测默认值
    const cached = loadExePathsCache();
    if (Object.keys(cached).length > 0) return cached;
    // 无缓存时用浏览器缓存的 exe_paths 兜底
    const fromBrowser: Record<string, string> = {};
    for (const b of cache.browsers) {
      if (b.exe_paths?.[0]) fromBrowser[b.browser_type] = b.exe_paths[0];
    }
    return fromBrowser;
  });
  const [userDataDirs, setUserDataDirs] = useState<Record<string, string[]>>(() => {
    // 同步从 localStorage 恢复目录配置，避免首次渲染空状态导致下游回退到检测默认值
    const cached = loadUserDataDirsCache();
    if (Object.keys(cached).length > 0) return cached;
    // 无缓存时用浏览器缓存的 user_data_dirs 兜底
    const fromBrowser: Record<string, string[]> = {};
    for (const b of cache.browsers) {
      if (b.user_data_dirs?.length) fromBrowser[b.browser_type] = [...b.user_data_dirs];
    }
    return fromBrowser;
  });
  const [theme, setTheme] = useState<{
    darkMode: boolean; accentHue: number; pinOnTop: boolean;
  } | null>(cache.theme);
  const [themeTimestamp, setThemeTimestamp] = useState<number | undefined>(undefined);

  // 缓存中 selectedBrowser 为空但有浏览器列表 → 默认选第一个
  const quickBt = safeGetJSON<string>("core-current-browser");
  const initBt = quickBt || cache.selectedBrowser || cache.activeBrowser || (cache.browsers.length > 0 ? cache.browsers[0].browser_type : "");
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

  const [loading, setLoading] = useState(true);

  // ══════════════════════════════════════════════
  //  后端懒加载：只在挂载时执行一次
  // ══════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;

    const rafId = requestAnimationFrame(() => {
    (async () => {
      try {
        const list = await detectBrowsers();
        if (cancelled) return;
        setBrowsers(list);
        populateBrowserIcons(list); // 提取图标到内存缓存
        safeSetJSON(LS_BROWSERS, stripBrowserCache(list)); // 写回浏览器列表缓存（不含图标 + 头像 base64）

        // exePaths：从 localStorage 缓存恢复，无缓存时用检测到的路径兜底
        // prev 来自 lazy initializer（同步读取），cachedExePaths 来自此时 localStorage 的最新值
        // prev 在前让最新 localStorage 值覆盖 stale 初始值
        const cachedExePaths = loadExePathsCache();
        if (cancelled) return;
        setExePaths(prev => {
          const merged = { ...prev, ...cachedExePaths };
          for (const b of list) {
            const bt = b.browser_type;
            if (!merged[bt] && b.exe_paths?.[0]) {
              merged[bt] = b.exe_paths[0];
            }
          }
          return merged;
        });

        // userDataDirs：从 localStorage 缓存恢复，无缓存时用检测值兜底
        const cachedDirs = loadUserDataDirsCache();
        if (cancelled) return;
        setUserDataDirs(prev => {
          const merged = { ...prev, ...cachedDirs };
          for (const b of list) {
            const bt = b.browser_type;
            if (!merged[bt]?.length && b.user_data_dirs?.length) {
              merged[bt] = [...b.user_data_dirs];
            }
          }
          return merged;
        });

        // 主题（从 localStorage 读取，已在 loadCache 中加载）
        // 如果缓存有值，确保也更新到 state（同步回后端主题加载的语义）
        const cachedTheme = loadThemeFromCache();
        if (cachedTheme && !cancelled) {
          setTheme({
            darkMode: cachedTheme.darkMode,
            accentHue: cachedTheme.accentHue,
            pinOnTop: cachedTheme.pinOnTop,
          });
          setThemeTimestamp(cachedTheme.themeTimestamp);
        }

        if (cancelled) return;

        // 恢复选中的 browser / profile（从 localStorage 缓存）
        const savedBt = safeGetJSON<string>("core-current-browser");
        const savedProfile = safeGetJSON<{ name: string; userDataDir: string; id: string } | null>("core-current-profile");

        if (cancelled) return;

        if (savedProfile && savedBt) {
          setSelectedBrowser(savedBt);
          setSelectedProfile(savedProfile);
        } else if (!selectedBrowser && list.length > 0) {
          // 没有保存的 profile，也没有缓存 → 默认选第一个
          setSelectedBrowser(list[0].browser_type);
        }
      } catch (e) {
        if (!cancelled) console.error("useBrowserBaseData 加载失败", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    });
    return () => { cancelled = true; cancelAnimationFrame(rafId); };
  }, []);

  // ══════════════════════════════════════════════
  //  持久化更新方法（单一写入入口）
  // ══════════════════════════════════════════════

  /** 持久化更新 exePaths：同时更新 state 和 localStorage */
  const updateExePaths = useCallback((action: SetStateAction<Record<string, string>>) => {
    setExePaths(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      safeSetJSON(LS_EXE_PATHS, next);
      return next;
    });
  }, []);

  /** 持久化更新 userDataDirs：同时更新 state 和 localStorage */
  const updateUserDataDirs = useCallback((action: SetStateAction<Record<string, string[]>>) => {
    setUserDataDirs(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      safeSetJSON(LS_USERDATA_DIRS, next);
      return next;
    });
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
