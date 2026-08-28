import { useMemo } from "react";
import type { BCPBrowser } from "../components/BrowserConfigPanel";
import type { BrowserOption } from "../components/PlatformConfigPanel";

/**
 * 从多选卡片 key 推导平台选择器选项。
 * displayName 优先级：user_name → email → name → pid
 *
 * 过滤：紫鸟主程序入口（id=Default）不是店铺环境，不作为平台绑定目标
 * （历史勾选残留 key 也不会进入选项）。
 */
export function usePlatformOptions(
  selectedCardKeys: string[],
  browsers: BCPBrowser[],
  cachedProfiles: Record<string, { id: string; name: string; user_data_dir: string; user_name?: string; email?: string | null }[]>,
): BrowserOption[] {
  return useMemo(() => {
    return selectedCardKeys
      .filter(key => {
        const parts = key.split("|");
        return !(parts[0] === "ziniao" && parts[2] === "Default");
      })
      .map(key => {
        const parts = key.split("|");
        const bt = parts[0];
        const udDir = parts[1];
        const pid = parts[2];
        const browserName = browsers.find(b => b.browser_type === bt)?.browser_name || bt;
        // 优先 async 返回的最新数据，否则用 browsers 缓存中的 profiles
        const profile = cachedProfiles[bt]?.find(p => p.user_data_dir === udDir && p.id === pid)
          || browsers.find(b => b.browser_type === bt)?.profiles?.find(p => p.user_data_dir === udDir && p.id === pid);
        const displayName = profile?.user_name || profile?.email || profile?.name || pid;
        return { key, displayName: `${browserName} / ${displayName}` };
      });
  }, [selectedCardKeys, browsers, cachedProfiles]);
}
