import { useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Switch } from "./controls/Switch";

// ═══════════════════════════════════════════════════════════
// ShopListPanel —— 店铺列表面板（收敛 002/003 各页面重复实现）：
//   - 拖拽排序（⠿ 手柄，mousemove 计算插入位置）
//   - 批量开关（长按开关向下拖动，批量启用/禁用店铺）
//   - 全选 / 全不选 / 默认选择 / 恢复默认排序
//   - 店铺摘要（运行结果 + 相对时间）、当前处理中店铺指示
// 类名与各项目历史实现保持一致（temu-*），视觉零变化。
// ═══════════════════════════════════════════════════════════

export interface ShopListShop {
  mall_name: string;
  mall_id?: string;
  alias?: string;
  owner?: string;
  /** 已配置主体（用于「默认选择」按钮与「未配置主体」标签） */
  entity?: string;
}

export interface ShopListPanelProps {
  title: ReactNode;
  shops: ShopListShop[];
  enabledMap: Record<string, boolean>;
  /** 店铺显示顺序（mall_name 数组，缺失的店铺自动追加到末尾） */
  shopOrder: string[];
  onOrderChange: (order: string[]) => void;
  /** 切换店铺启用状态；val 省略时取反 */
  onToggle: (mallName: string, val?: boolean) => void;
  /** 恢复默认排序 */
  onRestore: () => void;
  /** 列表容器 ref（批量切换的 hover 命中检测用） */
  shopTableRef: RefObject<HTMLDivElement | null>;
  /** 店铺运行结果摘要 */
  shopSummaries?: Record<string, { text: string; time: number }> | null;
  /** 当前处理中的店铺（显示 ▶ 处理中） */
  currentShop?: string | null;
  /** 顶部提示文字（如「拖拽排序 · 长按开关批量操作」） */
  hint?: string;
  /** 显示 全选/全不选/默认选择 按钮组 */
  showBulkButtons?: boolean;
  /** 店铺无主体（entity）时显示「未配置主体」标签（仅 Temu 每周店铺分析等需要按主体核算的场景开启） */
  showNoEntity?: boolean;
  /** 批量切换开始时回调（003 用于写日志） */
  onBatchToggle?: (togglingTo: boolean) => void;
  /** 批量切换结束（mouseup/离开）回调（003 用于写日志） */
  onBatchEnd?: () => void;
  /** 每行操作按钮区（渲染在信息区与开关之间，如「打开/激活」） */
  renderAction?: (shop: ShopListShop) => ReactNode;
  emptyText?: string;
  /** 额外 CSS class（追加到根 .temu-shop-section） */
  className?: string;
}

function fmtRelTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(diff / 3_600_000);
  if (hr < 24) return `${hr}小时前`;
  return `${Math.floor(diff / 86_400_000)}天前`;
}

export function ShopListPanel({
  title,
  shops,
  enabledMap,
  shopOrder,
  onOrderChange,
  onToggle,
  onRestore,
  shopTableRef,
  shopSummaries,
  currentShop,
  hint,
  showBulkButtons = false,
  showNoEntity = false,
  onBatchToggle,
  onBatchEnd,
  renderAction,
  emptyText = "暂无店铺数据",
  className,
}: ShopListPanelProps) {
  const orderedShops = useMemo(() => {
    const orderMap = new Map(shops.map(s => [s.mall_name, s]));
    const ordered: ShopListShop[] = [];
    for (const name of shopOrder) {
      const s = orderMap.get(name);
      if (s) ordered.push(s);
    }
    for (const s of shops) {
      if (!ordered.find(o => o.mall_name === s.mall_name)) ordered.push(s);
    }
    return ordered;
  }, [shops, shopOrder]);

  // ── 拖拽排序 ──
  const dragState = useRef<{ mallName: string; startY: number; itemHeight: number } | null>(null);
  const shopOrderRef = useRef(shopOrder);
  shopOrderRef.current = shopOrder;
  const dropIdxRef = useRef(-1);
  const [draggingName, setDraggingName] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState(-1);

  const handleDotMouseDown = useCallback((mallName: string, e: MouseEvent) => {
    e.preventDefault();
    const items = shopOrderRef.current;
    const fi = items.indexOf(mallName);
    if (fi === -1) return;
    const el = (e.currentTarget as HTMLElement).closest("[data-shop-name]");
    const itemHeight = el?.getBoundingClientRect().height ?? 48;
    dragState.current = { mallName, startY: e.clientY, itemHeight };
    setDraggingName(mallName);

    const handleMove = (ev: globalThis.MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const arr = shopOrderRef.current;
      const fi2 = arr.indexOf(ds.mallName);
      if (fi2 === -1) return;
      const dy = ev.clientY - ds.startY;
      const moveBy = Math.round(dy / ds.itemHeight);
      const targetIdx = Math.max(0, Math.min(arr.length - 1, fi2 + moveBy));
      let gap = -1;
      if (targetIdx !== fi2) gap = targetIdx < fi2 ? targetIdx : targetIdx + 1;
      dropIdxRef.current = gap;
      setDropIdx(gap);
    };
    const handleUp = () => {
      const ds = dragState.current;
      if (ds) {
        const arr = shopOrderRef.current;
        const fi3 = arr.indexOf(ds.mallName);
        const gap = dropIdxRef.current;
        if (gap !== -1 && fi3 !== -1) {
          const targetIdx = gap <= fi3 ? gap : gap - 1;
          if (targetIdx !== fi3) {
            const newOrder = [...arr];
            newOrder.splice(fi3, 1);
            newOrder.splice(targetIdx, 0, ds.mallName);
            onOrderChange(newOrder);
          }
        }
      }
      dragState.current = null;
      dropIdxRef.current = -1;
      setDraggingName(null);
      setDropIdx(-1);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [onOrderChange]);

  // ── 批量切换（长按开关拖动，跨店铺连续切换） ──
  const toggleDragRef = useRef<{ startY: number; mallName: string; moved: boolean } | null>(null);
  const batchRef = useRef<{ active: boolean; startY: number; lastToggled: string; togglingTo: boolean; shopRects: { top: number; bottom: number; name: string }[] } | null>(null);
  const toggledSet = useRef(new Set<string>());

  const handleToggleMouseDown = useCallback((e: MouseEvent, mallName: string) => {
    toggleDragRef.current = { startY: e.clientY, mallName, moved: false };
    toggledSet.current.clear();
  }, []);

  const handleListMouseMove = useCallback((e: MouseEvent) => {
    const td = toggleDragRef.current;
    if (td && !td.moved) {
      const dy = Math.abs(e.clientY - td.startY);
      if (dy >= 5) {
        td.moved = true;
        const currentVal = !!enabledMap[td.mallName];
        const rects: { top: number; bottom: number; name: string }[] = [];
        if (shopTableRef.current) {
          shopTableRef.current.querySelectorAll<HTMLElement>("[data-shop-name]").forEach(el => {
            const r = el.getBoundingClientRect();
            rects.push({ top: r.top, bottom: r.bottom, name: el.getAttribute("data-shop-name") || "" });
          });
        }
        const togglingTo = !currentVal;
        batchRef.current = { active: true, startY: td.startY, lastToggled: td.mallName, togglingTo, shopRects: rects };
        onToggle(td.mallName, togglingTo);
        toggledSet.current.add(td.mallName);
        onBatchToggle?.(togglingTo);
        return;
      }
    }
    const bRef = batchRef.current;
    if (bRef?.active) {
      const rects = bRef.shopRects;
      if (!rects.length) return;
      let hoveredShop: string | null = null;
      for (const r of rects) {
        if (e.clientY >= r.top && e.clientY <= r.bottom) { hoveredShop = r.name; break; }
      }
      if (hoveredShop && hoveredShop !== bRef.lastToggled && !toggledSet.current.has(hoveredShop)) {
        onToggle(hoveredShop, bRef.togglingTo);
        toggledSet.current.add(hoveredShop);
        bRef.lastToggled = hoveredShop;
      }
    }
  }, [enabledMap, onToggle, shopTableRef, onBatchToggle]);

  const handleListMouseUp = useCallback(() => {
    const wasBatch = !!batchRef.current?.active;
    const td = toggleDragRef.current;
    if (td && !td.moved) onToggle(td.mallName);
    toggleDragRef.current = null;
    if (batchRef.current) batchRef.current.active = false;
    batchRef.current = null;
    toggledSet.current.clear();
    if (wasBatch) onBatchEnd?.();
  }, [onToggle, onBatchEnd]);

  return (
    <div className={`temu-shop-section${className ? ` ${className}` : ""}`}>
      <div className="temu-card-header">
        <span className="temu-card-title">{title}</span>
        <span className="temu-card-count">{orderedShops.length}</span>
        <button className="temu-restore-btn" onClick={onRestore} title="恢复默认排序">默认排序</button>
        {showBulkButtons && (
          <>
            <button className="temu-default-select-btn" onClick={() => { orderedShops.forEach(s => { if (s.entity) onToggle(s.mall_name, true); }); }} title="仅选择已配置主体的店铺">默认选择</button>
            <button className="temu-select-all-btn" onClick={() => { orderedShops.forEach(s => onToggle(s.mall_name, true)); }} title="全选">全选</button>
            <button className="temu-deselect-all-btn" onClick={() => { orderedShops.forEach(s => onToggle(s.mall_name, false)); }} title="全不选">全不选</button>
          </>
        )}
        {hint && <span className="temu-card-hint">{hint}</span>}
      </div>
      <div className="temu-shop-list" ref={shopTableRef}
        onMouseMove={handleListMouseMove} onMouseUp={handleListMouseUp} onMouseLeave={handleListMouseUp}
      >
        {orderedShops.length === 0 ? (
          <div className="temu-shop-empty">{emptyText}</div>
        ) : (
          orderedShops.flatMap((s, i) => [
            <div key={`gap-${i}`} className={`drop-indicator${dropIdx === i ? " active" : ""}`} />,
            <div key={s.mall_id || s.mall_name}
              className={`temu-shop-item${!enabledMap[s.mall_name] ? " disabled" : ""}${draggingName === s.mall_name ? " dragging" : ""}`}
              data-shop-name={s.mall_name}
            >
              <div className="temu-shop-drag-handle" onMouseDown={(e) => handleDotMouseDown(s.mall_name, e)}>⠿</div>
              <div className="temu-shop-info">
                <div className="temu-shop-name">
                  {s.mall_name}
                  {currentShop === s.mall_name && <span className="shop-running-indicator">▶ 处理中</span>}
                </div>
                <div className="temu-shop-meta">
                  <span className="temu-shop-sub">{(s.alias || s.mall_name)}{s.owner ? ` · ${s.owner}` : ""}</span>
                  {showNoEntity && !s.entity && <span className="temu-no-entity">未配置主体</span>}
                  {shopSummaries?.[s.mall_name] && <span className="temu-shop-result">{shopSummaries[s.mall_name].text} · {fmtRelTime(shopSummaries[s.mall_name].time)}</span>}
                </div>
              </div>
              {renderAction?.(s)}
              <Switch
                checked={!!enabledMap[s.mall_name]}
                onMouseDown={(e) => handleToggleMouseDown(e, s.mall_name)}
                onChange={() => {}}
                readOnly
              />
            </div>,
          ]).concat(
            <div key={`gap-${orderedShops.length}`} className={`drop-indicator${dropIdx === orderedShops.length ? " active" : ""}`} />
          )
        )}
      </div>
    </div>
  );
}
