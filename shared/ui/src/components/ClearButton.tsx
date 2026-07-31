import { type ReactNode } from "react";

interface ClearButtonProps {
  /** 点击回调 */
  onClick: () => void;
  /** 按钮标签（默认 "清空数据"） */
  label?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 左侧图标，设为 false 隐藏图标 */
  icon?: ReactNode | boolean;
  /** 按钮尺寸：sm / md（默认 md） */
  size?: "sm" | "md";
  /** 额外的 CSS class */
  className?: string;
  /** 提示文字 */
  title?: string;
}

/**
 * 统一清空按钮组件
 *
 * 用于表格视图中的"清空表格数据"操作，
 * 样式通过 CSS 变量适配明暗主题。
 */
export function ClearButton({
  onClick,
  label = "清空数据",
  disabled = false,
  icon = true,
  size = "md",
  className = "",
  title,
}: ClearButtonProps) {
  return (
    <button
      className={`appkit-clear-btn appkit-clear-btn--${size} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
    >
      {icon === true ? (
        <svg className="appkit-clear-btn-icon" width={size === "sm" ? 12 : 14} height={size === "sm" ? 12 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      ) : (
        icon
      )}
      {label}
    </button>
  );
}
