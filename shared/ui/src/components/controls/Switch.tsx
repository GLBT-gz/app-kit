// 开关（滑块开关）：替代各项目手写的 temu-toggle / inventory-wh-toggle span 模拟开关
// 主题变量样式见 styles/controls.css
//
// 交互说明：
// - 默认点击触发 onChange(v)（input change 事件）
// - 列表行内场景（拖拽排序/批量切换）可传 onMouseDown 在 label 层拦截鼠标按下，
//   并配合 readOnly 由项目自身的 mousedown/mousemove/mouseup 系统驱动状态
import type { InputHTMLAttributes, MouseEventHandler } from "react";

export function Switch({
  checked,
  onChange,
  onMouseDown,
  disabled,
  className,
  ...rest
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  onMouseDown?: MouseEventHandler<HTMLLabelElement>;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "onChange" | "onMouseDown"
>) {
  return (
    <label className={`ui-switch${className ? ` ${className}` : ""}`} onMouseDown={onMouseDown}>
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
