import { useEffect } from "react";

/**
 * 滚轮切换标签（穿透到副容器）。
 *
 * 将 wheel 监听绑定在「整个栏目的外层容器」（副容器）上，而不是标签栏自身——
 * 这样标签只有 2-3 个、标签栏很短时，鼠标在容器内任意位置滚动都能切换标签。
 *
 * 使用规范（见 app-kit/docs/代码规范.md「滚轮交互规范」）：
 * - 主顶栏场景：直接用 AppLayout 的 onTopBarWheel（共享层已内置原生监听），不需要本 hook
 * - 自定义标签栏/面板场景：把 ref 指向**覆盖整个栏目展示范围**的外层容器，用本 hook
 *
 * @param containerRef 副容器 ref（覆盖整个栏目范围的元素，非标签栏自身）
 * @param onChange 方向回调：1 = 下一个标签，-1 = 上一个标签（边界判断由调用方处理）
 * @param enabled 可选：返回 false 时忽略滚轮（如设置面板打开时）
 */
export function useWheelTabSwitch(
  containerRef: React.RefObject<HTMLElement | null>,
  onChange: (dir: 1 | -1) => void,
  enabled?: () => boolean,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (enabled && !enabled()) return;
      onChange(e.deltaY > 0 ? 1 : -1);
    };
    // 原生监听比 React onWheel（合成事件）可靠，避免与 data-tauri-drag-region 冲突
    el.addEventListener("wheel", handler, { passive: true });
    return () => el.removeEventListener("wheel", handler);
  }, [containerRef, onChange, enabled]);
}
