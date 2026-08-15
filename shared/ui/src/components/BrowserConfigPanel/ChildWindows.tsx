import type { BCPBrowser } from "./types";

// ════════════════════════════════════════════
//  子浏览器窗口列表（易得客店铺窗口 / 紫鸟环境窗口）
// ════════════════════════════════════════════

export function ChildWindows({ browser }: { browser: BCPBrowser }) {
  const children = browser.children?.filter(c => c.enabled) || [];
  if (!['edecker', 'ziniao'].includes(browser.browser_type) || children.length === 0) {
    return null;
  }
  const isEdecker = browser.browser_type === 'edecker';
  return (
    <>
      <div className="profiles-section-title">
        {isEdecker ? '店铺窗口' : '环境窗口'} ({children.length})
      </div>
      <div className="profiles-grid">
        {children.map(child => (
          <div className="profile-card" key={child.user_data_dir}>
            <div className="pc-avatar">
              <div className="avatar-placeholder">{isEdecker ? '店' : '环'}</div>
            </div>
            <div className="pc-body">
              <div className="pc-top">
                <div className="pc-name-row">
                  <span className="pc-name">{child.name}</span>
                  <span className="pc-badge">{isEdecker ? '店铺' : '环境'}</span>
                </div>
              </div>
              <div className="pc-details">
                <div className="pc-detail">
                  <span className="pc-label">用户数据目录</span>
                  <code>{child.user_data_dir}</code>
                </div>
                {child.proxy_ip && (
                  <div className="pc-detail">
                    <span className="pc-label">代理 IP</span>
                    <code>{child.proxy_ip}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
