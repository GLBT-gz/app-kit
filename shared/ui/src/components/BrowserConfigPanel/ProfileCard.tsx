import { Button } from "../controls/Button";
import type { BCPProfile } from "./types";

// ════════════════════════════════════════════
//  用户配置（Profile）卡片 + 操作区
// ════════════════════════════════════════════

export interface ProfileCardProps {
  profile: BCPProfile;
  /** 是否为浏览器默认用户数据目录 */
  isDefault: boolean;
  /** 目录显示名（多目录同名时含父目录） */
  dirTag?: string;
  /** 多目录时显示目录 tag */
  showDirTag: boolean;
  canLaunch: boolean;
  canCommand: boolean;
  canShortcut: boolean;
  /** 该 profile 正在启动：禁用启动/调试按钮防连点 */
  isLaunching?: boolean;
  onLaunch: (p: BCPProfile, portStr: string) => void;
  onDebugLaunch: (p: BCPProfile) => void;
  onShowCommand: (p: BCPProfile, portStr: string) => void;
  onShortcut: (p: BCPProfile) => void;
}

export function ProfileCard({
  profile: p, isDefault, dirTag, showDirTag,
  canLaunch, canCommand, canShortcut, isLaunching,
  onLaunch, onDebugLaunch, onShowCommand, onShortcut,
}: ProfileCardProps) {
  return (
    <div className="profile-card" key={`${p.user_data_dir}|${p.id}`}>
      <div className="pc-avatar">
        {p.avatar_base64 ? (
          <img src={p.avatar_base64} alt={p.name} className="avatar-img" />
        ) : (
          <div className="avatar-placeholder">{p.name.charAt(0).toUpperCase()}</div>
        )}
      </div>
      <div className="pc-body">
        <div className="pc-top">
          <div className="pc-name-row">
            <span className="pc-name">{p.name}</span>
            {isDefault && <span className="pc-badge">默认</span>}
            {showDirTag && <span className="pc-dir-tag">{dirTag || p.user_data_dir.replace(/^.*[\\\/]/, '')}</span>}
          </div>
          {p.email && (
            <div className="pc-user">
              {p.user_name && <span>{p.user_name}</span>}
              {p.user_name && p.email && <span className="pc-dot">·</span>}
              <span>{p.email}</span>
            </div>
          )}
        </div>
        <div className="pc-details">
          <div className="pc-detail"><span className="pc-label">Profile ID</span><code>{p.id}</code></div>
          <div className="pc-detail"><span className="pc-label">用户数据目录</span><code>{p.user_data_dir}</code></div>
          {p.path && p.path !== p.user_data_dir && (
            <div className="pc-detail"><span className="pc-label">Profile 路径</span><code>{p.path}</code></div>
          )}
          {p.download_dir && (
            <div className="pc-detail"><span className="pc-label">下载目录</span><code>{p.download_dir}</code></div>
          )}
        </div>
        {(canLaunch || canCommand || canShortcut) && (
          <div className="pc-actions">
            <div className="pc-btn-row">
              {canLaunch && (
                <Button variant="primary" size="sm" disabled={isLaunching} onClick={() => onLaunch(p, "")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>{isLaunching ? "启动中..." : "启动"}
                </Button>
              )}
              {canLaunch && (
                <Button size="sm" className="ui-btn-debug" disabled={isLaunching} onClick={() => onDebugLaunch(p)} title="随机可用端口调试启动">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>{isLaunching ? "启动中..." : "调试启动"}
                </Button>
              )}
              {canCommand && (
                <Button size="sm" onClick={() => onShowCommand(p, "")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M8 3H3v5M3 16v5h5M16 21h5v-5" /><path d="M21 3l-7 7M3 21l7-7" /></svg>命令
                </Button>
              )}
              {canShortcut && (
                <Button size="sm" onClick={() => onShortcut(p)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>快捷方式
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
