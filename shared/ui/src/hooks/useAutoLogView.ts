// ============================================================
// useAutoLogView —— 自动化运行的「视图自动切换」规范 hook
//
// 规范语义：
//   1. 点击「开始自动化」：强制切到 autoStartView（如 log），便于看到实时进度。
//   2. 业务成功完成且用户在运行期间未手动切视图：自动切回 successView（如 table）看结果。
//   3. 业务失败：不切视图，停留在当前视图（通常用户已在 log）看错误。
//   4. 用户主动切换（ViewToggle / wheel）：标记 userTouched，
//      本次 run 的 auto-switch 不覆盖用户选择（用户切换优先）。
//
// 视图状态持久化到 storageKey，跨 session 保留用户上次选择的视图。
// ============================================================

import { useCallback, useRef } from "react";
import { useData } from "../data";
import type { DataKeyRef } from "../data/types";

export interface AutoLogViewReturn<TView extends string> {
  /** 当前视图 */
  view: TView;
  /**
   * UI 上让用户主动切换视图的 setter —— ViewToggle / wheel 切视图都走这里。
   * 会标记 userTouched=true，本次 run 的 onAutoEnd 不再 auto-switch 覆盖。
   */
  setView: (v: TView) => void;
  /**
   * 自动化开始时调用 —— 重置 userTouched=false、强制切到 autoStartView。
   * 必须在 setRunning(true) 之前或同时调用。
   */
  onAutoStart: () => void;
  /**
   * 自动化结束时调用 —— success=true 且用户未切过 → 切到 successView；
   *                  success=true && userTouched=true → 不切（尊重用户）；
   *                  success=false → 不切（停留看错误）。
   */
  onAutoEnd: (success: boolean) => void;
}

/**
 * 「开始 → autoStartView, 成功 → successView, 失败 → 停留, 用户切换优先」规范 hook
 *
 * 泛型参数 TView 是视图类型字面量集合，例如 "log" | "table" 或 "log" | "table" | "mapping" | "legend"。
 *
 * 用法（003 项目 5 个 view 文件已落地）：
 * ```ts
 * const { view, setView, onAutoStart, onAutoEnd } = useAutoLogView<LogView>(
 *   store.keys["xxx-log-view"],
 *   "table",  // defaultView：首次加载默认显示
 *   "log",    // autoStartView：开始 → 跳到 log
 *   "table",  // successView：成功 → 切回 table
 * );
 *
 * const start = useCallback(async () => {
 *   setRunning(true);
 *   onAutoStart();        // 重置 userTouched + 跳 log
 *   let ok = false;
 *   try {
 *     ...业务...
 *     ok = true;
 *   } catch (e) {
 *     addLog(`⛔ 失败: ${e}`, "error");
 *   } finally {
 *     setRunning(false);
 *     onAutoEnd(ok);     // 成功且用户未切则切回 successView
 *   }
 * }, [...]);
 *
 * // UI 上用户手动切视图走 setView（自动标记 userTouched）
 * <ViewToggle value={view} onChange={setView} />
 * ```
 */
export function useAutoLogView<TView extends string>(
  storageKey: DataKeyRef<unknown>,
  defaultView: TView,
  autoStartView: TView,
  successView: TView,
): AutoLogViewReturn<TView> {
  // 兼容任意 DataKeyRef<T>：内部强制 cast 成 DataKeyRef<string>，由 TView 泛型做类型安全
  const [rawView, setRawView] = useData<string>(storageKey as DataKeyRef<string>);

  // ref 而不是 state：避免每次设置都触发重渲染；纯标记位
  const userTouchedRef = useRef(false);

  /** 解析持久化值：null/非 TView 字面量（脏数据 / 旧版本残留）回退到 defaultView */
  const view = (rawView ?? defaultView) as TView;

  /** UI 上用户主动切换 —— 标记 userTouched，本次 run 不再 auto-switch */
  const setView = useCallback((v: TView) => {
    userTouchedRef.current = true;
    setRawView(v);
  }, [setRawView]);

  /** 自动化开始时调用 —— 重置标记 + 强制切到 autoStartView */
  const onAutoStart = useCallback(() => {
    userTouchedRef.current = false;
    setRawView(autoStartView);
  }, [setRawView, autoStartView]);

  /** 自动化结束时调用 —— success=true && 用户未切则切到 successView */
  const onAutoEnd = useCallback((success: boolean) => {
    if (success && !userTouchedRef.current) setRawView(successView);
  }, [setRawView, successView]);

  return { view, setView, onAutoStart, onAutoEnd };
}
