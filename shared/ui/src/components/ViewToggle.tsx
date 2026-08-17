/**
 * ViewToggle —— 视图切换按钮组（log/table/rules 等）。
 * 统一视觉（独立圆角按钮组），样式收敛在共享层 styles/controls.css（.ui-view-toggle），
 * 各项目直接使用，不再各自维护本地类名/样式；滚轮切换逻辑各页不同，由父组件传入 onWheel。
 */
import { Button } from "./controls/Button";

export interface ViewToggleItem {
  id: string;
  label: string;
  /** 悬停提示（可选，如公司全名） */
  title?: string;
}

export interface ViewToggleProps {
  views: ViewToggleItem[];
  value: string;
  onChange: (id: string) => void;
  /** 滚轮切换（各页自定义逻辑，通常绑在父容器上） */
  onWheel?: (e: React.WheelEvent) => void;
  /** 禁用项 id（当前项禁用等） */
  disabledId?: string;
}

export function ViewToggle({ views, value, onChange, onWheel, disabledId }: ViewToggleProps) {
  return (
    <div className="ui-view-toggle" onWheel={onWheel}>
      {views.map(v => (
        <Button
          key={v.id}
          size="sm"
          className={value === v.id ? "active" : ""}
          disabled={v.id === disabledId}
          title={v.title}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </Button>
      ))}
    </div>
  );
}
