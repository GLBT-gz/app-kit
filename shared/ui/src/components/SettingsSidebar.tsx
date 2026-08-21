import { useCallback, useRef, useEffect } from "react";

// 设置侧边栏宽度比例范围（%）：窗口全屏/缩小时按比例伸缩，不会在小窗口下占满屏幕
const SIDEBAR_MIN_PCT = 6;
const SIDEBAR_MAX_PCT = 40;

export function SettingsSidebar({
  tabs,
  activeTab,
  onTabChange,
  sidebarWidth,
  onWidthChange,
}: {
  tabs: Array<{ id: string; label: string; icon: React.ReactNode }>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** 侧边栏宽度占比（0-100，%；旧版固定 px 由 AppLayout 统一迁移） */
  sidebarWidth: number;
  onWidthChange: (w: number) => void;
}) {
  const dragRef = useRef({ x: 0, w: 0 });
  // 容器宽度（px）：拖拽时把位移换算为比例；取自父容器（settings-panel 整宽）
  const containerWRef = useRef(0);
  const divRef = useRef<HTMLDivElement>(null);

  // 防御：旧版固定 px（如 175/340）会大于 100，clamp 到合理占比
  const safePct = Math.min(SIDEBAR_MAX_PCT, Math.max(SIDEBAR_MIN_PCT, sidebarWidth));

  // 测量父容器宽度：首次渲染同步取一次，ResizeObserver 跟随窗口缩放
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const update = () => {
      containerWRef.current = el.parentElement?.clientWidth ?? 0;
    };
    update();
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  // 实际像素宽度 = 比例 × 容器宽；navMode 阈值仍按 px 判断（label 有最小显示空间）
  const sidebarPx = (containerWRef.current * safePct) / 100;
  const navMode = sidebarPx >= 200 ? "wide" : sidebarPx >= 130 ? "medium" : "compact";

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const w = containerWRef.current;
      if (w <= 0) return;
      const newPct = dragRef.current.w + ((ev.clientX - dragRef.current.x) / w) * 100;
      onWidthChange(Math.min(SIDEBAR_MAX_PCT, Math.max(SIDEBAR_MIN_PCT, newPct)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    dragRef.current = { x: e.clientX, w: safePct };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [safePct, onWidthChange]);

  // ── 原生 wheel 事件监听（passive: true） ──
  // 用 ref 持有动态值，避免监听器在每次 props 变化时重建
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
    <div className="settings-sidebar" ref={divRef} style={{ width: `${safePct}%` }} data-mode={navMode}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`settings-tab-item ${activeTab === tab.id ? "active" : ""} ${navMode === "compact" ? "icon-only" : ""}`}
          onClick={() => onTabChange(tab.id)}
          title={navMode === "compact" ? tab.label : undefined}
        >
          <span className="sti-icon">{tab.icon}</span>
          {navMode !== "compact" && <span className="sti-label">{tab.label}</span>}
        </button>
      ))}
      <div className="sidebar-resize-handle" onMouseDown={startDrag} />
    </div>
  );
}
