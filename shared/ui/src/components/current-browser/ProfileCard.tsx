// ============================================================
//  单个 Profile 卡片（memo：选中态变化只重渲染受影响的卡片）
//  从 CurrentBrowserCards.tsx 拆出（拆分模式对齐 BrowserConfigPanel/）
// ============================================================

import { memo } from "react";
import type { BCPProfile } from "../BrowserConfigPanel";
import type { LaunchStatus, ConnectionStatus } from "../../data/profileStatusStore";
import { getDirDisplayName } from "../../utils/profile-rules";
import { LAUNCH_LABELS, CONNECTION_LABELS } from "./labels";

export interface ProfileCardProps {
  profile: BCPProfile;
  browserType: string;
  isSelected: boolean;
  isDefault: boolean;
  isSibling: boolean;
  /** 多用户目录下的用户总数（用于提示文案） */
  siblingUserCount?: number;
  isLaunching: boolean;
  launchStatus?: LaunchStatus;
  connStatus?: ConnectionStatus;
  /** 卡片唯一 key（bt|user_data_dir|id），供拖拽批量勾选按点定位 */
  dataKey: string;
  onCardClick: (bt: string, profile: BCPProfile) => void;
  /** 右键回调：弹出上下文菜单（打开 / 调试打开） */
  onCardContextMenu?: (e: React.MouseEvent, bt: string, profile: BCPProfile) => void;
  /** 按下回调：多选模式下启动「按住拖拽批量勾选/取消」会话 */
  onCardMouseDown?: (e: React.MouseEvent, bt: string, profile: BCPProfile) => void;
}

export const ProfileCard = memo(function ProfileCard({
  profile,
  browserType,
  isSelected,
  isDefault,
  isSibling,
  siblingUserCount,
  isLaunching,
  launchStatus,
  connStatus,
  dataKey,
  onCardClick,
  onCardContextMenu,
  onCardMouseDown,
}: ProfileCardProps) {
  let cls = "current-card";
  if (isSelected) cls += " current-card--selected";
  if (isDefault) cls += " current-card--default";
  if (isSibling) cls += " current-card--sibling";

  return (
    <button
      className={cls}
      data-key={dataKey}
      onClick={() => onCardClick(browserType, profile)}
      onMouseDown={(e) => onCardMouseDown?.(e, browserType, profile)}
      onContextMenu={(e) => {
        onCardContextMenu?.(e, browserType, profile);
      }}
      // 默认路径卡片不禁用：需保持右键菜单可用（启动/全部终止）；点击选择由父组件拦截提示
      disabled={isLaunching}
      title={
        isDefault
          ? "浏览器默认用户路径 — 基于浏览器安全规范，不可用于自动化控制"
          : isSibling
            ? `该目录下共 ${siblingUserCount ?? 2} 个用户 — 同一 user-data-dir 同一时刻只能打开一个实例（单实例锁），建议每个用户使用独立目录`
            : "选择此浏览器配置"
      }
    >
      {/* 选中标记（先于警告图标渲染，以覆盖） */}
      {isSelected && (
        <span className="current-card-check" style={{ background: "var(--accent)", border: "none", zIndex: 2 }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </span>
      )}
      {/* 默认路径锁定标记 */}
      {isDefault && (
        <span className="current-card-lock">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </span>
      )}
      {/* 多用户目录警告标记 */}
      {isSibling && (
        <span className="current-card-warn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </span>
      )}
      {/* 浏览器状态标签（左上角：是否启动 + 是否可连） */}
      {launchStatus && (
        <span className={"current-card-launch current-card-launch--" + launchStatus}>
          {LAUNCH_LABELS[launchStatus]}
        </span>
      )}
      {connStatus && launchStatus === "launched" && (
        <span className={"current-card-conn current-card-conn--" + connStatus}>
          {CONNECTION_LABELS[connStatus]}
        </span>
      )}
      {/* 头像 */}
      <div className={"current-card-avatar" + (isDefault ? " current-card-avatar--dimmed" : "")}>
        {profile.avatar_base64 ? (
          <img src={profile.avatar_base64} alt={profile.name} className="current-card-avatar-img" draggable={false} />
        ) : (
          <div className="current-card-avatar-placeholder">
            {profile.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      {/* 名称 */}
      <div className="current-card-name">{profile.name}</div>
      {/* 邮箱 */}
      {profile.email && <div className="current-card-email">{profile.email}</div>}
      {/* 来源目录（父目录\目录名） */}
      <div className="current-card-dir">
        {getDirDisplayName(profile.user_data_dir)}
      </div>
      {/* 默认路径提示 */}
      {isDefault && (
        <div className="current-card-default-label">默认路径·不可用</div>
      )}
      {/* 多用户目录警告 */}
      {isSibling && (
        <div className="current-card-sibling-label">多用户目录·受限</div>
      )}
      {/* 单用户目录（完全规范） */}
      {!isDefault && !isSibling && (
        <div className="current-card-valid-label">单用户目录·可用</div>
      )}
      {/* 启动中遮罩 */}
      {isLaunching && <div className="current-card-launching">启动中...</div>}
    </button>
  );
});
