import { type JSX, type ReactNode } from "react";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** 气泡内显示内容 —— 接受 string（长文本可换行）或任意 ReactNode */
  content: ReactNode;
  /** 触发元素 —— hover/focus 时显示气泡 */
  children: ReactNode;
  /** 气泡位置；默认 "top"（在触发元素上方居中） */
  placement?: TooltipPlacement;
  /** 附加 className，用于覆盖内边距/宽度等 */
  className?: string;
  /** 禁用整条气泡（直接渲染 children，不包 span） */
  disabled?: boolean;
}

/**
 * Tooltip —— 通用 hover 气泡（[2026-09-28] 新增）。
 *
 * 零业务概念，无任何领域术语；适用于表格列、按钮、任意文本的二次注解。
 * - `content` 接受 string（长字符串自动换行）或任意 ReactNode（HTML/Markdown 等）
 * - `placement` 4 方向（top/bottom/left/right），默认 top
 * - 鼠标 hover 或键盘 focus 触发元素即显示；移开 150ms 淡出
 * - `disabled=true` 时直接透传 children，不包裹（适合条件渲染）
 *
 * 用法：
 * ```tsx
 * <Tooltip content="完整错误：XHR 403 没权限访问">
 *   <span className="error-mark">!</span>
 * </Tooltip>
 * ```
 */
export function Tooltip({
  content,
  children,
  placement = "top",
  className,
  disabled = false,
}: TooltipProps): JSX.Element {
  if (disabled) return <>{children}</>;
  const cls = `appkit-tooltip ${className ?? ""}`.trim();
  return (
    <span className={cls}>
      <span className="appkit-tooltip-trigger">{children}</span>
      <span className={`appkit-tooltip-pop appkit-tooltip-pop-${placement}`} role="tooltip">
        {content}
      </span>
    </span>
  );
}
