import { useCallback, useEffect, useRef, useState } from "react";
import { safeGetJSON, safeSetJSON, LS_KEYS } from "../../localStorageKeys";
import { getBrowserIcon } from "../../utils/browser-icons";
import type { BrowserConfigPanelProps } from "./types";
import { BrowserConfigItem } from "./Item";

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
    const v = safeGetJSON<number>(LS_KEYS.BCP_SIDEBAR_WIDTH);
    // 防御：仅接受合理 px 范围。旧版比例残留值（6-40 等）或损坏数据会被判为非法并回退默认
    return typeof v === "number" && v >= 60 && v <= 380 ? v : initialSidebarWidth;
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
