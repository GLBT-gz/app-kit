import { useMemo } from "react";
import type { BCPBrowser } from "../components/BrowserConfigPanel";
import type { BrowserOption } from "../components/PlatformConfigPanel";
import { getBrowserUIExtension } from "../data/browser-extensions";
import { compareBrowserDisplayName } from "../utils/display-sort";

/**
 * 从多选卡片 key 推导平台选择器选项。
 * displayName 优先级：user_name → email → name → pid
 *
 * 过滤：主程序入口 profile（由业务侧 isMainEntry 判定，如 id=Default）不是店铺环境，
 * 不作为平台绑定目标（历史勾选残留 key 也不会进入选项）。
 * 排序：内置 edge → chrome 固定前置，注册类型按业务侧注册的 sortOrder，同类型内按
 * displayName 字典序（localeCompare zh-Hans-CN），不再随勾选顺序杂乱。
 */

/** 浏览器类型排序权重（内置 edge/chrome 固定，注册类型由业务侧注册，未注册排最后） */
function browserSortOrder(bt: string): number {
  if (bt === "edge") return 0;
  if (bt === "chrome") return 1;
  return getBrowserUIExtension(bt)?.sortOrder ?? 10;
}

export function usePlatformOptions(
  selectedCardKeys: string[],
  browsers: BCPBrowser[],
  cachedProfiles: Record<string, { id: string; name: string; user_data_dir: string; user_name?: string; email?: string | null }[]>,
): BrowserOption[] {
  return useMemo(() => {
    return selectedCardKeys
      .filter(key => {
        const parts = key.split("|");
        const bt = parts[0];
        const udDir = parts[1];
        const pid = parts[2];
        // 主程序入口 profile（如 id=Default）由业务侧 isMainEntry 判定，不作为平台绑定目标
        if (getBrowserUIExtension(bt)?.isMainEntry?.(pid) === true) return false;
        // 过滤残留 key：profile 已被删除/重命名（browserStore 中不存在）时，
        // CurrentBrowserCards 不显示勾选，下拉框也应同步隐藏，避免幽灵选项。
        return browsers.some(b =>
          b.browser_type === bt &&
          (b.profiles || []).some(p => p.user_data_dir === udDir && p.id === pid)
        );
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
        const ra = browserSortOrder(a.bt);
        const rb = browserSortOrder(b.bt);
        if (ra !== rb) return ra - rb;
        return compareBrowserDisplayName(a.displayName, b.displayName);
      });
  }, [selectedCardKeys, browsers, cachedProfiles]);
}
