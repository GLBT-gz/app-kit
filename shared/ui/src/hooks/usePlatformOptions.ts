import { useMemo } from "react";
import type { BCPBrowser } from "../components/BrowserConfigPanel";
import type { BrowserOption } from "../components/PlatformConfigPanel";
import { compareBrowserDisplayName } from "../utils/display-sort";

/**
 * 从多选卡片 key 推导平台选择器选项。
 * displayName 优先级：user_name → email → name → pid
 *
 * 过滤：紫鸟主程序入口（id=Default）不是店铺环境，不作为平台绑定目标
 * （历史勾选残留 key 也不会进入选项）。
 * 排序：先按浏览器类型优先级（edge → chrome → 易得客 → 紫鸟），同类型内按
 * displayName 字典序（localeCompare zh-Hans-CN），不再随勾选顺序杂乱。
 */

/** 浏览器类型排序优先级（未列出的类型排在最后） */
const BT_ORDER: Record<string, number> = { edge: 0, chrome: 1, edecker: 2, ziniao: 3 };

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
        return { key, displayName: `${browserName} / ${displayName}`, bt };
      })
      .sort((a, b) => {
        const ra = BT_ORDER[a.bt] ?? 10;
        const rb = BT_ORDER[b.bt] ?? 10;
        if (ra !== rb) return ra - rb;
        return compareBrowserDisplayName(a.displayName, b.displayName);
      });
  }, [selectedCardKeys, browsers, cachedProfiles]);
}
