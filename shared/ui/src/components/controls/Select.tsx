// 原生下拉框：主题变量样式见 styles/controls.css
// 简单的场景用原生 select；需要 portal 自定义浮层的（对齐 002/003 CustomSelect）后续按需补
import type { ReactNode, SelectHTMLAttributes } from "react";

export function Select({
  value,
  onChange,
  className,
  children,
  ...rest
}: { value: string; onChange: (v: string) => void; children?: ReactNode } & Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange"
>) {
  return (
    <select
      {...rest}
      className={`ui-input ui-select${className ? ` ${className}` : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}
