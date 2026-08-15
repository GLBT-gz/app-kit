import { memo, useCallback, useEffect, useRef, useState } from "react";

/** 表格列定义（收敛自 006/007 的 VirtualTable） */
export interface TableColumn<T> {
  header: string;
  render: (row: T, index: number) => React.ReactNode;
  style?: React.CSSProperties;
  /** 表头点击事件（如「全选/全不选」开关列）；存在时表头文字变为可点击 */
  headerClick?: () => void;
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

/** 虚拟滚动表格 - 只渲染可视区域内的行，适合大列表；支持文本框选复制、悬停提示、表头点击 */
function VirtualTableInner<T>({ rows, columns, rowClassName, emptyText, listHeader }: {
  rows: T[];
  columns: TableColumn<T>[];
  rowClassName?: (row: T) => string | undefined;
  emptyText?: string;
  listHeader?: React.ReactNode;
}): React.JSX.Element {
  // 所有表格统一在最左侧加「序号」列（从 1 开始递增）
  const allColumns: TableColumn<T>[] = [
    { header: "序号", render: (_r, index) => index + 1, style: { width: 48, textAlign: "center", color: "var(--text-secondary)" } },
    ...columns,
  ];
  const ROW_HEIGHT = 28;
  const OVERSCAN = 15;
  const containerRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const rafRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [theadHeight, setTheadHeight] = useState(0);

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
  });

  // 测量表头实际高度
  useEffect(() => {
    if (theadRef.current) {
      const h = theadRef.current.offsetHeight;
      if (h > 0 && h !== theadHeight) setTheadHeight(h);
    }
  });

  useEffect(() => {
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
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    cancelAnimationFrame(rafRef.current);
    const st = e.currentTarget.scrollTop;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(st);
    });
  }, []);

  const th = theadHeight || 0;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + containerHeight - th) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = rows.slice(startIdx, endIdx);
  const topPadding = startIdx * ROW_HEIGHT;
  const bottomPadding = (rows.length - endIdx) * ROW_HEIGHT;

  if (rows.length === 0) {
    return (
      <div className="inventory-table-scroll" style={{
        padding: 16, textAlign: "center", color: "var(--text-secondary)",
        display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1.6,
      }}>
        {emptyText || "暂无数据"}
      </div>
    );
  }

  return (
    <div className="inventory-table-scroll" ref={containerRef} onScroll={handleScroll}
      onMouseDown={sel.handleMouseDown} onMouseMove={sel.handleMouseMove} onMouseUp={sel.endDrag} onMouseLeave={sel.endDrag}>
      {listHeader}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead ref={theadRef} style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg-surface)" }}>
          <tr style={{ height: ROW_HEIGHT }}>
            {allColumns.map(col => (
              <th key={col.header} style={{ border: "1px solid var(--border)", padding: "4px 6px", textAlign: "left", whiteSpace: "nowrap", background: "var(--bg-surface)", ...col.style }}>
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
          {topPadding > 0 && <tr><td colSpan={allColumns.length} style={{ height: topPadding, border: "none", padding: 0 }} /></tr>}
          {visibleRows.map((r, i) => {
            const rowIdx = startIdx + i;
            return (
              <tr key={rowIdx} style={{ height: ROW_HEIGHT }} className={rowClassName?.(r)}>
                {allColumns.map((col, ci) => {
                  const cellSel = sel.isSelected(rowIdx, ci);
                  return (
                    <td key={col.header} data-r={rowIdx} data-c={ci} style={{
                      border: "1px solid var(--border)", padding: "3px 6px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      ...(cellSel ? { background: "var(--bg-badge, #252736)" } : {}),
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

/** 小表（全量渲染，无虚拟滚动/序号列内置于列定义）：适合结果摘要类小表格 */
export function DataTable<T>({ rows, columns, emptyText = "暂无数据", maxHeight = 300 }: {
  rows: T[];
  columns: TableColumn<T>[];
  emptyText?: string;
  maxHeight?: number;
}) {
  // 所有表格统一在最左侧加「序号」列（从 1 开始递增）
  const allColumns: TableColumn<T>[] = [
    { header: "序号", render: (_r, index) => index + 1, style: { width: 48, textAlign: "center", color: "var(--text-secondary)" } },
    ...columns,
  ];
  if (rows.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>
        {emptyText}
      </div>
    );
  }
  return (
    <div style={{ maxHeight, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {allColumns.map(col => (
              <th key={col.header} style={{
                border: "1px solid var(--border)", padding: "4px 6px", textAlign: "left",
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
              {allColumns.map(col => (
                <td key={col.header} style={{
                  border: "1px solid var(--border)", padding: "3px 6px",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...col.style,
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
