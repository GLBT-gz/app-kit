import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { LogPanel, type UseLogReturn } from "./LogPanel";

// ═══════════════════════════════════════════════════════════
// 测试页布局 —— 收敛各项目（002/003/006/007/010 等）重复实现：
//   - TestSection      测试模块卡片（标题 + 内容）
//   - TestPageLayout   分栏布局（左侧模块 / 拖拽手柄 / 右侧日志栏）
// 拖拽宽度持久化由外部负责（项目各自 useData key），组件只负责交互。
// ═══════════════════════════════════════════════════════════

/** 测试模块卡片 */
export interface TestSectionProps {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

export function TestSection({ title, children, className }: TestSectionProps) {
  return (
    <div className={`test-section${className ? ` ${className}` : ""}`}>
      <div className="test-section-header">{title}</div>
      {children}
    </div>
  );
}

/** 测试页布局 props */
export interface TestPageLayoutProps {
  /** 左侧测试模块内容（如 .test-modules / 标签栏） */
  children: ReactNode;
  /** useLog 返回的日志状态（多 tab 场景传当前激活 tab 的 log） */
  log: UseLogReturn;
  /** 日志栏宽度（px，外部 useData 持久化） */
  logWidth: number;
  /** 拖拽后的宽度回调（外部 setLogWidth） */
  onLogWidthChange: (w: number) => void;
  /** 日志面板标题（默认 "运行日志"） */
  logTitle?: string;
  /** 空状态提示 */
  emptyText?: string;
  /** 自定义清空回调（默认 log.clear；多 tab 场景需同时重置模块 key 时传入） */
  onClear?: () => void;
  /** 日志栏最小宽度（默认 0） */
  minWidth?: number;
  /** 额外 CSS class（追加到 .test-panel） */
  className?: string;
}

/**
 * 测试页分栏布局：左侧测试模块 / 拖拽手柄 / 右侧可拖拽日志栏。
 * 拖拽逻辑与 007/010 历史实现保持一致（mousemove 期间更新宽度，mouseup 结束）。
 */
export function TestPageLayout({
  children,
  log,
  logWidth,
  onLogWidthChange,
  logTitle = "运行日志",
  emptyText = "选择模块后点击「运行」查看输出",
  onClear,
  minWidth = 0,
  className,
}: TestPageLayoutProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = logWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [logWidth],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newW = startW.current - (e.clientX - startX.current);
      onLogWidthChange(Math.max(newW, minWidth));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [onLogWidthChange, minWidth]);

  return (
    <div className={`test-panel${className ? ` ${className}` : ""}`}>
      <div className="test-panel-left">{children}</div>
      <div className="test-splitter" onMouseDown={handleMouseDown} />
      <div className="test-log-sidebar" style={{ width: logWidth }}>
        <LogPanel log={{ ...log, clear: onClear ?? log.clear }} title={logTitle} emptyText={emptyText} />
      </div>
    </div>
  );
}
