import { useMemo } from "react";
import type { BCPBrowser, BCPProfile } from "../components/BrowserConfigPanel";

/**
 * 从浏览器检测结果派生 profiles 详情（含 user_name / email）。
 *
 * 数据来源为 browserStore 的 browsers[].profiles（由 refreshBrowserData 一次检测生成，
 * 覆盖默认目录 + 用户配置的自定义目录）。
 *
 * 相比旧实现（每次挂载对所有浏览器独立 detectCustomProfiles）：
 * 消除与 detectBrowsers / CurrentBrowserCards 的重复目录扫描。
 *
 * @param browsers 浏览器列表（来自 useBrowserBaseData，已是最终检测结果）
 * @param configExePaths 保留参数以兼容调用方（不再使用）
 * @param configUserDataDirs 保留参数以兼容调用方（不再使用）
 */
export function useBrowserProfilesCache(
  browsers: BCPBrowser[],
  _configExePaths: Record<string, string>,
  _configUserDataDirs: Record<string, string[]>,
): Record<string, BCPProfile[]> {
  return useMemo(() => {
    const result: Record<string, BCPProfile[]> = {};
    for (const b of browsers) {
      const ps = (b.profiles || []).map(p => ({
        id: p.id,
        name: p.name,
        user_data_dir: p.user_data_dir,
        avatar_base64: p.avatar_base64 || null,
        email: p.email || null,
        user_name: p.user_name || undefined,
      }));
      if (ps.length > 0) result[b.browser_type] = ps;
    }
    return result;
  }, [browsers]);
}
