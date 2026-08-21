import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { LogPanel, type UseLogReturn } from "./LogPanel";

// ═══════════════════════════════════════════════════════════
// 测试页布局 —— 收敛各项目（002/003/006/007/010 等）重复实现：
//   - TestSection      测试模块卡片（标题 + 内容）
//   - TestPageLayout   分栏布局（左侧模块 / 拖拽手柄 / 右侧日志栏）
// 右侧日志栏宽度使用「比例」（0-100，百分比）而非固定 px：
// 窗口全屏/缩小时日志栏保持相同视觉占比，不会在小窗口下占满屏幕。
// 拖拽时按容器宽度换算为百分比，持久化交给外部（各项目 storage key）。
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

/** 日志栏宽度比例上限（%） */
const LOG_WIDTH_MAX_PCT = 90;

/** 日志栏宽度比例下限（%） */
const LOG_WIDTH_MIN_PCT = 5;

/** 测试页布局 props */
export interface TestPageLayoutProps {
  /** 左侧测试模块内容（如 .test-modules / 标签栏） */
  children: ReactNode;
  /** useLog 返回的日志状态（多 tab 场景传当前激活 tab 的 log） */
  log: UseLogReturn;
  /** 日志栏宽度占比（0-100，%；旧版存固定 px 的调用方需自行迁移，本组件只做防御 clamp） */
  logWidth: number;
  /** 拖拽后的宽度占比回调（0-100，%） */
  onLogWidthChange: (w: number) => void;
  /** 日志面板标题（默认 "运行日志"） */
  logTitle?: string;
  /** 空状态提示 */
  emptyText?: string;
  /** 自定义清空回调（默认 log.clear；多 tab 场景需同时重置模块 key 时传入） */
  onClear?: () => void;
  /** 额外 CSS class（追加到 .test-panel） */
  className?: string;
}

/**
 * 测试页分栏布局：左侧测试模块 / 拖拽手柄 / 右侧可拖拽日志栏。
 * 日志栏宽度为百分比（0-100），窗口缩放时自动按比例伸缩。
 */
export function TestPageLayout({
  children,
  log,
  logWidth,
  onLogWidthChange,
  logTitle = "运行日志",
  emptyText = "选择模块后点击「运行」查看输出",
  onClear,
  className,
}: TestPageLayoutProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerWRef = useRef(0);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  // 防御：旧版固定 px（如 340/360）会大于 100，clamp 到合理占比，避免布局爆炸
  const safePct = Math.min(LOG_WIDTH_MAX_PCT, Math.max(LOG_WIDTH_MIN_PCT, logWidth));

  // 测量面板总宽（拖拽换算与窗口缩放适配都用它）
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const update = () => {
      containerWRef.current = el.clientWidth;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = safePct;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [safePct],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = containerWRef.current;
      if (w <= 0) return;
      const newPct = startW.current - ((e.clientX - startX.current) / w) * 100;
      onLogWidthChange(Math.min(LOG_WIDTH_MAX_PCT, Math.max(LOG_WIDTH_MIN_PCT, newPct)));
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
  }, [onLogWidthChange]);

  return (
    <div className={`test-panel${className ? ` ${className}` : ""}`} ref={panelRef}>
      <div className="test-panel-left">{children}</div>
      <div className="test-splitter" onMouseDown={handleMouseDown} />
      <div className="test-log-sidebar" style={{ width: `${safePct}%` }}>
        <LogPanel log={{ ...log, clear: onClear ?? log.clear }} title={logTitle} emptyText={emptyText} />
      </div>
    </div>
  );
}
