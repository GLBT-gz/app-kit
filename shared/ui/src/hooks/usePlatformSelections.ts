import { useMemo, useCallback } from "react";
import { useData } from "../data";
import { getRegisteredPlatforms } from "../components/PlatformConfigPanel";

/**
 * 根据 registerPlatforms() 注册的平台自动生成 useData 绑定。
 *
 * 返回：
 * - selections: Record<platformKey, string | null> — 各平台已选的浏览器 key
 * - setSelection: (platformKey, browserKey) => void — 设置选择
 *
 * 各子项目的自动化页面直接调用此 hook 获取平台-浏览器绑定关系。
 */
export function usePlatformSelections(): {
  selections: Record<string, string | null>;
  setSelection: (platformKey: string, browserKey: string | null) => void;
} {
  const platforms = getRegisteredPlatforms();
  const selections: Record<string, string | null> = {};
  const setters: Record<string, (v: string | null) => void> = {};

  for (const platform of platforms) {
    const key = `platform-profile-${platform.key}`;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useData<string | null>({
      key,
      default: null,
      category: "config",
      desc: `${platform.label}浏览器配置`,
      storage: "localStorage",
    });
    selections[platform.key] = value;
    setters[platform.key] = setValue;
  }

  const setSelection = useCallback((platformKey: string, browserKey: string | null) => {
    setters[platformKey]?.(browserKey);
  }, [setters]);

  return useMemo(() => ({ selections, setSelection }), [selections, setSelection]);
}
