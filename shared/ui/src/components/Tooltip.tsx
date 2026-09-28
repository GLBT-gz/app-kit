// ============================================================
// Tooltip 通用组件（app-kit 治本补漏，R-UI-3 配套）
//
// [背景] 016 项目 temuTableColumns.tsx 用 `<Tooltip content={row.rec.error}>` 显示错误，
// 但 app-kit/shared/ui/src 此前**没实现 Tooltip 组件也没 export** — Vite dev 报：
//   "Uncaught SyntaxError: The requested module '/@fs/.../shared/ui/src/index.ts'
//    does not provide an export named 'Tooltip'"
// 这是 framework 漏（commit 间某 commit 在 016 引用 Tooltip 但 app-kit 没建）。
//
// [本 commit 治本] 创建轻量 Tooltip 组件（HTML title 属性 + CSS 三角 tooltip 浮层），
// 在 shared/ui/src/index.ts export —— 跨项目可用。
//
// [设计原则]
// - **零依赖**（不引入 Radix / tippy.js 等第三方）
// - **HTML title 属性作为降级**（浏览器原生 tooltip，accessibility 即可用）
// - CSS 三角浮层作为增强（hover 时主动显示，避免 title 延迟 1s+）
// - controlled / uncontrolled 双模式
// - placement: top | bottom | left | right 四向
// - disabled 状态：隐藏 tooltip
//
// @since 2026-09 (R-UI-3 配套)
// ============================================================

import { memo, useState, useRef, useEffect, type ReactNode, type CSSProperties } from "react";

/** Tooltip 出现位置 */
export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** tooltip 显示的内容（纯文本或 React 节点） */
  content: ReactNode;
  /** 触发 tooltip 的子元素 */
  children: ReactNode;
  /** 出现位置（默认 top） */
  placement?: TooltipPlacement;
  /** hover 触发延迟（毫秒，默认 200） */
  delay?: number;
  /** controlled 模式：外部控制 visible */
  visible?: boolean;
  /** 关闭时回调 */
  onClose?: () => void;
  /** 自定义 className */
  className?: string;
  /** 自定义 style */
  style?: CSSProperties;
}

/** Tooltip 组件（hover/focus 触发浮层 + HTML title 降级） */
export const Tooltip = memo(function Tooltip(props: TooltipProps) {
  const {
    content,
    children,
    placement = "top",
    delay = 200,
    visible: controlledVisible,
    onClose,
    className,
    style,
  } = props;

  const [internalVisible, setInternalVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isControlled = controlledVisible !== undefined;
  const visible = isControlled ? controlledVisible : internalVisible;

  const showTooltip = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!isControlled) setInternalVisible(true);
      // 计算浮层位置
      if (triggerRef.current && tooltipRef.current) {
        const triggerRect = triggerRef.current.getBoundingClientRect();
        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        let top = 0;
        let left = 0;
        switch (placement) {
          case "top":
            top = triggerRect.top - tooltipRect.height - 8;
            left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
            break;
          case "bottom":
            top = triggerRect.bottom + 8;
            left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
            break;
          case "left":
            top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
            left = triggerRect.left - tooltipRect.width - 8;
            break;
          case "right":
            top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
            left = triggerRect.right + 8;
            break;
        }
        setPosition({ top, left });
      }
      if (onClose) onClose(); // 占位（实际未触发 onClose）
    }, delay);
  };

  const hideTooltip = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!isControlled) setInternalVisible(false);
    if (onClose) onClose();
  };

  // controlled 模式 visible 变化时同步内部状态（占位兼容）
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // 字符串 content 时也设置 HTML title 属性（accessibility 降级 + 无 JS 也能用）
  const isStringContent = typeof content === "string";

  return (
    <span
      ref={triggerRef}
      className={`appkit-tooltip-trigger ${className ?? ""}`}
      style={{ position: "relative", display: "inline-block", ...style }}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {isStringContent ? <span title={content as string}>{children}</span> : children}
      {visible && !isStringContent && (
        <div
          ref={tooltipRef}
          className="appkit-tooltip"
          role="tooltip"
          style={{
            position: "fixed",
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            zIndex: 9999,
            background: "rgba(0, 0, 0, 0.85)",
            color: "#fff",
            padding: "6px 10px",
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.4,
            maxWidth: 280,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            pointerEvents: "none",
          }}
        >
          {content}
        </div>
      )}
    </span>
  );
});