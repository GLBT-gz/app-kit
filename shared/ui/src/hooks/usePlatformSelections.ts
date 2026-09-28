import { useMemo, useCallback, useRef } from "react";
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
 *
 * ## 引用稳定性（2026-09-28 fix）
 *
 * 旧实现每次 render 都新建 `selections` 与 `setters` 对象，导致
 * `useMemo([selections, setSelection])` 永远返回新 wrapper——下游
 * `usePlatformBrowserInfo` 的 memo 也连锁失效，把 hook 结果放进 `useEffect`
 * 依赖时（如 016 `useTemuRunner` 的 `args.edgeInfoGz/Hk`）会在每次 render
 * 触发副作用，表现为「AutomationContext 已注入」同秒连打多次。
 *
 * 修法：
 * - `setSelection` 用 `useRef` 缓存最新 setters，callback 空依赖永远稳定
 * - `selections` 用 `JSON.stringify` 当 memo key——content 相同时返回同一引用
 * - 外层 wrapper 的两个依赖现在都稳定 → 返回引用稳定
 *
 * 影响面：所有用 `usePlatformSelections` 的项目（001/002/003/004/006/007/
 * 010/013/014/015/016 等 12 个）下游 memo 都会自然稳定；零行为变化，纯性能
 * /引用稳定性修复。引入新平台 key 后 selectionsJson 才会变。
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

  // ── [2026-09-28 fix] setters 用 ref 缓存，setSelection 引用永远稳定 ──
  // 旧实现 useCallback([setters]) → setters 每次 render 新对象 → setSelection 也新
  // → useMemo([selections, setSelection]) 永远返回新 wrapper → 下游 memo 全部失效
  const settersRef = useRef(setters);
  settersRef.current = setters;
  const setSelection = useCallback((platformKey: string, browserKey: string | null) => {
    settersRef.current[platformKey]?.(browserKey);
  }, []);

  // ── [2026-09-28 fix] selections 用 content（JSON）当 memo key ──
  // 旧实现 useMemo([selections]) → selections 每次 render 新对象 → memo 永远失效
  // JSON.stringify 在 render 内执行是 O(n)——对几个 platform key 来说可忽略
  const selectionsJson = JSON.stringify(selections);
  const selectionsStable = useMemo(() => selections, [selectionsJson]);

  return useMemo(
    () => ({ selections: selectionsStable, setSelection }),
    [selectionsStable, setSelection],
  );
}
