// 复选框 / 单选框：原生控件 + accent-color 主题色，label 包裹可点击
// 主题变量样式见 styles/controls.css
import type { InputHTMLAttributes, ReactNode } from "react";

export function Checkbox({
  label,
  className,
  ...rest
}: { label?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className={`ui-check${className ? ` ${className}` : ""}`}>
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}

export function Radio({
  label,
  className,
  ...rest
}: { label?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className={`ui-radio${className ? ` ${className}` : ""}`}>
      <input type="radio" {...rest} />
      {label}
    </label>
  );
}
