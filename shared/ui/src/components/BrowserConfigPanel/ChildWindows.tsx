import { getBrowserUIExtension } from "../../data/browser-extensions";
import type { BCPBrowser } from "./types";

// ════════════════════════════════════════════
//  子浏览器窗口列表（注册式浏览器：店铺窗口 / 环境窗口）
//  由业务侧通过 registerBrowserUIExtension 的 childWindows 字段提供展示文案
// ════════════════════════════════════════════

export function ChildWindows({ browser }: { browser: BCPBrowser }) {
  const children = browser.children?.filter(c => c.enabled) || [];
  const child = getBrowserUIExtension(browser.browser_type)?.childWindows;
  if (!child || children.length === 0) {
    return null;
  }
  return (
    <>
      <div className="profiles-section-title">
        {child.title} ({children.length})
      </div>
      <div className="profiles-grid">
        {children.map(childWin => (
          <div className="profile-card" key={childWin.user_data_dir}>
            <div className="pc-avatar">
              <div className="avatar-placeholder">{child.avatarChar}</div>
            </div>
            <div className="pc-body">
              <div className="pc-top">
                <div className="pc-name-row">
                  <span className="pc-name">{childWin.name}</span>
                  <span className="pc-badge">{child.badge}</span>
                </div>
              </div>
              <div className="pc-details">
                <div className="pc-detail">
                  <span className="pc-label">用户数据目录</span>
                  <code>{childWin.user_data_dir}</code>
                </div>
                {childWin.proxy_ip && (
                  <div className="pc-detail">
                    <span className="pc-label">代理 IP</span>
                    <code>{childWin.proxy_ip}</code>
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
