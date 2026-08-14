// ============================================================
// 浏览器数据单一数据源（按需检测版）
//
// 职责：
//   - 启动时只从 localStorage 同步读缓存（零后端开销，不拖慢页面加载）
//   - 仅当进入浏览器配置相关页面时调用 refreshBrowserData() 触发一次检测
//   - 检测结果统一写入 store，全局配置 / 当前配置 / 平台选择器共用一份数据
//     （消除原先 detectBrowsers + useBrowserProfilesCache + CurrentBrowserCards
//      三处对同一批目录的重复扫描）
//
// 更新协议（告别「速度 vs 新鲜度」的二元取舍）：
//   - 展示用：缓存快照（localStorage），启动即渲染
//   - 新鲜度：进入配置页时检测，完成后增量合并，lastSyncedAt 标注时间
// ============================================================

import { useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import { detectBrowsers, detectBrowserTypes, detectCustomProfiles } from "../api";
import type { BCPBrowser } from "../components/BrowserConfigPanel";
import { safeGetJSON, safeSetJSON } from "../localStorageKeys";
import { populateBrowserIcons, stripBrowserCache } from "../utils/browser-icons";

const LS_BROWSERS = "core-browsers-cache";
const LS_EXE_PATHS = "core-cfg-exe-paths";
const LS_USERDATA_DIRS = "core-cfg-userdata-dirs";

/** 检测 loading 状态最短展示时长：避免检测过快导致加载反馈（转圈）一闪而过 */
const MIN_LOADING_MS = 400;

/**
 * 已知浏览器显示名（detect_custom_profiles 对非 edge/chrome 类型会回退为「浏览器」，
 * 此处仅用于从路径配置恢复条目时的友好显示名；保持中性，不引入公司专用逻辑。
 * 公司专用浏览器（如易得客）的显示名由业务项目注册的检测器返回）。
 */
const KNOWN_BROWSER_NAMES: Record<string, string> = {
  edge: "Microsoft Edge",
  chrome: "Google Chrome",
};

/** 构造一个最小浏览器条目（用户配置过路径但检测未返回的类型，如易得客） */
function makeFallbackBrowser(bt: string, exe: string | null, dirs: string[]): BCPBrowser {
  return {
    browser_type: bt,
    browser_name: KNOWN_BROWSER_NAMES[bt] || bt,
    browser_icon_base64: "",
    installed: !!exe,
    exe_paths: exe ? [exe] : [],
    user_data_dirs: dirs,
    default_user_data_dir: dirs[0] || undefined,
    default_debug_port: 9222,
    browser_version: "",
    suggested_user_data_dirs: [],
    profiles: [],
  } as unknown as BCPBrowser;
}

export interface BrowserStoreState {
  browsers: BCPBrowser[];
  exePaths: Record<string, string>;
  userDataDirs: Record<string, string[]>;
  /** 是否正在检测（仅配置页内触发，应用启动时不检测） */
  loading: boolean;
  /** 最近一次检测完成时间戳；null = 本次会话尚未检测过（仅缓存数据） */
  lastSyncedAt: number | null;
  error: string | null;
}

function loadExePathsCache(): Record<string, string> {
  return safeGetJSON<Record<string, string>>(LS_EXE_PATHS) ?? {};
}

function loadUserDataDirsCache(): Record<string, string[]> {
  return safeGetJSON<Record<string, string[]>>(LS_USERDATA_DIRS) ?? {};
}

function loadInitialState(): BrowserStoreState {
  const cachedBrowsers = safeGetJSON<BCPBrowser[]>(LS_BROWSERS) ?? [];

  // 路径配置：localStorage 优先，无缓存时用浏览器缓存中的 exe_paths / user_data_dirs 兜底
  const cachedExe = loadExePathsCache();
  const cachedDirs = loadUserDataDirsCache();
  const exePaths: Record<string, string> = { ...cachedExe };
  const userDataDirs: Record<string, string[]> = { ...cachedDirs };
  if (Object.keys(exePaths).length === 0) {
    for (const b of cachedBrowsers) if (b.exe_paths?.[0]) exePaths[b.browser_type] = b.exe_paths[0];
  }
  if (Object.keys(userDataDirs).length === 0) {
    for (const b of cachedBrowsers) if (b.user_data_dirs?.length) userDataDirs[b.browser_type] = [...b.user_data_dirs];
  }

  // 浏览器图标 base64 随缓存持久化（已在 stripBrowserCache 中保留），此处恢复内存缓存
  populateBrowserIcons(cachedBrowsers);

  return {
    browsers: cachedBrowsers,
    exePaths,
    userDataDirs,
    loading: false,
    lastSyncedAt: null,
    error: null,
  };
}

let state: BrowserStoreState = loadInitialState();
const listeners = new Set<() => void>();
let refreshPromise: Promise<void> | null = null;

function setState(updater: (prev: BrowserStoreState) => BrowserStoreState): void {
  const next = updater(state);
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): BrowserStoreState {
  return state;
}

/** 订阅浏览器数据快照（单一数据源） */
export function useBrowserStore(): BrowserStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 触发一次全量浏览器检测（in-flight 去重，并发调用只执行一次）。
 *
 * 检测范围 = 基础检测（注册表 + 默认目录）+ 用户配置目录补全 profiles，
 * 一次检测的结果同时供全局配置 / 当前配置 / 平台选择器消费。
 */
export function refreshBrowserData(): Promise<void> {
  if (refreshPromise) return refreshPromise;

  const startedAt = Date.now();
  setState(s => ({ ...s, loading: true, error: null }));
  refreshPromise = (async () => {
    try {
      // 1) 基础检测：注册表定位 exe + 默认 User Data 目录
      //    并取当前支持的（已注册）类型列表，用于过滤历史缓存中的
      //    「本项目不支持」的浏览器类型（如 000 项目历史残留的易得客）
      const [list, registeredTypes] = await Promise.all([
        detectBrowsers() as unknown as Promise<BCPBrowser[]>,
        detectBrowserTypes(),
      ]);
      const supportedTypes = new Set(registeredTypes);

      // 2) 用「用户配置的目录列表」（含自定义目录）补全 profiles
      const dirsByType = loadUserDataDirsCache();
      const exesByType = loadExePathsCache();
      const enriched = await Promise.all(list.map(async b => {
        const bt = b.browser_type;
        const dirs = (dirsByType[bt] && dirsByType[bt].length > 0)
          ? dirsByType[bt]
          : (b.user_data_dirs || []);
        if (dirs.length === 0) return b;
        try {
          const r = await detectCustomProfiles(bt, exesByType[bt] || b.exe_paths?.[0] || null, dirs);
          return {
            ...b,
            profiles: r.profiles || [],
            user_data_dirs: dirs,
            suggested_user_data_dirs: r.suggested_user_data_dirs || [],
          };
        } catch {
          return b;
        }
      }));

      // 3) 合并：仅保留「检测返回」或「后端支持（已注册）」的浏览器类型
      //    - 已注册但检测未返回的类型（如易得客检测失败）：保留缓存 / 按路径配置恢复，保证侧边栏不丢配置
      //    - 未注册类型（如 000 项目历史缓存的易得客）：一律剔除，避免跨项目污染
      const merged = [...enriched];
      const knownTypes = new Set(merged.map(m => m.browser_type));
      for (const b of state.browsers) {
        if (supportedTypes.has(b.browser_type) && !knownTypes.has(b.browser_type)) {
          merged.push(b);
          knownTypes.add(b.browser_type);
        }
      }
      for (const bt of Object.keys(dirsByType)) {
        if (!supportedTypes.has(bt) || knownTypes.has(bt)) continue;
        const dirs = dirsByType[bt];
        if (dirs.length === 0) continue;
        try {
          const r = await detectCustomProfiles(bt, exesByType[bt] || null, dirs);
          merged.push({ ...r, profiles: r.profiles || [] });
        } catch {
          merged.push(makeFallbackBrowser(bt, exesByType[bt] || null, dirs));
        }
        knownTypes.add(bt);
      }
      for (const bt of Object.keys(exesByType)) {
        if (!supportedTypes.has(bt) || knownTypes.has(bt)) continue;
        merged.push(makeFallbackBrowser(bt, exesByType[bt] || null, []));
        knownTypes.add(bt);
      }

      // 4) 路径：localStorage 优先，缺失用检测值兜底（与旧逻辑一致）
      const nextExe = { ...state.exePaths, ...exesByType };
      for (const b of merged) {
        if (!nextExe[b.browser_type] && b.exe_paths?.[0]) nextExe[b.browser_type] = b.exe_paths[0];
      }
      const nextDirs = { ...state.userDataDirs, ...dirsByType };
      for (const b of merged) {
        if (!nextDirs[b.browser_type]?.length && b.user_data_dirs?.length) {
          nextDirs[b.browser_type] = [...b.user_data_dirs];
        }
      }

      populateBrowserIcons(merged);
      safeSetJSON(LS_BROWSERS, stripBrowserCache(merged));

      // 保证 loading 反馈（转圈）最短可见时长，避免检测过快导致加载图标一闪而过
      const remaining = MIN_LOADING_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));

      setState(s => ({
        ...s,
        browsers: merged,
        exePaths: nextExe,
        userDataDirs: nextDirs,
        loading: false,
        lastSyncedAt: Date.now(),
        error: null,
      }));
    } catch (e) {
      const remaining = MIN_LOADING_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      setState(s => ({ ...s, loading: false, error: String(e) }));
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// ── 持久化写入入口（useBrowserBaseData 的 updateExePaths/updateUserDataDirs 委托至此） ──

/** 持久化更新 exePaths：同时更新 state 与 localStorage */
export function updateStoreExePaths(action: SetStateAction<Record<string, string>>): void {
  setState(prev => {
    const next = typeof action === "function"
      ? (action as (prev: Record<string, string>) => Record<string, string>)(prev.exePaths)
      : action;
    safeSetJSON(LS_EXE_PATHS, next);
    return { ...prev, exePaths: next };
  });
}

/** 持久化更新 userDataDirs：同时更新 state 与 localStorage */
export function updateStoreUserDataDirs(action: SetStateAction<Record<string, string[]>>): void {
  setState(prev => {
    const next = typeof action === "function"
      ? (action as (prev: Record<string, string[]>) => Record<string, string[]>)(prev.userDataDirs)
      : action;
    safeSetJSON(LS_USERDATA_DIRS, next);
    return { ...prev, userDataDirs: next };
  });
}

export type { Dispatch };
