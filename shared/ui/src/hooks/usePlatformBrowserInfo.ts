// 平台-浏览器解析 hook —— 公共层
//
// 从 002/007/010 各项目 test-shared 重复实现收拢：
//   - resolvePlatformBrowser：解析 platformSelections[platformKey] = "bt|udDir|pid" 字符串
//   - usePlatformBrowserInfo：带 useMemo 的 hook 封装
// 返回 { exePath, bt, pid, udDir, displayName }，未配置/解析失败返回 null。

import { useMemo } from "react";
import type { BCPBrowser } from "../components/BrowserConfigPanel";

/** 平台 profile 缓存项（对应 detectCustomProfiles 返回结构） */
export interface CachedPlatformProfile {
  id: string;
  name: string;
  user_data_dir: string;
  user_name?: string;
}

export type ProfilesCache = Record<string, CachedPlatformProfile[]>;

/** 从平台选择字符串 "bt|udDir|pid" 中解析出浏览器信息 */
export function resolvePlatformBrowser(
  selection: string | null,
  browsers: BCPBrowser[],
  cachedProfiles: ProfilesCache,
  configExePaths: Record<string, string>,
): { exePath: string; bt: string; pid: string; udDir: string; displayName: string } | null {
  if (!selection) return null;
  const parts = selection.split("|");
  if (parts.length < 3) return null;
  const bt = parts[0];
  const udDir = parts[1];
  const pid = parts[2];
  const browserName = browsers.find(b => b.browser_type === bt)?.browser_name || bt;
  const profile = cachedProfiles[bt]?.find(p => p.user_data_dir === udDir && p.id === pid)
    || browsers.find(b => b.browser_type === bt)?.profiles?.find(p => p.user_data_dir === udDir && p.id === pid);
  const profileName = profile?.user_name || profile?.name || pid;
  const exePath = configExePaths[bt] || "";
  if (!exePath) return null;
  return { exePath, bt, pid, udDir, displayName: `${browserName} / ${profileName}` };
}

/** hook：从 platformSelections 中解析指定平台的浏览器信息 */
export function usePlatformBrowserInfo(
  platformSelections: Record<string, string | null>,
  platformKey: string,
  browsers: BCPBrowser[],
  cachedProfiles: ProfilesCache,
  configExePaths: Record<string, string>,
) {
  return useMemo(() => {
    const selection = platformSelections?.[platformKey] ?? null;
    return resolvePlatformBrowser(selection, browsers, cachedProfiles, configExePaths);
  }, [platformKey, platformSelections, browsers, cachedProfiles, configExePaths]);
}
