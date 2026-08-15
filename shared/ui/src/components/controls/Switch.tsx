// 开关（滑块开关）：替代各项目手写的 temu-toggle / inventory-wh-toggle span 模拟开关
// 主题变量样式见 styles/controls.css
import type { InputHTMLAttributes } from "react";

export function Switch({
  checked,
  onChange,
  disabled,
  className,
  ...rest
}: { checked: boolean; onChange: (v: boolean) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "onChange"
>) {
  return (
    <label className={`ui-switch${className ? ` ${className}` : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span className="ui-switch-track">
        <span className="ui-switch-thumb" />
      </span>
    </label>
  );
}
