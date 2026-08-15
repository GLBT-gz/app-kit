import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { safeGetJSON, safeSetJSON, LS_KEYS } from "../localStorageKeys";
import { getBrowserIcon } from "../utils/browser-icons";
import { findAvailablePort, detectBrowserRunningProcesses, killBrowserProfileProcess, killAllBrowserProcesses } from "../api";
import { ziniaoPatchStatus, ziniaoPatchApply } from "../ziniao-api";
import type { ChildBrowserConfig } from "../types";
import { Button } from "./controls/Button";

// ════════════════════════════════════════════
//  通用类型定义（兼容各项目的不同数据结构）
// ════════════════════════════════════════════

export interface BCPBrowser {
  browser_type: string;
  browser_name: string;
  browser_icon_base64?: string | null;
  exe_paths: string[];
  /** 000 用 browser_version, 001 用 version */
  version?: string;
  user_data_dirs: string[];
  profiles?: BCPProfile[];
  default_user_data_dir?: string;
  suggested_user_data_dirs?: string[];
  /** 子浏览器实例（易得客店铺窗口等） */
  children?: ChildBrowserConfig[];
}

export interface BCPProfile {
  id: string;
  name: string;
  user_data_dir: string;
  avatar_base64?: string | null;
  email?: string | null;
  download_dir?: string | null;
  user_name?: string;
  path?: string;
}

// ════════════════════════════════════════════
//  Props 接口
// ════════════════════════════════════════════

export interface BrowserConfigPanelProps {
  /** 浏览器列表 */
  browsers: BCPBrowser[];
  /** 当前选中的浏览器类型 */
  activeBrowserType: string | null;
  /** 选中浏览器变更回调 */
  onActiveBrowserTypeChange: (type: string | null) => void;

  /** 每个浏览器的可执行文件路径 */
  exePaths: Record<string, string>;
  onExePathsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;

  /** 每个浏览器的用户数据目录列表 */
  userDataDirs: Record<string, string[]>;
  onUserDataDirsChange: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;

  /** 浏览器的 Profile 可见目录筛选（可选） */
  visibleDirs?: Record<string, string[]>;
  onVisibleDirsChange?: (dirs: Record<string, string[]>) => void;

  /** Profile 检测结果回调（用于父组件持久化 profiles） */
  onProfilesChange?: (browserType: string, profiles: BCPProfile[]) => void;

  /** 可选的侧边栏初始宽度 */
  sidebarWidth?: number;

  // ── 后端操作回调（可选，不提供则相关功能自动隐藏） ──

  /** 路径有效性检查 */
  onCheckPath?: (path: string) => Promise<boolean>;
  /** 在资源管理器中打开目录 */
  onOpenDir?: (path: string) => Promise<string>;
  /** 打开文件选择对话框（返回选中路径） */
  onBrowseFile?: () => Promise<string | string[] | null>;
  /** 打开目录选择对话框（返回选中路径列表） */
  onBrowseDirectory?: () => Promise<string | string[] | null>;
  /** 检测浏览器配置文件 */
  onDetectProfiles?: (browserType: string, exePath: string | null, userDirs: string[]) => Promise<BCPBrowser>;
  /** 是否正在重新检测（全局浏览器检测中，侧边栏图标转圈） */
  refreshing?: boolean;
  /** 手动触发一次全量重新检测（提供时在侧边栏顶部显示「重新检测」按钮） */
  onRefreshAll?: () => void;
  /** 启动浏览器 Profile */
  onLaunchProfile?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<string>;
  /** 获取启动命令 */
  onGetLaunchCommand?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<{
    exe_path: string; args: string[]; command_line: string; debug_port: number;
  }>;
  /** 创建新的浏览器用户数据目录 */
  onCreateUserDataDir?: (browserType: string, parentDir: string, dirName: string) => Promise<string>;
  /** 创建桌面快捷方式 */
  onCreateShortcut?: (browserType: string, profileId: string, userDataDir: string, profileName: string, avatarPath: string, debugPort: number) => Promise<string>;
}

// ════════════════════════════════════════════
//  单个浏览器配置项（React.memo 避免隐藏时重渲染）
// ════════════════════════════════════════════

interface BrowserConfigItemProps {
  browser: BCPBrowser;
  isActive: boolean;
  exePath: string;
  onExePathsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  userDirs: string[];
  onUserDataDirsChange: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  onCheckPath?: (path: string) => Promise<boolean>;
  onOpenDir?: (path: string) => Promise<string>;
  onBrowseFile?: () => Promise<string | string[] | null>;
  onBrowseDirectory?: () => Promise<string | string[] | null>;
  onDetectProfiles?: (browserType: string, exePath: string | null, userDirs: string[]) => Promise<BCPBrowser>;
  onLaunchProfile?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<string>;
  onGetLaunchCommand?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<{
    exe_path: string; args: string[]; command_line: string; debug_port: number;
  }>;
  onCreateUserDataDir?: (browserType: string, parentDir: string, dirName: string) => Promise<string>;
  onCreateShortcut?: (browserType: string, profileId: string, userDataDir: string, profileName: string, avatarPath: string, debugPort: number) => Promise<string>;
  onProfilesChange?: (browserType: string, profiles: BCPProfile[]) => void;
}

const BrowserConfigItem = React.memo(function BrowserConfigItem({
  browser, isActive, exePath, onExePathsChange, userDirs, onUserDataDirsChange,
  onCheckPath, onOpenDir, onBrowseFile, onBrowseDirectory,
  onDetectProfiles, onLaunchProfile, onGetLaunchCommand, onCreateUserDataDir, onCreateShortcut,
  onProfilesChange,
}: BrowserConfigItemProps) {
  // ── 懒挂载：记录该浏览器是否曾被激活过 ──
  const everActiveRef = useRef(isActive);
  if (isActive) {
    everActiveRef.current = true;
  }

  // ── 首帧延迟渲染：激活时不立即挂载 BrowserConfigInner，让出主线程给侧栏交互 ──
  const [showContent, setShowContent] = useState(!isActive);
  const deferRafRef = useRef<number | null>(null);
  const deferDoneRef = useRef(false);
  useEffect(() => {
    if (!isActive) {
      // 非激活时不触发延迟（激活后 effect 重新执行）
      return;
    }
    if (deferDoneRef.current) {
      // 之前已经完成过延迟激活 → 立即显示
      setShowContent(true);
      return;
    }
    deferDoneRef.current = true;
    // 延迟一帧再挂载 BrowserConfigInner，首帧主线程完全留给侧栏交互和滚动
    deferRafRef.current = requestAnimationFrame(() => {
      deferRafRef.current = null;
      setShowContent(true);
    });
    return () => {
      if (deferRafRef.current !== null) cancelAnimationFrame(deferRafRef.current);
    };
  }, [isActive]);

  const handleExePathChange = useCallback((v: string) => {
    onExePathsChange(prev => ({ ...prev, [browser.browser_type]: v }));
  }, [browser.browser_type, onExePathsChange]);

  const handleUserDirsChange = useCallback((dirs: string[]) => {
    onUserDataDirsChange(prev => ({ ...prev, [browser.browser_type]: dirs }));
  }, [browser.browser_type, onUserDataDirsChange]);

  const handleProfilesChange = useCallback((profs: BCPProfile[]) => {
    onProfilesChange?.(browser.browser_type, profs);
  }, [browser.browser_type, onProfilesChange]);

  if (!everActiveRef.current) return null;

  return (
    <div style={{ display: isActive ? "" : "none" }}>
      {showContent ? (
        <BrowserConfigInner
          browser={browser}
          visible={isActive}
          exePath={exePath}
          onExePathChange={handleExePathChange}
          userDirs={userDirs}
          onUserDirsChange={handleUserDirsChange}
          onCheckPath={onCheckPath}
          onOpenDir={onOpenDir}
          onBrowseFile={onBrowseFile}
          onBrowseDirectory={onBrowseDirectory}
          onDetectProfiles={onDetectProfiles}
          onLaunchProfile={onLaunchProfile}
          onGetLaunchCommand={onGetLaunchCommand}
          onCreateUserDataDir={onCreateUserDataDir}
          onCreateShortcut={onCreateShortcut}
          onProfilesChange={handleProfilesChange}
        />
      ) : null}
    </div>
  );
});

// ════════════════════════════════════════════
//  BrowserConfigPanel 组件
// ════════════════════════════════════════════

export function BrowserConfigPanel(props: BrowserConfigPanelProps) {
  const {
    browsers, activeBrowserType, onActiveBrowserTypeChange,
    exePaths, onExePathsChange, userDataDirs, onUserDataDirsChange,
    sidebarWidth: initialSidebarWidth = 185,
    onCheckPath, onOpenDir, onBrowseFile, onBrowseDirectory,
    onDetectProfiles, refreshing, onRefreshAll, onLaunchProfile, onGetLaunchCommand, onCreateUserDataDir, onCreateShortcut,
    onProfilesChange,
  } = props;

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return safeGetJSON<number>(LS_KEYS.BCP_SIDEBAR_WIDTH) ?? initialSidebarWidth;
  });
  const dragStartRef = useRef({ x: 0, w: 0 });
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(Math.max(60, Math.min(380, dragStartRef.current.w + ev.clientX - dragStartRef.current.x)));
    };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    dragStartRef.current = { x: e.clientX, w: sidebarWidth };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  // 侧边栏宽度持久化
  useEffect(() => {
    safeSetJSON(LS_KEYS.BCP_SIDEBAR_WIDTH, sidebarWidth);
  }, [sidebarWidth]);

  const navMode = sidebarWidth >= 160 ? "wide" as const : sidebarWidth >= 90 ? "medium" as const : "compact" as const;
  const shortNameMap: Record<string, string> = {
    edge: "Edge", chrome: "Chrome", brave: "Brave", firefox: "Firefox",
    opera: "Opera", vivaldi: "Vivaldi", safari: "Safari",
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollSaveRaf = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const activeData = browsers.find(b => b.browser_type === activeBrowserType) || null;

  useEffect(() => {
    if (!activeData) return;
    const saved = sessionStorage.getItem(`scrollPos_${activeData.browser_type}`);
    if (saved && scrollRef.current) {
      requestAnimationFrame(() => { scrollRef.current?.scrollTo(0, parseInt(saved, 10)); });
    }
  }, [activeData?.browser_type]);

  // ── 用 ref 持有动态值，避免滚轮监听器在每次切换时重建 ──
  const activeTypeRef = useRef(activeBrowserType);
  activeTypeRef.current = activeBrowserType;
  const browsersRef = useRef(browsers);
  browsersRef.current = browsers;
  const onSwitchRef = useRef(onActiveBrowserTypeChange);
  onSwitchRef.current = onActiveBrowserTypeChange;

  // 浏览类型侧边栏滚轮切换（passive:true + RAF 节流）
  // 用 ref 记录最近的 delta 方向，每帧只执行最后一次切换
  const sidebarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    let rafId: number | null = null;
    let pendingDelta = 0;
    const handler = (e: WheelEvent) => {
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (el.scrollHeight > el.clientHeight) {
        if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
      }
      // RAF 节流：累积同一帧内的滚轮方向，避免快速滚轮时多次 setState
      pendingDelta += e.deltaY;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const dir = pendingDelta;
          pendingDelta = 0;
          const curBrowsers = browsersRef.current;
          const curType = activeTypeRef.current;
          const idx = curBrowsers.findIndex(b => b.browser_type === curType);
          if (idx < 0) return;
          if (dir > 0 && idx < curBrowsers.length - 1) onSwitchRef.current(curBrowsers[idx + 1].browser_type);
          else if (dir < 0 && idx > 0) onSwitchRef.current(curBrowsers[idx - 1].browser_type);
        });
      }
    };
    el.addEventListener("wheel", handler, { passive: true });
    return () => {
      el.removeEventListener("wheel", handler);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []); // 空依赖：监听器只绑定一次，永不重建

  // browsers 为空时仍渲染侧边栏结构，数据到达后自动填充
  const noBrowsers = browsers.length === 0;

  return (
    <div className="settings-panel-layout" style={{ flex: 1, minHeight: 0 }}>
      <div className="nav-sidebar" ref={sidebarRef} style={{ width: noBrowsers ? 185 : sidebarWidth }} data-mode={noBrowsers ? "wide" : navMode}>
        {onRefreshAll && (
          <div
            className={`nav-refresh ${navMode === "compact" ? "icon-only" : ""}`}
            onClick={onRefreshAll}
            title="重新检测全部浏览器"
            role="button"
          >
            <span className="nav-item-icon">
              {refreshing ? (
                <span className="nav-spin" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" /></svg>
              )}
            </span>
            {navMode !== "compact" && (
              <span className="nav-item-label">{refreshing ? "检测中…" : "重新检测"}</span>
            )}
          </div>
        )}
        {onRefreshAll && <div className="nav-divider" />}
        <div className="nav-list">
          {noBrowsers ? (
            <div className="nav-item" style={{ cursor: "default", opacity: 0.5 }}>
              <span className="nav-item-icon"><span className="nav-spin" /></span>
              <span className="nav-item-label">检测中…</span>
            </div>
          ) : (
            browsers.map(b => (
              <div
                key={b.browser_type}
                className={`nav-item ${b.browser_type === activeBrowserType ? "active" : ""} ${navMode === "compact" ? "icon-only" : ""}`}
                onClick={() => onActiveBrowserTypeChange(b.browser_type)}
                title={b.browser_name}
              >
                <span className="nav-item-icon">
                  {refreshing ? (
                    <span className="nav-spin" />
                  ) : (
                    getBrowserIcon(b.browser_type) && <img src={getBrowserIcon(b.browser_type)!} alt="" />
                  )}
                </span>
                {navMode !== "compact" && (
                  <span className="nav-item-label">
                    {navMode === "medium" ? (shortNameMap[b.browser_type] || b.browser_name) : b.browser_name}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        <div className="sidebar-resize-handle" onMouseDown={noBrowsers ? undefined : startDrag} />
      </div>
      <div
        className="panel-content"
        ref={scrollRef}
        onScroll={() => {
          if (!scrollRef.current || !activeData) return;
          if (scrollSaveRaf.current !== null) return; // 已有一帧排队，跳过
          scrollSaveRaf.current = requestAnimationFrame(() => {
            scrollSaveRaf.current = null;
            if (scrollRef.current && activeData) {
              sessionStorage.setItem(`scrollPos_${activeData.browser_type}`, String(scrollRef.current.scrollTop));
            }
          });
        }}
      >
        {noBrowsers ? (
          <div className="empty-state">正在检测浏览器…</div>
        ) : (
          browsers.map(b => (
            <BrowserConfigItem
              key={b.browser_type}
              browser={b}
              isActive={b.browser_type === activeBrowserType}
              exePath={exePaths[b.browser_type] || b.exe_paths[0] || ""}
              onExePathsChange={onExePathsChange}
              userDirs={userDataDirs[b.browser_type] || b.user_data_dirs}
              onUserDataDirsChange={onUserDataDirsChange}
              onCheckPath={onCheckPath}
              onOpenDir={onOpenDir}
              onBrowseFile={onBrowseFile}
              onBrowseDirectory={onBrowseDirectory}
              onDetectProfiles={onDetectProfiles}
              onLaunchProfile={onLaunchProfile}
              onGetLaunchCommand={onGetLaunchCommand}
              onCreateUserDataDir={onCreateUserDataDir}
              onCreateShortcut={onCreateShortcut}
              onProfilesChange={onProfilesChange}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
//  浏览器配置详情（内部组件）
// ════════════════════════════════════════════

function BrowserConfigInner({
  browser, exePath: exePathProp, onExePathChange, userDirs, onUserDirsChange,
  onCheckPath, onOpenDir, onBrowseFile, onBrowseDirectory,
  onDetectProfiles, onLaunchProfile, onGetLaunchCommand, onCreateUserDataDir, onCreateShortcut,
  onProfilesChange,
  visible,
}: {
  browser: BCPBrowser;
  exePath: string;
  onExePathChange: (v: string) => void;
  userDirs: string[];
  onUserDirsChange: (dirs: string[]) => void;
  onCheckPath?: (path: string) => Promise<boolean>;
  onOpenDir?: (path: string) => Promise<string>;
  onBrowseFile?: () => Promise<string | string[] | null>;
  onBrowseDirectory?: () => Promise<string | string[] | null>;
  onDetectProfiles?: (browserType: string, exePath: string | null, userDirs: string[]) => Promise<BCPBrowser>;
  onLaunchProfile?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<string>;
  onGetLaunchCommand?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<{
    exe_path: string; args: string[]; command_line: string; debug_port: number;
  }>;
  onCreateUserDataDir?: (browserType: string, parentDir: string, dirName: string) => Promise<string>;
  onCreateShortcut?: (browserType: string, profileId: string, userDataDir: string, profileName: string, avatarPath: string, debugPort: number) => Promise<string>;
  onProfilesChange?: (profiles: BCPProfile[]) => void;
  visible?: boolean;
}) {
  // ── exePath 局部状态：输入时不触发父组件重渲染，blur 时统一提交 ──
  const [localExePath, setLocalExePath] = useState(exePathProp);
  const prevExePathRef = useRef(exePathProp);
  useEffect(() => {
    if (exePathProp !== prevExePathRef.current) {
      prevExePathRef.current = exePathProp;
      setLocalExePath(exePathProp);
    }
  }, [exePathProp]);

  // ── userDirs 输入局部编辑状态：键入时不触发父组件重渲染 ──
  const [localDirEdits, setLocalDirEdits] = useState<Record<number, string>>({});
  const prevUserDirsRef = useRef(userDirs);
  useEffect(() => {
    if (userDirs !== prevUserDirsRef.current) {
      prevUserDirsRef.current = userDirs;
      setLocalDirEdits({});
    }
  }, [userDirs]);
  const commitDirEdit = useCallback((idx: number) => {
    const edited = localDirEdits[idx];
    if (edited === undefined) return;
    const newDirs = userDirs.map((d, j) => j === idx ? edited : d);
    onUserDirsChange(newDirs);
    setLocalDirEdits(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }, [localDirEdits, userDirs, onUserDirsChange]);

  const [newDir, setNewDir] = useState("");
  // 使用本地 state 存储检测结果，避免直接修改 prop 导致不更新 UI
  const [localProfiles, setLocalProfiles] = useState<BCPProfile[]>(() => browser.profiles || []);
  const [localSuggestedDirs, setLocalSuggestedDirs] = useState<string[]>(() => browser.suggested_user_data_dirs || []);
  const [_profilesDetected, setProfilesDetected] = useState(false);

  // ── 单一数据源：profiles 由 browserStore 统一检测提供 ──
  // store 检测完成（refreshBrowserData）后 browser.profiles 更新，同步到本地显示；
  // 不在此处自动重复 detectCustomProfiles（否则同一批目录被扫两遍 + 全量卡片渲染，卡顿根因）
  useEffect(() => {
    setLocalProfiles(browser.profiles || []);
  }, [browser.profiles]);

  // 当 profiles 检测结果更新时，通知父组件持久化
  // 用 ref 持有 onProfilesChange，避免因闭包变化导致 useEffect 死循环
  const onProfilesChangeRef = useRef(onProfilesChange);
  onProfilesChangeRef.current = onProfilesChange;
  useEffect(() => {
    if (onProfilesChangeRef.current && localProfiles.length > 0) {
      onProfilesChangeRef.current(localProfiles);
    }
  }, [localProfiles]);
  const filterDirs = useMemo(() => [...new Set(userDirs.filter(Boolean))], [userDirs]);
  // 目录显示名称：同名时显示 父目录\目录名，避免混淆
  const dirDisplayNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const dir of filterDirs) {
      const baseName = dir.replace(/^.*[\\\/]/, '');
      const hasDuplicate = filterDirs.some(d => d !== dir && d.replace(/^.*[\\\/]/, '') === baseName);
      if (hasDuplicate) {
        const parent = dir.replace(/[\\\/][^\\\/]*$/, '').replace(/^.*[\\\/]/, '');
        map[dir] = parent ? `${parent}\\${baseName}` : baseName;
      } else {
        map[dir] = baseName;
      }
    }
    return map;
  }, [filterDirs]);
  const [selectedDirs, setSelectedDirs] = useState<string[]>(() => {
    // 1) 优先从独立 key 恢复（core-visible-dirs-{browser_type}）
    const cached = safeGetJSON<string[]>("core-visible-dirs-" + browser.browser_type);
    if (cached) {
      const valid = cached.filter(d => filterDirs.includes(d));
      if (valid.length > 0) return valid;
    }
    // 2) 否则默认全选
    return [...filterDirs];
  });
  const prevFilterDirsRef = useRef(filterDirs);
  // 同步 selectedDirs 与 filterDirs 的变化（新增/移除目录时自动更新选中状态）
  useEffect(() => {
    const prev = prevFilterDirsRef.current;
    prevFilterDirsRef.current = filterDirs;
    const added = filterDirs.filter(d => !prev.includes(d));
    const removed = prev.filter(d => !filterDirs.includes(d));
    if (added.length === 0 && removed.length === 0) return;
    setSelectedDirs(prevSelected => {
      let next = prevSelected;
      if (removed.length > 0) next = next.filter(d => filterDirs.includes(d));
      if (added.length > 0) next = [...next, ...added];
      return next;
    });
  }, [filterDirs]);

  // selectedDirs 持久化到独立 key
  useEffect(() => {
    safeSetJSON("core-visible-dirs-" + browser.browser_type, selectedDirs);
  }, [selectedDirs, browser.browser_type]);

  const [pathStatus, setPathStatus] = useState<Record<string, '' | 'valid' | 'invalid'>>({});
  const [cmdModal, setCmdModal] = useState<{
    profile: BCPProfile; info: { exe_path: string; args: string[]; command_line: string; debug_port: number }; portStr: string;
  } | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; type: "success" | "error" | "info" | "warning" }>>([]);
  const [newUserModal, setNewUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [customParentDir, setCustomParentDir] = useState("");
  const [creating, setCreating] = useState(false);

  const showToast = useCallback((text: string, type: "success" | "error" | "info" | "warning" = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // ── 紫鸟 CDP patch 状态（无痕化集成；仅 ziniao 且命令可用时展示） ──
  const [ziniaoPatch, setZiniaoPatch] = useState<{
    supported: boolean;
    loading: boolean;
    patching: boolean;
    patched: boolean;
    v109: boolean;
    detail: string;
  }>({ supported: false, loading: false, patching: false, patched: false, v109: false, detail: "" });
  const checkZiniaoPatch = useCallback(async () => {
    if (browser.browser_type !== "ziniao") return;
    setZiniaoPatch(prev => ({ ...prev, loading: true }));
    try {
      const st = await ziniaoPatchStatus();
      setZiniaoPatch({
        supported: true,
        loading: false,
        patching: false,
        patched: st.patched,
        v109: st.v109,
        detail: st.detail,
      });
    } catch {
      // 命令不可用（其他项目未注册）→ 隐藏入口
      setZiniaoPatch(prev => ({ ...prev, supported: false, loading: false }));
    }
  }, [browser.browser_type]);
  useEffect(() => {
    if (browser.browser_type !== "ziniao") return;
    checkZiniaoPatch();
  }, [browser.browser_type, checkZiniaoPatch]);

  // 紫鸟一键 patch（showToast 定义之后；弹 UAC 提权）
  const applyZiniaoPatch = useCallback(async () => {
    setZiniaoPatch(prev => ({ ...prev, patching: true }));
    try {
      const msg = await ziniaoPatchApply();
      showToast(msg, "info");
      await checkZiniaoPatch();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setZiniaoPatch(prev => ({ ...prev, patching: false }));
    }
  }, [checkZiniaoPatch, showToast]);

  // ── 路径有效性检查（300ms 防抖后并行检查，单次 setState 批量更新） ──
  useEffect(() => {
    if (!onCheckPath) return;
    if (!visible) return;
    const allPaths = [exePathProp, ...userDirs].filter(Boolean);
    if (allPaths.length === 0) return;
    const timer = setTimeout(async () => {
      // 并行执行所有 IPC 检查，然后单次 batch 更新状态
      const results = await Promise.all(
        allPaths.map(async (p) => {
          if (!p.trim()) return null;
          const exists = await onCheckPath(p);
          return { path: p, valid: exists };
        })
      );
      setPathStatus(prev => {
        const next = { ...prev };
        for (const r of results) {
          if (r) next[r.path] = r.valid ? 'valid' : 'invalid';
        }
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [exePathProp, JSON.stringify(userDirs), onCheckPath, visible]);

  // ── 自动检测 Profiles ──
  const detectProfiles = useCallback(async (dirs: string[], showToastOnSuccess?: boolean) => {
    if (!onDetectProfiles) return;
    if (!dirs.some(d => d.trim())) {
      setLocalProfiles([]);
      setLocalSuggestedDirs([]);
      setProfilesDetected(true);
      return;
    }
    try {
      const result = await onDetectProfiles(browser.browser_type, exePathProp || null, dirs.filter(d => d.trim() !== ""));
      setLocalProfiles(result.profiles || []);
      setLocalSuggestedDirs(result.suggested_user_data_dirs || []);
      setProfilesDetected(true);
      if (showToastOnSuccess) showToast("检测完成", "success");
    } catch (e) {
      if (showToastOnSuccess) showToast(`检测失败: ${e}`, "error");
      setProfilesDetected(true);
    }
  }, [onDetectProfiles, browser.browser_type, exePathProp]);

  // ── 不再自动检测 profiles：由 browserStore 统一检测（单一数据源），
  // 避免同一批目录被 detectCustomProfiles 重复扫描 + 全量卡片渲染（卡顿根因）。
  // 手动检测保留：doDetect（「重新检测」按钮 / 新增用户后 500ms 自动触发）

  const doDetect = async () => {
    await detectProfiles(userDirs, true);
  };

  // 与后端 sanitize_dir_name 保持一致，用于预览显示
  const sanitizeDirName = useCallback((name: string) => {
    return name.replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
  }, []);

  const defaultNewUserParentDir = useMemo(() => {
    if (userDirs[0]) return userDirs[0].replace(/[^\\/]+$/, '');
    if (browser.default_user_data_dir) return browser.default_user_data_dir.replace(/[^\\/]+$/, '');
    return '';
  }, [userDirs, browser.default_user_data_dir]);

  const handleCreateUser = async () => {
    if (!onCreateUserDataDir) return;
    const name = sanitizeDirName(newUserName);
    if (!name) { showToast("请输入用户目录名称", "error"); return; }
    setCreating(true);
    try {
      const parentDir = customParentDir || defaultNewUserParentDir;
      if (!parentDir) { showToast("未找到目标目录，请先配置或手动选择", "error"); setCreating(false); return; }
      showToast("正在创建目录并启动浏览器初始化，请稍候...", "info");
      const newDir = await onCreateUserDataDir(browser.browser_type, parentDir, name);
      showToast("用户数据目录创建并初始化成功!", "success");
      if (!userDirs.includes(newDir)) onUserDirsChange([...userDirs, newDir]);
      setNewUserModal(false);
      setNewUserName("");
      setCustomParentDir("");
      setTimeout(() => doDetect(), 500);
    } catch (e) { showToast(`${e}`, "error"); }
    setCreating(false);
  };

  const profiles = localProfiles;
  const hasProfiles = profiles.length > 0;
  const filteredProfiles = profiles.filter(p => selectedDirs.includes(p.user_data_dir));

  const addDir = (dir?: string) => {
    const d = dir?.trim() || newDir.trim();
    if (!d || userDirs.includes(d)) return;
    onUserDirsChange([...userDirs, d]);
    setNewDir("");
  };
  const removeDir = (idx: number) => onUserDirsChange(userDirs.filter((_, i) => i !== idx));

  const browseExePath = async () => {
    if (!onBrowseFile) return;
    const selected = await onBrowseFile();
    if (selected) {
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) {
        setLocalExePath(path);
        onExePathChange(path);
      }
    }
  };

  const openExeFolder = async (exe: string) => {
    if (!onOpenDir) return;
    if (!exe.trim()) { showToast("路径为空", "error"); return; }
    const lastSep = exe.trim().lastIndexOf("\\");
    if (lastSep === -1) { showToast("无法解析目录路径", "error"); return; }
    try { await onOpenDir(exe.trim().substring(0, lastSep)); } catch (e) { showToast(`打开失败: ${e}`, "error"); }
  };

  const browseDirectories = async () => {
    if (!onBrowseDirectory) return;
    const selected = await onBrowseDirectory();
    if (selected?.length) {
      const dirs = Array.isArray(selected) ? selected : [selected];
      const merged = [...userDirs];
      for (const dir of dirs) { if (!merged.includes(dir)) merged.push(dir); }
      onUserDirsChange(merged);
    }
  };

  const doLaunch = async (p: BCPProfile, portStr: string) => {
    if (!onLaunchProfile) return;
    showToast("启动中...", "info");
    try {
      const portNum = Number(portStr) || 0;
      const msg = await onLaunchProfile(browser.browser_type, p.id, p.user_data_dir, portNum);
      const pid = msg.replace("PID:", "");
      showToast(`${browser.browser_name}「${p.name}」已启动 (PID: ${pid})`, "success");
    } catch (e) { showToast(`启动失败: ${e}`, "error"); }
  };

  const doShowCommand = async (p: BCPProfile, portStr: string) => {
    if (!onGetLaunchCommand) return;
    try {
      const portNum = Number(portStr) || 0;
      const info = await onGetLaunchCommand(browser.browser_type, p.id, p.user_data_dir, portNum);
      setCmdModal({ profile: p, info, portStr });
    } catch (e) { showToast(`获取命令失败: ${e}`, "error"); }
  };

  /** 调试启动：先杀旧进程（同一 user_data_dir 下任何正在运行的 profile），再以随机可用端口调试启动 */
  const doDebugLaunch = async (p: BCPProfile) => {
    if (!onLaunchProfile) return;

    // Chrome/Edge 的 singleton 锁是针对整个 user_data_dir 的，不是针对某个 profile。
    // 同一目录下有任何 profile 在运行，新进程都无法使用该目录。
    // 因此需要检查同一 user_data_dir 下所有 profile，找到正在运行的那个并杀掉。
    try {
      const allProfilesUnderDir = (browser.profiles || [])
        .filter(pr => pr.user_data_dir === p.user_data_dir)
        .map(pr => ({ user_data_dir: pr.user_data_dir, profile_id: pr.id }));

      const states = await detectBrowserRunningProcesses(allProfilesUnderDir);
      const running = states.find(s => s.is_running);
      if (running) {
        const runningProfile = (browser.profiles || []).find(pr =>
          pr.user_data_dir === running.user_data_dir && pr.id === running.profile_id
        );
        showToast(
          `「${runningProfile?.name || running.profile_id}」正在运行（同用户目录），先关闭...`,
          "warning"
        );
        await killBrowserProfileProcess(browser.browser_type, running.profile_id, running.user_data_dir);
        showToast(`已关闭旧进程`, "success");
        // 等待进程完全退出，释放 Singleton 锁
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (e) {
      showToast(`检测/关闭进程失败: ${e}`, "error");
      return;
    }

    showToast("查找可用端口...", "info");
    try {
      const port = await findAvailablePort(40000, 60000);
      showToast(`选中端口 ${port}，启动中...`, "info");
      const msg = await onLaunchProfile(browser.browser_type, p.id, p.user_data_dir, port);
      const pid = msg.replace("PID:", "");
      showToast(`${browser.browser_name}「${p.name}」已启动 (PID: ${pid}) 调试端口: ${port}`, "success");
    } catch (e) { showToast(`调试启动失败: ${e}`, "error"); }
  };

  const versionDisplay = browser.version || "";

  return (
    <>
      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.text}</div>)}
      </div>
      <div className="browser-view">
        <div className="browser-header">
          <div className="bh-left">
            <span className="bh-icon">{getBrowserIcon(browser.browser_type) && <img src={getBrowserIcon(browser.browser_type)!} alt="" />}</span>
            <div>
              <h2 className="bh-title">{browser.browser_name}</h2>
              {versionDisplay && <div className="bh-meta">v{versionDisplay}</div>}
            </div>
          </div>
        </div>

        <div className="browser-config">
          <div className="config-field">
            <label>可执行文件路径</label>
            <div className="config-field-row">
              <div className="config-dir-input-wrap">
                <input
                  type="text" className="config-input"
                  value={localExePath}
                  onChange={e => setLocalExePath(e.target.value)}
                  onBlur={() => onExePathChange(localExePath)}
                  placeholder="例如: C:\Program Files...\msedge.exe"
                />
                {onCheckPath && pathStatus[exePathProp] === 'valid' && <span className="path-status-icon path-valid">✓</span>}
                {onCheckPath && pathStatus[exePathProp] === 'invalid' && <span className="path-status-icon path-invalid">✕</span>}
              </div>
              {onBrowseFile && (
                <button className="config-btn-browse" onClick={browseExePath} title="选择文件">
                  <span className="icon-with-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="4" x2="12" y2="20" /><line x1="4" y1="12" x2="20" y2="12" /></svg>
                  </span>
                </button>
              )}
              {onOpenDir && (
                <button className="config-btn-folder" onClick={() => openExeFolder(exePathProp)} title="打开目录">
                  <span className="icon-with-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="config-field">
            <label>用户数据目录</label>
            {userDirs.map((dir, i) => (
              <div key={i} className="config-dir-row">
                <div className="config-dir-input-wrap">
                  <input
                    type="text" className="config-input"
                    value={i in localDirEdits ? localDirEdits[i] : dir}
                    readOnly={dir === browser.default_user_data_dir}
                    onChange={e => setLocalDirEdits(prev => ({ ...prev, [i]: e.target.value }))}
                    onBlur={() => commitDirEdit(i)}
                  />
                  {dir === browser.default_user_data_dir && <span className="config-dir-badge-inside">默认</span>}
                  {onCheckPath && pathStatus[dir] === 'valid' && <span className="path-status-icon path-valid">✓</span>}
                  {onCheckPath && pathStatus[dir] === 'invalid' && <span className="path-status-icon path-invalid">✕</span>}
                </div>
                {onOpenDir && (
                  <button className="config-btn-folder" onClick={async () => { try { await onOpenDir(dir); } catch {} }} title="打开目录">
                    <span className="icon-with-badge">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                      <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    </span>
                  </button>
                )}
                {dir !== browser.default_user_data_dir ? (
                  <button className="config-btn-remove" onClick={() => removeDir(i)} title="移除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                ) : <div className="config-btn-spacer" />}
              </div>
            ))}
            {browser.browser_type !== 'edecker' && (localSuggestedDirs.filter(d => !userDirs.includes(d)).length ?? 0) > 0 && (
              <div className="config-suggested-dirs">
                {localSuggestedDirs.filter(d => !userDirs.includes(d)).map(d => (
                  <div key={d} className="config-suggested-dir" onClick={() => addDir(d)} title="点击添加">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    <span>{d}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="config-add-dir">
              <input
                type="text" className="config-input config-input-sm"
                value={newDir}
                onChange={e => setNewDir(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addDir()}
                placeholder="添加目录..."
              />
              <button className="config-btn-browse" onClick={() => addDir()} title="添加">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              {onBrowseDirectory && (
                <button className="config-btn-folder" onClick={browseDirectories} title="选择目录">
                  <span className="icon-with-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="4" x2="12" y2="20" /><line x1="4" y1="12" x2="20" y2="12" /></svg>
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* ── 易得客专属：配置目录（店铺实际路径 {UserData的父目录}\Profiles，只读） ── */}
          {browser.browser_type === 'edecker' && browser.default_user_data_dir && (() => {
            const profilesPath = browser.default_user_data_dir!.replace(/\\User Data$/i, '') + '\\Profiles';
            return (
              <div className="config-field">
                <label>配置目录</label>
                <div className="config-dir-row">
                  <div className="config-dir-input-wrap">
                    <input
                      type="text" className="config-input"
                      value={profilesPath}
                      readOnly
                    />
                    <span className="config-dir-badge-inside">店铺目录</span>
                    {onCheckPath && pathStatus[profilesPath] === 'valid' && <span className="path-status-icon path-valid">✓</span>}
                    {onCheckPath && pathStatus[profilesPath] === 'invalid' && <span className="path-status-icon path-invalid">✕</span>}
                  </div>
                  {onOpenDir && (
                      <button className="config-btn-folder" onClick={async () => { try { await onOpenDir(profilesPath); } catch {} }} title="打开目录">
                        <span className="icon-with-badge">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                          <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                        </span>
                      </button>
                    )}
                    <div className="config-btn-spacer" />
                </div>
              </div>
            );
          })()}

          {onCreateUserDataDir && (
            <div className="config-actions">
              <Button variant="primary" onClick={() => setNewUserModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
                新增用户
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (!window.confirm(`确定要关闭所有 ${browser.browser_name} 进程吗？`)) return;
                  try {
                    const msg = await killAllBrowserProcesses(browser.browser_type);
                    showToast(msg, "success");
                  } catch (e) {
                    showToast(`清空进程失败: ${e}`, "error");
                  }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4" y1="4" x2="20" y2="20"/><line x1="4" y1="20" x2="20" y2="4"/></svg>
                清空进程
              </Button>
            </div>
          )}
        </div>

        {hasProfiles && filterDirs.length > 1 && (
          <div className="dir-filter-bar">
            <div className="dir-filter-pills">
              <span className="dir-filter-label">显示目录：</span>
              {filterDirs.map(dir => (
                <button
                  key={dir}
                  className={`dir-filter-pill ${selectedDirs.includes(dir) ? 'active' : ''}`}
                  onClick={() => {
                    const next = selectedDirs.includes(dir) ? selectedDirs.filter(d => d !== dir) : [...selectedDirs, dir];
                    setSelectedDirs(next);
                  }}
                >
                  {dirDisplayNames[dir]}
                  <span className="dir-filter-count">{profiles.filter(p => p.user_data_dir === dir).length}</span>
                </button>
              ))}
            </div>
            {selectedDirs.length < filterDirs.length && (
              <button className="dir-filter-clear" onClick={() => setSelectedDirs([...filterDirs])}>显示全部</button>
            )}
          </div>
        )}

        {/* ── 紫鸟 CDP patch 状态卡片（应用内无痕化） ── */}
        {browser.browser_type === 'ziniao' && ziniaoPatch.supported && (
          <div className={`ziniao-patch-card ${ziniaoPatch.patched ? 'ok' : 'warn'}`}>
            <div className="ziniao-patch-info">
              <div className="ziniao-patch-title">
                <span className={`ziniao-patch-dot ${ziniaoPatch.patched ? 'ok' : 'warn'}`} />
                {ziniaoPatch.loading
                  ? '检测中…'
                  : ziniaoPatch.v109
                    ? '补丁 v10.9 已生效（CDP 多开 + agent_mode 直开环境）'
                    : ziniaoPatch.patched
                      ? '补丁 v10.8 已生效（CDP 多开，可升级 v10.9）'
                      : 'CDP 多开补丁未安装'}
              </div>
              {!ziniaoPatch.loading && <div className="ziniao-patch-detail">{ziniaoPatch.detail}</div>}
            </div>
            {!ziniaoPatch.v109 && (
              <Button
                variant="primary"
                size="sm"
                disabled={ziniaoPatch.loading || ziniaoPatch.patching}
                onClick={applyZiniaoPatch}
              >
                {ziniaoPatch.patching ? '安装中…' : ziniaoPatch.patched ? '升级到 v10.9' : '一键安装'}
              </Button>
            )}
          </div>
        )}

        {/* ── 子浏览器窗口列表（易得客店铺窗口 / 紫鸟环境窗口） ── */}
        {['edecker', 'ziniao'].includes(browser.browser_type) && browser.children && browser.children.length > 0 && (
          <>
            <div className="profiles-section-title">
              {browser.browser_type === 'edecker' ? '店铺窗口' : '环境窗口'} ({browser.children.length})
            </div>
            <div className="profiles-grid">
              {browser.children.filter(c => c.enabled).map((child, _idx) => (
                <div className="profile-card" key={child.user_data_dir}>
                  <div className="pc-avatar">
                    <div className="avatar-placeholder">{browser.browser_type === 'edecker' ? '店' : '环'}</div>
                  </div>
                  <div className="pc-body">
                    <div className="pc-top">
                      <div className="pc-name-row">
                        <span className="pc-name">{child.name}</span>
                        <span className="pc-badge">{browser.browser_type === 'edecker' ? '店铺' : '环境'}</span>
                      </div>
                    </div>
                    <div className="pc-details">
                      <div className="pc-detail">
                        <span className="pc-label">用户数据目录</span>
                        <code>{child.user_data_dir}</code>
                      </div>
                      {child.proxy_ip && (
                        <div className="pc-detail">
                          <span className="pc-label">代理 IP</span>
                          <code>{child.proxy_ip}</code>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {hasProfiles && filteredProfiles.length > 0 && (
          <>
            <div className="profiles-section-title">
              用户配置 ({filteredProfiles.length}{selectedDirs.length < filterDirs.length ? ` / ${profiles.length}` : ''})
            </div>
            <div className="profiles-grid">
              {filteredProfiles.map(p => {
                return (
                  <div className="profile-card" key={`${p.user_data_dir}|${p.id}`}>
                    <div className="pc-avatar">
                      {p.avatar_base64 ? (
                        <img src={p.avatar_base64} alt={p.name} className="avatar-img" />
                      ) : (
                        <div className="avatar-placeholder">{p.name.charAt(0).toUpperCase()}</div>
                      )}
                    </div>
                    <div className="pc-body">
                      <div className="pc-top">
                        <div className="pc-name-row">
                          <span className="pc-name">{p.name}</span>
                          {p.user_data_dir === browser.default_user_data_dir && <span className="pc-badge">默认</span>}
                          {filterDirs.length > 1 && <span className="pc-dir-tag">{dirDisplayNames[p.user_data_dir] || p.user_data_dir.replace(/^.*[\\\/]/, '')}</span>}
                        </div>
                        {p.email && (
                          <div className="pc-user">
                            {p.user_name && <span>{p.user_name}</span>}
                            {p.user_name && p.email && <span className="pc-dot">·</span>}
                            <span>{p.email}</span>
                          </div>
                        )}
                      </div>
                      <div className="pc-details">
                        <div className="pc-detail"><span className="pc-label">Profile ID</span><code>{p.id}</code></div>
                        <div className="pc-detail"><span className="pc-label">用户数据目录</span><code>{p.user_data_dir}</code></div>
                        {p.path && p.path !== p.user_data_dir && (
                          <div className="pc-detail"><span className="pc-label">Profile 路径</span><code>{p.path}</code></div>
                        )}
                        {p.download_dir && (
                          <div className="pc-detail"><span className="pc-label">下载目录</span><code>{p.download_dir}</code></div>
                        )}
                      </div>
                      {(onLaunchProfile || onGetLaunchCommand || onCreateShortcut) && (
                        <div className="pc-actions">
                          <div className="pc-btn-row">
                            {onLaunchProfile && (
                              <Button variant="primary" size="sm" onClick={() => doLaunch(p, "")}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>启动
                              </Button>
                            )}
                            {onLaunchProfile && (
                              <Button size="sm" className="ui-btn-debug" onClick={() => doDebugLaunch(p)} title="随机可用端口调试启动">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>调试启动
                              </Button>
                            )}
                            {onGetLaunchCommand && (
                              <Button size="sm" onClick={() => doShowCommand(p, "")}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M8 3H3v5M3 16v5h5M16 21h5v-5" /><path d="M21 3l-7 7M3 21l7-7" /></svg>命令
                              </Button>
                            )}
                            {onCreateShortcut && (
                              <Button size="sm" onClick={async () => {
                                try {
                                  const msg = await onCreateShortcut(browser.browser_type, p.id, p.user_data_dir, p.name, p.avatar_base64 ?? "", 0);
                                  if (msg.startsWith("overwrite:")) {
                                    showToast(`已覆盖桌面快捷方式: ${p.name}`, "warning");
                                  } else {
                                    showToast(`已创建桌面快捷方式: ${msg}`, "success");
                                  }
                                } catch (e) { showToast(`创建快捷方式失败: ${e}`, "error"); }
                              }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>快捷方式
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {hasProfiles && profiles.length > 0 && filteredProfiles.length === 0 && (
          <div className="empty-filter-state">当前没有选中的目录</div>
        )}
      </div>

      {/* ── 命令 Modal ── */}
      {cmdModal && (
        <div className="modal-overlay" onClick={() => setCmdModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>启动命令 — {cmdModal.profile.name}</h3>
              <button className="modal-close" onClick={() => setCmdModal(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="cmd-field"><label>完整命令</label><div className="cmd-box"><code>{cmdModal.info.command_line}</code><button className="cmd-copy" onClick={() => navigator.clipboard.writeText(cmdModal.info.command_line)}>复制</button></div></div>
              <div className="cmd-field"><label>可执行文件</label><code className="cmd-inline">{cmdModal.info.exe_path}</code></div>
              <div className="cmd-field"><label>调试端口</label><code className="cmd-inline" style={{ color: "var(--text-secondary)", userSelect: "none" }}>--remote-debugging-port=&lt;端口号&gt;</code></div>
              <div className="cmd-field"><label>参数</label><div className="cmd-args">{cmdModal.info.args.map((arg, i) => <code key={i} className="cmd-arg">{arg}</code>)}</div></div>
            </div>
            <div className="modal-footer">
              {onLaunchProfile && (
                <Button variant="primary" onClick={() => { doLaunch(cmdModal.profile, cmdModal.portStr); setCmdModal(null); }}>启动浏览器</Button>
              )}
              <Button onClick={() => setCmdModal(null)}>关闭</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 新增用户 Modal ── */}
      {newUserModal && onCreateUserDataDir && (
        <div className="modal-overlay" onClick={() => { if (!creating) { setNewUserModal(false); setNewUserName(""); setCustomParentDir(""); } }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新增浏览器用户</h3>
              <button className="modal-close" onClick={() => { setNewUserModal(false); setNewUserName(""); setCustomParentDir(""); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="config-field"><label>浏览器类型</label><input type="text" className="config-input" value={browser.browser_name} disabled /></div>
              <div className="config-field" style={{ marginTop: 12 }}>
                <label>用户目录名称</label>
                <input type="text" className="config-input" value={newUserName} onChange={e => setNewUserName(e.target.value)} onKeyDown={e => e.key === "Enter" && !creating && handleCreateUser()} placeholder="例如: Work、Personal、Shopping" disabled={creating} autoFocus />
              </div>
              <div className="config-field" style={{ marginTop: 12 }}>
                <label>创建位置（可自定义）</label>
                <div className="config-dir-row">
                  <div className="config-dir-input-wrap">
                    <input 
                      type="text" className="config-input" 
                      value={customParentDir || defaultNewUserParentDir}
                      onChange={e => setCustomParentDir(e.target.value)}
                      placeholder="选择或输入目标目录"
                      disabled={creating}
                    />
                  </div>
                  {onBrowseDirectory && (
                    <button className="config-btn-folder" onClick={async () => {
                      try {
                        const result = await onBrowseDirectory();
                        const dir = Array.isArray(result) ? result[0] : result;
                        if (dir) setCustomParentDir(dir as string);
                      } catch {}
                    }} disabled={creating} title="浏览选择目录">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    </button>
                  )}
                  <div className="config-btn-spacer" />
                </div>
                <code className="cmd-inline">{(customParentDir || defaultNewUserParentDir || "（未选择）").replace(/\\+$/, '') + '\\' + (sanitizeDirName(newUserName) || "目录名称")}</code>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="primary" onClick={handleCreateUser} disabled={creating}>{creating ? "创建中..." : "创建并添加"}</Button>
              <Button onClick={() => { setNewUserModal(false); setNewUserName(""); setCustomParentDir(""); }} disabled={creating}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default BrowserConfigPanel;
