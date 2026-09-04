import { useCallback, useEffect, useRef, useState } from "react";
import { useTableSelectionCopy } from "./table";

/**
 * @deprecated 请改用 {@link VirtualTable}（`./table`）。
 *
 * SheetTable —— 二维字符串数组表格（headers: string[] + rows: string[][]），
 * 收敛各项目页面的内联表格实现。
 * 内置：单元格框选 + Ctrl+C 复制（容器级事件委托，td 带 data-r/data-c）、
 * 可选虚拟滚动（spacer 切片式，大表）、可选序号列、可选 Delete 删行、sticky 表头。
 * 样式类名通过 scrollClassName/tableClassName/emptyClassName/copyTipClassName 传入
 * （框架默认中性类名，业务侧可传自己的项目本地类名，保证视觉零变化）。
 *
 * 保留原因：002/003 历史页面仍依赖此 API（`@glbt/ui` 的 `SHEET_TABLE_LEGACY_CLASSES`
 * 仍为兼容而导出）。**新页面不要再使用本组件**，请统一改用 `VirtualTable`——
 * 它提供了更强的能力：内置 sticky 表头（不依赖项目 CSS）、冻结列（stickyLeft）、
 * fixedLayout、内容自适应列宽等。框架不在 SheetTable 上继续投入新功能。
 */
/** @deprecated 请改用 `VirtualTableProps`(`./table`)。保留至 002/003 完成迁移。 */
export interface SheetTableProps {
  headers: string[];
  rows: string[][];
  /** 虚拟滚动（固定行高，只渲染可视行）——002 billing/weee/measure 大表 */
  virtual?: boolean;
  /** 首列显示「#」序号列（003 shein1/shein23） */
  showRowNum?: boolean;
  emptyText?: string;
  rowClassName?: (row: string[], index: number) => string | undefined;
  cellClassName?: (value: string, r: number, c: number, row: string[]) => string | undefined;
  /** 覆盖单元格渲染（tooltip span / 着色 JSX） */
  cellContent?: (value: string, r: number, c: number, row: string[]) => React.ReactNode;
  /** 框选后按 Delete/Backspace 删除选中行区间 */
  onDeleteSelection?: (r1: number, r2: number) => void;
  /** 附加到 scroll 容器（如 `rules-content`、显隐控制类） */
  className?: string;
  /** scroll 容器基础类名（业务侧可传项目本地类名；默认框架中性类名） */
  scrollClassName?: string;
  /** table 元素类名（业务侧可传项目本地类名；默认框架中性类名） */
  tableClassName?: string;
  /** 空状态容器类名（业务侧可传项目本地类名；默认框架中性类名） */
  emptyClassName?: string;
  /** 复制提示浮层的类名（各项目样式类不同） */
  copyTipClassName?: string;
}

/** @deprecated 请改用 `VirtualTable<T>({ rows, columns })`(`./table`)。 */
export function SheetTable({
  headers, rows, virtual = false, showRowNum = false, emptyText = "暂无数据",
  rowClassName, cellClassName, cellContent, onDeleteSelection, className,
  scrollClassName = "sheet-table-scroll", tableClassName = "sheet-table", emptyClassName = "sheet-table-empty",
  copyTipClassName = "sheet-table-copy-tip",
}: SheetTableProps) {
  const ROW_HEIGHT = 30;
  const OVERSCAN = 10;
  const containerRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const rafRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [theadHeight, setTheadHeight] = useState(0);

  // 列数（含可选序号列）
  const colCount = headers.length + (showRowNum ? 1 : 0);
  // 框选复制的行列映射（r 为数据行号，c 为数据列号）
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const sel = useTableSelectionCopy((r, c) => {
    const row = rowsRef.current[r];
    if (!row) return "";
    const realC = showRowNum ? c - 1 : c;
    if (realC < 0) return String(r + 1);
    return row[realC] ?? "";
  }, onDeleteSelection);

  // 虚拟滚动容器高度测量（仅 virtual 模式）
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

  // 测量表头实际高度（虚拟滚动计算可视行数用）
  useEffect(() => {
    if (!virtual) return;
    if (theadRef.current) {
      const h = theadRef.current.offsetHeight;
      if (h > 0 && h !== theadHeight) setTheadHeight(h);
    }
  });

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!virtual) return;
    cancelAnimationFrame(rafRef.current);
    const st = e.currentTarget.scrollTop;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(st);
    });
  }, [virtual]);

  const th = theadHeight || 0;
  const startIdx = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const endIdx = virtual
    ? Math.min(rows.length, Math.ceil((scrollTop + containerHeight - th) / ROW_HEIGHT) + OVERSCAN)
    : rows.length;
  const visibleRows = virtual ? rows.slice(startIdx, endIdx) : rows;
  const topPadding = virtual ? startIdx * ROW_HEIGHT : 0;
  const bottomPadding = virtual ? (rows.length - endIdx) * ROW_HEIGHT : 0;

  const renderCells = (row: string[], r: number) => {
    const cells: React.ReactNode[] = [];
    if (showRowNum) {
      const selC = 0;
      cells.push(
        <td key="#num" data-r={r} data-c={selC} className={sel.isSelected(r, selC) ? "selected" : undefined}
          style={virtual ? { height: ROW_HEIGHT } : undefined}>
          {String(r + 1)}
        </td>,
      );
    }
    row.forEach((v, c) => {
      const realC = c;
      const selC = showRowNum ? c + 1 : c;
      cells.push(
        <td key={c} data-r={r} data-c={selC}
          className={[
            sel.isSelected(r, selC) ? "selected" : "",
            cellClassName?.(v, r, realC, row) ?? "",
          ].filter(Boolean).join(" ") || undefined}
          style={virtual ? { height: ROW_HEIGHT } : undefined}>
          {cellContent ? cellContent(v, r, realC, row) : v}
        </td>,
      );
    });
    return cells;
  };

  if (rows.length === 0) {
    return (
      <div className={`${emptyClassName} ${className ?? ""}`}>
        {emptyText}
      </div>
    );
  }

  return (
    <div className={`${scrollClassName} ${className ?? ""}`} ref={containerRef} onScroll={handleScroll}
      onMouseDown={sel.handleMouseDown} onMouseMove={sel.handleMouseMove} onMouseUp={sel.endDrag} onMouseLeave={sel.endDrag}>
      <table className={tableClassName}>
        <thead ref={theadRef}>
          <tr>
            {showRowNum && <th style={virtual ? { height: ROW_HEIGHT } : undefined}>#</th>}
            {headers.map(h => (
              <th key={h} style={virtual ? { height: ROW_HEIGHT } : undefined}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topPadding > 0 && <tr><td colSpan={colCount} style={{ height: topPadding, border: "none", padding: 0 }} /></tr>}
          {visibleRows.map((row, i) => {
            const r = startIdx + i;
            return (
              <tr key={r} className={rowClassName?.(row, r)} style={virtual ? { height: ROW_HEIGHT } : undefined}>
                {renderCells(row, r)}
              </tr>
            );
          })}
          {bottomPadding > 0 && <tr><td colSpan={colCount} style={{ height: bottomPadding, border: "none", padding: 0 }} /></tr>}
        </tbody>
      </table>
      {sel.copyTip && <div className={copyTipClassName}>{sel.copyTip}</div>}
    </div>
  );
}
