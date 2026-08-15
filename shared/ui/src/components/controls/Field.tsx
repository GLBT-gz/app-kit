// 字段行：label + hint + 控件（布局样式见 styles/controls.css）
import type { ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="ui-field">
      <div className="ui-field-label">
        {label}
        {hint && <span className="ui-field-hint">{hint}</span>}
      </div>
      <div className="ui-field-control">{children}</div>
    </div>
  );
}
