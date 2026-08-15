// 输入类控件（文本/数字/多行）：主题变量样式见 styles/controls.css
// 行为对齐 010 产品上架的 TextInput/NumberInput/TextArea
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={`ui-input${className ? ` ${className}` : ""}`} />;
}

export function NumberInput({
  value,
  onChange,
  className,
  ...rest
}: { value: number; onChange: (v: number) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return (
    <input
      {...rest}
      type="number"
      className={`ui-input${className ? ` ${className}` : ""}`}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
    />
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea {...rest} className={`ui-input ui-textarea${className ? ` ${className}` : ""}`} />;
}
