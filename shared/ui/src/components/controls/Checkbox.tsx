// 复选框 / 单选框：原生控件 + accent-color 主题色，label 包裹可点击
// 主题变量样式见 styles/controls.css
// onChange 为值回调风格（与 Switch/Select/NumberInput 一致）：onChange(v: boolean)
import type { InputHTMLAttributes, ReactNode } from "react";

export function Checkbox({
  checked,
  onChange,
  label,
  className,
  ...rest
}: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "onChange"
>) {
  return (
    <label className={`ui-check${className ? ` ${className}` : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />
      {label}
    </label>
  );
}

export function Radio({
  checked,
  onChange,
  label,
  className,
  ...rest
}: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "onChange"
>) {
  return (
    <label className={`ui-radio${className ? ` ${className}` : ""}`}>
      <input type="radio" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />
      {label}
    </label>
  );
}
