// 基础按钮：主题变量样式见 styles/controls.css
// variant/size 语义对齐 010 产品上架的 pl-btn 体系（default/primary/danger × sm/md）
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "default" | "primary" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

export function Button({ variant = "default", size = "md", className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`ui-btn ui-btn-${variant} ui-btn-${size}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}
