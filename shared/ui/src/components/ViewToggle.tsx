/**
 * ViewToggle —— 视图切换按钮组（log/table/rules 等），收敛 002/003/006/007/008 各页面重复的
 * temu-view-toggle / inventory-view-toggle 按钮组与滚轮切换。
 * 样式沿用各项目本地类名（temu-view-toggle+temu-log-tab-btn / inventory-view-toggle），
 * 不收敛 CSS 保证视觉零变化；滚轮切换逻辑各页不同，由父组件传入 onWheel。
 */
export interface ViewToggleItem {
  id: string;
  label: string;
}

export interface ViewToggleProps {
  views: ViewToggleItem[];
  value: string;
  onChange: (id: string) => void;
  /** 容器类名，默认 "temu-view-toggle"（002/003 系）；006/007 传 "inventory-view-toggle" */
  className?: string;
  /** 按钮类名，默认 "temu-log-tab-btn"（002/003 系）；006/007 传 "" 走容器 button 选择器 */
  itemClassName?: string;
  /** 滚轮切换（各页自定义逻辑） */
  onWheel?: (e: React.WheelEvent) => void;
  /** 禁用项 id（003 feishu 当前项禁用） */
  disabledId?: string;
}

export function ViewToggle({
  views, value, onChange, className = "temu-view-toggle", itemClassName = "temu-log-tab-btn", onWheel, disabledId,
}: ViewToggleProps) {
  return (
    <div className={className} onWheel={onWheel}>
      {views.map(v => (
        <button
          key={v.id}
          type="button"
          className={`${itemClassName}${value === v.id ? " active" : ""}`}
          disabled={v.id === disabledId}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
