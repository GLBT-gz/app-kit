import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

/** 表格列定义（收敛自 006/007 的 VirtualTable） */
export interface TableColumn<T> {
  header: string;
  render: (row: T, index: number) => React.ReactNode;
  style?: React.CSSProperties;
  /** 表头点击事件（如「全选/全不选」开关列）；存在时表头文字变为可点击 */
  headerClick?: () => void;
  /** 单元格右键事件（td 级，覆盖整个单元格而不限文字区域） */
  onContextMenu?: (e: React.MouseEvent, row: T) => void;
}

/** 从渲染结果中递归提取纯文本（JSX / 函数组件 / 数组），用于 Ctrl+C 复制 */
export function toText(v: React.ReactNode): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(toText).join("");
  // JSX 渲染的单元格（如 SkuCell 带高亮 span）：递归提取文本，保证 Ctrl+C 可复制
  if (typeof v === "object") {
    const el = v as { type?: unknown; props?: { children?: React.ReactNode } };
    // 自定义函数组件：props 无 children，需执行组件取渲染结果再递归
    if (typeof el.type === "function") {
      return toText((el.type as (props: unknown) => React.ReactNode)(el.props));
    }
    const children = el.props?.children;
    if (children !== undefined) return toText(children);
  }
  return "";
}

/** 渲染单元格：字符串文本自动带 title 悬停提示（超出省略时可查看完整内容） */
export function CellContent({ children }: { children: React.ReactNode }) {
  if (typeof children === "string" || typeof children === "number") {
    return <span title={String(children)}>{children}</span>;
  }
  return <>{children}</>;
}

/**
 * 表格单元格框选 + Ctrl+C 复制（保持表格结构粘贴进 Excel）：
 *  按下拖拽框选矩形区域，Ctrl+C 复制选中区域；getCellText(r, c) 提供选中单元格的复制文本。
 *  容器级事件委托：表格容器绑定 onMouseDown/onMouseMove/onMouseUp/onMouseLeave，
 *  单元格 td 需要带 data-r / data-c 属性。虚拟滚动大表与结果小表共用同一套交互。
 *  可选 onDeleteSelection：存在选中区域时按 Delete/Backspace 触发（002 等页面的删行功能）。
 */
export function useTableSelectionCopy(
  getCellText: (r: number, c: number) => string,
  onDeleteSelection?: (r1: number, r2: number) => void,
) {
  const [selStart, setSelStart] = useState<{ r: number; c: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ r: number; c: number } | null>(null);
  const draggingRef = useRef(false);
  const [copyTip, setCopyTip] = useState("");
  const copyTipTimerRef = useRef(0);
  const getCellTextRef = useRef(getCellText);
  getCellTextRef.current = getCellText;
  const onDeleteRef = useRef(onDeleteSelection);
  onDeleteRef.current = onDeleteSelection;

  /** 从事件目标向上找 td，读取 data-r / data-c */
  const getCellPos = (target: EventTarget | null): { r: number; c: number } | null => {
    const el = (target as HTMLElement | null)?.closest?.("td");
    if (!el) return null;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    return Number.isNaN(r) || Number.isNaN(c) ? null : { r, c };
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const pos = getCellPos(e.target);
    if (!pos) {
      // 点击空白处清除选择
      setSelStart(null);
      setSelEnd(null);
      return;
    }
    e.preventDefault(); // 阻止原生文字选择，改为单元格框选
    draggingRef.current = true;
    setSelStart(pos);
    setSelEnd(pos);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    const pos = getCellPos(e.target);
    if (!pos) return;
    setSelEnd((prev) => (prev && prev.r === pos.r && prev.c === pos.c ? prev : pos));
  }, []);

  const endDrag = useCallback(() => { draggingRef.current = false; }, []);

  const selectedRange = (): { r1: number; c1: number; r2: number; c2: number } | null => {
    if (!selStart || !selEnd) return null;
    return {
      r1: Math.min(selStart.r, selEnd.r),
      c1: Math.min(selStart.c, selEnd.c),
      r2: Math.max(selStart.r, selEnd.r),
      c2: Math.max(selStart.c, selEnd.c),
    };
  };

  // Ctrl+C 复制选中区域；Delete/Backspace 删选中行（onDeleteSelection 存在时）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 焦点在输入框/下拉等可编辑元素时，不拦截按键，让浏览器原生行为
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      const range = selectedRange();
      if (!range) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const lines: string[] = [];
        for (let r = range.r1; r <= range.r2; r++) {
          const cells: string[] = [];
          for (let c = range.c1; c <= range.c2; c++) cells.push(getCellTextRef.current(r, c));
          lines.push(cells.join("\t"));
        }
        navigator.clipboard.writeText(lines.join("\n")).then(() => {
          const count = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
          setCopyTip(`✓ 已复制 ${count} 个单元格`);
          window.clearTimeout(copyTipTimerRef.current);
          copyTipTimerRef.current = window.setTimeout(() => setCopyTip(""), 1500);
        }).catch(() => {});
      } else if ((e.key === "Delete" || e.key === "Backspace") && onDeleteRef.current) {
        e.preventDefault();
        onDeleteRef.current(range.r1, range.r2);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selStart, selEnd]);

  const isSelected = useCallback((r: number, c: number): boolean => {
    if (!selStart || !selEnd) return false;
    return r >= Math.min(selStart.r, selEnd.r) && r <= Math.max(selStart.r, selEnd.r)
      && c >= Math.min(selStart.c, selEnd.c) && c <= Math.max(selStart.c, selEnd.c);
  }, [selStart, selEnd]);

  return { handleMouseDown, handleMouseMove, endDrag, isSelected, copyTip };
}

/** 虚拟滚动表格 - 只渲染可视区域内的行，适合大列表；支持文本框选复制、悬停提示、表头点击
 *
 * 虚拟滚动**始终启用**(`virtual=true` 是默认且唯一行为):只渲染可视行 + 上下 overscan 行,
 * 万行表格 DOM 节点数 ≈ 屏幕可见行数 × 列数;`virtual=false` 强制全量渲染(适合
 * rows.length < 200 的小表,可以省掉 ResizeObserver/scroll state 的开销)。
 *
 * fixedLayout=true 时列宽按「采样估算」计算(头 N 行 + 尾 N 行 + 中间采样)
 * —— **不会**遍历全表。已指定 style.width 的列按指定值;默认 auto 布局
 * (列宽随当前可见行内容自适应)。
 *
 * stickyLeft=N 时冻结左侧前 N 列（横向滚动保持显示，末列右侧自动加 accent 分隔线）；
 * 实现要点：border-collapse: separate（sticky 独立边框无共享错位）+ thead 整体 zIndex 高于冻结 td
 * （整行表头永远在最上）；sticky 偏移用表头实测宽度（浏览器布局后真实列宽）。
 */
function VirtualTableInner<T>({ rows, columns, rowClassName, emptyText, listHeader, virtual = true, fixedLayout, stickyLeft = 0, showIndex = false, onDeleteSelection, className, style, sampleHead = 200, sampleTail = 50, sampleStride = 50 }: {
  rows: T[];
  columns: TableColumn<T>[];
  rowClassName?: (row: T) => string | undefined;
  /** 空状态文案，可传 ReactNode（如带 spinner 的「正在加载…」） */
  emptyText?: React.ReactNode;
  listHeader?: React.ReactNode;
  /**
   * 是否启用虚拟滚动。
   * - `true`(默认):只渲染可视行 + overscan,大表必备。
   * - `false`:全量渲染所有行(适合 <200 行的小表,省掉 ResizeObserver/scroll state 开销)。
   */
  virtual?: boolean;
  fixedLayout?: boolean;
  /** 冻结左侧前 N 列（横向滚动时保持显示；默认 0 不冻结） */
  stickyLeft?: number;
  /** 是否在最左侧显示「序号」列（各项目按需开启；默认不显示，避免全局硬编码影响所有使用方） */
  showIndex?: boolean;
  /** 框选后按 Delete/Backspace 时回调 (r1, r2)，由调用方决定如何处理选中行区间（如清空某几列、清空整行）。 */
  onDeleteSelection?: (r1: number, r2: number) => void;
  /** 追加到滚动容器（.inventory-table-scroll）上的 CSS 类名，便于项目本地控制显隐（如 .log-panel--hidden）。 */
  className?: string;
  /** 追加到滚动容器的内联样式，用于 display:none 显隐等不能用 class 表达的场景。 */
  style?: React.CSSProperties;
  /** fixedLayout 模式下列宽估算时取头部多少行（默认 200） */
  sampleHead?: number;
  /** fixedLayout 模式下列宽估算时取尾部多少行（默认 50，覆盖表格末尾的长字符串） */
  sampleTail?: number;
  /** fixedLayout 模式下列宽估算时中间采样步长（每 N 行取 1 行，默认 50） */
  sampleStride?: number;
}): React.JSX.Element {
  // 「序号」列由各项目按需开启（showIndex），不再全局硬编码——否则所有使用该组件的表格都会出现序号列
  const allColumns: TableColumn<T>[] = [];
  if (showIndex) {
    allColumns.push({ header: "序号", render: (_r, index) => index + 1, style: { width: 48, textAlign: "center", color: "var(--text-secondary)" } });
  }
  allColumns.push(...columns);
  // 固定列宽模式：列宽按「采样估算」计算（头 sampleHead 行 + 尾 sampleTail 行 + 中间 stride 采样），
  // 避免遍历几万行导致 fixedLayout 在大表上成为性能瓶颈。
  // 已指定 style.width 的列按指定值；其余取表头与采样行该列渲染文本的最大估算宽度（中文 14px/字、ASCII 8px/字 + 内边距）。
  const colWidths = useMemo(() => {
    if (!fixedLayout) return null;
    const textWidth = (s: string) => {
      let w = 0;
      for (const ch of s) w += ch.charCodeAt(0) > 255 ? 14 : 8;
      return w;
    };
    // 采样下标：头 sampleHead 行 + 尾 sampleTail 行 + 中间按 stride 采样
    const sampleIdx: number[] = [];
    const head = Math.min(sampleHead, rows.length);
    for (let i = 0; i < head; i++) sampleIdx.push(i);
    if (sampleTail > 0 && rows.length > head) {
      const tailStart = Math.max(head, rows.length - sampleTail);
      for (let i = tailStart; i < rows.length; i++) sampleIdx.push(i);
    }
    if (sampleStride > 1) {
      for (let i = head; i < Math.max(head, rows.length - sampleTail); i += sampleStride) {
        if (i >= head && i < (rows.length - sampleTail)) sampleIdx.push(i);
      }
    }
    return allColumns.map((col, ci) => {
      if (col.style?.width !== undefined) return col.style.width as number;
      let w = textWidth(col.header) + 24;
      for (const idx of sampleIdx) {
        const r = rows[idx];
        if (r !== undefined) w = Math.max(w, textWidth(toText(col.render(r, ci))) + 24);
      }
      return Math.min(800, w);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedLayout, columns, rows, sampleHead, sampleTail, sampleStride]);
  const ROW_HEIGHT = 28;
  const OVERSCAN = 15;
  const containerRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const rafRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [theadHeight, setTheadHeight] = useState(0);
  // 冻结列表头实测宽度（浏览器布局后真实列宽，fixed/auto 布局下 sticky 偏移均以实测为准）
  const [thWidths, setThWidths] = useState<number[]>([]);

  // 冻结列水平偏移（第 i 列 sticky left 值）：
  // 优先用表头实测宽度（浏览器布局后的真实列宽——fixedLayout 下 width:100% 会把多余空间拉伸到各列，
  // 估算列宽 colWidths 与实际渲染不一致，sticky 偏移错位会在冻结列之间漏出滚动内容）；
  // 首帧尚未测量（thWidths 为空）时回退计算列宽 colWidths
  const stickyOffsets = useMemo(() => {
    const out: number[] = [];
    if (stickyLeft <= 0) return out;
    const widths = thWidths.length ? thWidths : colWidths;
    if (!widths || widths.length < stickyLeft) return out;
    let acc = 0;
    for (let i = 0; i < widths.length; i++) {
      out.push(acc);
      if (i < stickyLeft) acc += widths[i];
    }
    return out;
  }, [stickyLeft, colWidths, thWidths]);

  // ── 单元格级框选（按下拖拽框选矩形区域，Ctrl+C 复制为表格结构） ──
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const columnsRef = useRef(allColumns);
  columnsRef.current = allColumns;
  const sel = useTableSelectionCopy((r, c) => {
    const row = rowsRef.current[r];
    const col = columnsRef.current[c];
    if (!row || !col) return "";
    return toText(col.render(row, r));
  }, onDeleteSelection);

  // 测量表头实际高度（sticky 模式下顺带测量各列宽度，供冻结列偏移计算）
  useEffect(() => {
    if (theadRef.current) {
      const h = theadRef.current.offsetHeight;
      if (h > 0 && h !== theadHeight) setTheadHeight(h);
      if (stickyLeft > 0) {
        const widths = Array.from(theadRef.current.querySelectorAll<HTMLElement>("th")).map((el) => el.offsetWidth);
        setThWidths((prev) => (widths.length && (widths.length !== prev.length || widths.some((w, i) => w !== prev[i])) ? widths : prev));
      }
    }
  });

  // 仅在 virtual 模式下需要 ResizeObserver 测量容器高度（虚拟滚动需要它算可视行数）
  useEffect(() => {
    if (!virtual) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      if (el.offsetParent === null) return;
      setContainerHeight(el.clientHeight || 600);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [virtual]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    cancelAnimationFrame(rafRef.current);
    const st = e.currentTarget.scrollTop;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(st);
    });
  }, []);

  const th = theadHeight || 0;
  // 虚拟滚动：只渲染可视行 + 上下 overscan 行；非虚拟模式渲染全表（适合 < 200 行小表）
  const startIdx = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const endIdx = virtual ? Math.min(rows.length, Math.ceil((scrollTop + containerHeight - th) / ROW_HEIGHT) + OVERSCAN) : rows.length;
  const visibleRows = rows.slice(startIdx, endIdx);
  // 仅在 virtual 模式下需要 padding 行撑出"虚拟高度"，非虚拟模式 padding 全 0
  const topPadding = virtual ? startIdx * ROW_HEIGHT : 0;
  const bottomPadding = virtual ? (rows.length - endIdx) * ROW_HEIGHT : 0;

  // 滚动容器的合并 className/style（让项目本地控制显隐）
  const containerClass = ["inventory-table-scroll", className].filter(Boolean).join(" ");
  const containerStyle = style;

  if (rows.length === 0) {
    return (
      <div className={containerClass} style={{
        padding: 16, textAlign: "center", color: "var(--text-secondary)",
        display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1.6,
        ...containerStyle,
      }}>
        {emptyText || "暂无数据"}
      </div>
    );
  }

  return (
    <div className={containerClass} ref={containerRef} onScroll={handleScroll}
      style={containerStyle}
      onMouseDown={sel.handleMouseDown} onMouseMove={sel.handleMouseMove} onMouseUp={sel.endDrag} onMouseLeave={sel.endDrag}>
      {listHeader}
      {/* 冻结表头正确做法：
          1) border-collapse: separate + border-spacing 0 —— sticky 单元格独立边框，无 collapse 共享边框错位（缝类问题根除）；
             单元格只画 右侧+下侧 边框（外框：上=表头 th 的 borderTop、左=首列 borderLeft），视觉仍是 1px 网格线。
          2) 层级只有两级：thead 整体 z-index 2（建 stacking context，整行表头永远在最上）
             > tbody 冻结 td z-index 1 > 普通 td。不再逐单元格比较 zIndex。
          3) 表格自身不设 borderTop/borderLeft（外框由单元格边框实现）——否则文档流中表头/冻结列起点
             在边框内侧(1px)，sticky 吸到容器边缘(0px)，滚动瞬间产生 1px 跳变。 */}
      <table style={{
        width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12,
        ...(fixedLayout ? { tableLayout: "fixed" as const } : {}),
      }}>
        <thead ref={theadRef} style={{ position: "sticky", top: 0, zIndex: stickyLeft > 0 ? 2 : 1, background: "var(--bg-surface)" }}>
          <tr style={{ height: ROW_HEIGHT }}>
            {allColumns.map((col, ci) => {
              const sticky = stickyLeft > 0 && ci < stickyLeft;
              const off = sticky ? stickyOffsets[ci] : undefined;
              return (
                <th key={col.header} style={{
                  border: "none", borderTop: "1px solid var(--border)", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
                  ...(ci === 0 ? { borderLeft: "1px solid var(--border)" } : {}),
                  padding: "4px 6px", textAlign: "left", whiteSpace: "nowrap", background: "var(--bg-surface)",
                  ...(colWidths && colWidths[ci] !== undefined ? { width: colWidths[ci] } : {}),
                  // 冻结表头：thead 已 sticky top，th 只需 sticky left（在 thead stacking context 内盖住滚动表头）
                  ...(sticky && off !== undefined ? { position: "sticky" as const, left: off, zIndex: 1 } : {}),
                  ...(sticky && ci === stickyLeft - 1 ? { borderRight: "2px solid var(--accent, #4f6bf6)" } : {}),
                  ...col.style,
                }}>
                  {col.headerClick ? (
                    <button type="button" onClick={col.headerClick} title="点击切换：全部打开 / 全部关闭"
                      style={{ background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", color: "inherit", fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline dotted" }}>
                      {col.header}
                    </button>
                  ) : col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {topPadding > 0 && <tr><td colSpan={allColumns.length} style={{ height: topPadding, border: "none", padding: 0 }} /></tr>}
          {visibleRows.map((r, i) => {
            const rowIdx = startIdx + i;
            return (
              <tr key={rowIdx} style={{ height: ROW_HEIGHT }} className={rowClassName?.(r)}>
                {allColumns.map((col, ci) => {
                  const cellSel = sel.isSelected(rowIdx, ci);
                  const sticky = stickyLeft > 0 && ci < stickyLeft;
                  const off = sticky ? stickyOffsets[ci] : undefined;
                  return (
                    <td key={col.header} data-r={rowIdx} data-c={ci} onContextMenu={col.onContextMenu ? (e) => col.onContextMenu?.(e, r) : undefined} style={{
                      border: "none", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
                      ...(ci === 0 ? { borderLeft: "1px solid var(--border)" } : {}),
                      padding: "3px 6px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      // 单元格右键列：整格显示 context-menu 光标（提示整格可右键）
                      ...(col.onContextMenu ? { cursor: "context-menu" } : {}),
                      // 冻结数据列：sticky left + 不透明背景遮挡滚动内容；zIndex 1 低于表头 thead(2)，永远被表头覆盖
                      ...(sticky && off !== undefined ? { position: "sticky" as const, left: off, background: "var(--bg-surface)", zIndex: 1 } : {}),
                      ...(cellSel ? { background: "var(--bg-badge, #252736)" } : {}),
                      ...(sticky && ci === stickyLeft - 1 ? { borderRight: "2px solid var(--accent, #4f6bf6)" } : {}),
                      ...col.style,
                    }}><CellContent>{col.render(r, rowIdx)}</CellContent></td>
                  );
                })}
              </tr>
            );
          })}
          {bottomPadding > 0 && <tr><td colSpan={allColumns.length} style={{ height: bottomPadding, border: "none", padding: 0 }} /></tr>}
        </tbody>
      </table>
      {sel.copyTip && <div className="inventory-copy-tip">{sel.copyTip}</div>}
    </div>
  );
}

export const VirtualTable = memo(VirtualTableInner) as typeof VirtualTableInner;

/** 小表（全量渲染，无虚拟滚动；序号列按 showIndex 可选开启）：适合结果摘要类小表格 */
export function DataTable<T>({ rows, columns, emptyText = "暂无数据", maxHeight = 300, showIndex = false }: {
  rows: T[];
  columns: TableColumn<T>[];
  emptyText?: string;
  maxHeight?: number;
  /** 是否在最左侧显示「序号」列（默认不显示） */
  showIndex?: boolean;
}) {
  // 「序号」列由各项目按需开启（showIndex），不全局硬编码
  const allColumns: TableColumn<T>[] = [];
  if (showIndex) {
    allColumns.push({ header: "序号", render: (_r, index) => index + 1, style: { width: 48, textAlign: "center", color: "var(--text-secondary)" } });
  }
  allColumns.push(...columns);
  if (rows.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>
        {emptyText}
      </div>
    );
  }
  return (
    <div style={{ maxHeight, overflow: "auto" }}>
      <table style={{
        width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12,
      }}>
        <thead>
          <tr>
            {allColumns.map((col, ci) => (
              <th key={col.header} style={{
                border: "none", borderTop: "1px solid var(--border)", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
                ...(ci === 0 ? { borderLeft: "1px solid var(--border)" } : {}),
                padding: "4px 6px", textAlign: "left",
                whiteSpace: "nowrap", background: "var(--bg-surface)", position: "sticky", top: 0, zIndex: 1,
                ...col.style,
              }}>
                {col.headerClick ? (
                  <button type="button" onClick={col.headerClick} title="点击切换：全部打开 / 全部关闭"
                    style={{ background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", color: "inherit", fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline dotted" }}>
                    {col.header}
                  </button>
                ) : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {allColumns.map((col, ci) => (
                <td key={col.header} onContextMenu={col.onContextMenu ? (e) => col.onContextMenu?.(e, row) : undefined} style={{
                  border: "none", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
                  ...(ci === 0 ? { borderLeft: "1px solid var(--border)" } : {}),
                  padding: "3px 6px",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  ...(col.onContextMenu ? { cursor: "context-menu" } : {}),
                  ...col.style,
                }}>{col.render(row, i)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const MemoDataTable = memo(DataTable) as typeof DataTable;
