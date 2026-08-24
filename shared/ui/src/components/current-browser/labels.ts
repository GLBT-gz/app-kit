// ============================================================
//  浏览器状态标签文案（LaunchStatus / ConnectionStatus 的展示名）
// ============================================================

import type { LaunchStatus, ConnectionStatus } from "../../data/profileStatusStore";

export const LAUNCH_LABELS: Record<LaunchStatus, string> = {
  not_launched: "未启动",
  launched: "已启动",
};

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  not_connectable: "不可连",
  connectable: "可连",
};
