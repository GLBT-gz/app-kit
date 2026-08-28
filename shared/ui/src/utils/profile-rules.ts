// ============================================================
//  Profile 规则纯函数（从 CurrentBrowserCards 抽出，便于单测与复用）
//
//  三档受限规则（源自踩坑记录 2026-08-19 的实测结论）：
//    0 = 浏览器默认用户路径（完全受限，不可用于自动化）
//    1 = 多用户目录（部分受限：同 user-data-dir 单实例锁）
//    2 = 单用户目录（完全规范，可用）
// ============================================================

import type { BCPBrowser, BCPProfile } from "../components/BrowserConfigPanel";

/** 卡片复合 key：browserType|user_data_dir|profileId */
export function mkKey(bt: string, p: Pick<BCPProfile, "user_data_dir" | "id">): string {
  return `${bt}|${p.user_data_dir}|${p.id}`;
}

/** 该 profile 所在目录是否为浏览器的默认用户路径（不可用于自动化） */
export function isDefaultUserDir(b: BCPBrowser, p: BCPProfile): boolean {
  // 易得客/紫鸟的默认路径就是可用的主程序配置（店铺/环境窗口以 children 展示）
  if (b.browser_type === "edecker" || b.browser_type === "ziniao") return false;
  return !!b.default_user_data_dir && p.user_data_dir === b.default_user_data_dir;
}

/**
 * 紫鸟主程序入口（id=Default，user_data_dir 为 userdata 根目录）。
 * 它不是店铺环境，不能作为自动化控制目标：在「当前浏览器配置」中排第一位、
 * 锁定不可勾选，右键「打开」直接打开紫鸟主程序。
 */
export function isZiniaoMain(b: BCPBrowser, p: BCPProfile): boolean {
  return b.browser_type === "ziniao" && p.id === "Default";
}

/** 该 profile 所在目录是否为多用户目录（同 user-data-dir 含多个用户 → 浏览器单实例锁，
 *  同一时刻只能打开一个实例 → 部分受限）。counts 为各 user_data_dir 下的用户数。 */
export function isMultiUserDir(b: BCPBrowser, p: BCPProfile, counts?: Record<string, number>): boolean {
  if (isDefaultUserDir(b, p)) return false;
  if (b.browser_type === "edecker" || b.browser_type === "ziniao") return false;
  return (counts?.[p.user_data_dir] ?? 0) > 1;
}

/** 统计各 user_data_dir 下的用户数（isMultiUserDir 的 counts 入参） */
export function countProfilesPerDir(profiles: BCPProfile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of profiles) {
    counts[p.user_data_dir] = (counts[p.user_data_dir] || 0) + 1;
  }
  return counts;
}

/** 排序分组：0=默认路径（完全受限，最前）、1=多用户目录（部分受限，其次）、2=单用户目录（完全规范）。
 *  紫鸟主程序入口与默认路径同级（排最前）。 */
export function getSortGroup(b: BCPBrowser, p: BCPProfile, counts?: Record<string, number>): number {
  if (isZiniaoMain(b, p)) return 0;
  if (isDefaultUserDir(b, p)) return 0;
  if (isMultiUserDir(b, p, counts)) return 1;
  return 2;
}

/** 获取目录的显示名称：父目录\\目录名 */
export function getDirDisplayName(path: string): string {
  const normalized = path.replace(/[\\\/]$/, '');
  const parts = normalized.split(/[\\\/]/);
  if (parts.length >= 2) {
    return parts[parts.length - 2] + '\\' + parts[parts.length - 1];
  }
  return normalized;
}
