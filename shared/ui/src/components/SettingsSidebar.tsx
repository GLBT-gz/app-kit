import { Fragment, useCallback, useRef, useEffect } from "react";

export function SettingsSidebar({
  tabs,
  activeTab,
  onTabChange,
  sidebarWidth,
  onWidthChange,
}: {
  tabs: Array<{ id: string; label: string; icon: React.ReactNode; dividerBefore?: boolean }>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  sidebarWidth: number;
  onWidthChange: (w: number) => void;
}) {
  const dragRef = useRef({ x: 0, w: 0 });

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      onWidthChange(Math.max(60, Math.min(380, dragRef.current.w + ev.clientX - dragRef.current.x)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    dragRef.current = { x: e.clientX, w: sidebarWidth };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth, onWidthChange]);

  const navMode = sidebarWidth >= 200 ? "wide" : sidebarWidth >= 130 ? "medium" : "compact";

  // ── 原生 wheel 事件监听（passive: true） ──
  // 用 ref 持有动态值，避免监听器在每次 props 变化时重建
  const divRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const curTabs = tabsRef.current;
      const idx = curTabs.findIndex(t => t.id === activeTabRef.current);
      if (idx < 0) return;
      if (e.deltaY > 0 && idx < curTabs.length - 1) {
        onTabChangeRef.current(curTabs[idx + 1].id);
      } else if (e.deltaY < 0 && idx > 0) {
        onTabChangeRef.current(curTabs[idx - 1].id);
      }
    };
    // passive:true → 浏览器永不等待 JS，滚动和 wheel 事件完全解耦
    el.addEventListener("wheel", handler, { passive: true });
    return () => el.removeEventListener("wheel", handler);
  }, []); // 空依赖：只绑定一次，永不重建

  return (
    <div className="settings-sidebar" ref={divRef} style={{ width: sidebarWidth }} data-mode={navMode}>
      {tabs.map(tab => (
        <Fragment key={tab.id}>
          {tab.dividerBefore && <div className="settings-tab-divider" />}
          <button
            className={`settings-tab-item ${activeTab === tab.id ? "active" : ""} ${navMode === "compact" ? "icon-only" : ""}`}
            onClick={() => onTabChange(tab.id)}
            title={navMode === "compact" ? tab.label : undefined}
          >
            <span className="sti-icon">{tab.icon}</span>
            {navMode !== "compact" && <span className="sti-label">{tab.label}</span>}
          </button>
        </Fragment>
      ))}
      <div className="sidebar-resize-handle" onMouseDown={startDrag} />
    </div>
  );
}
