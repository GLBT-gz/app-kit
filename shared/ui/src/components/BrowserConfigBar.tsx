/**
 * BrowserConfigBar —— 浏览器配置栏，收敛 006/007 两项目 ui.tsx 中逐字相同的实现。
 * 样式沿用各项目本地类名 inventory-config-bar*，不收敛 CSS 保证视觉零变化
 * （006/007 的 actions 布局存在差异：006 用 margin 方案，007 用 gap+button 规格方案）。
 */
export function BrowserConfigBar({ displayName, actions }: { displayName: string; actions?: React.ReactNode }) {
  const ready = !!displayName;
  return (
    <div className={`inventory-config-bar ${ready ? "ready" : "warn"}`}>
      <span className="inventory-config-bar-icon">●</span>
      <div className="inventory-config-bar-text">
        <span className="inventory-config-bar-label">浏览器</span>
        <span className="inventory-config-bar-value">{displayName || "未配置"}</span>
      </div>
      {actions && <div className="inventory-config-bar-actions">{actions}</div>}
    </div>
  );
}
