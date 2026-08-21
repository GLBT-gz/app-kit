// ============================================================
// useLogWidthPct —— 侧边栏/日志栏宽度比例 hook（公共层）
//
// 统一各项目「测试页日志栏 / 排程日志栏」的宽度存储规范：
// 持久化保存「占比 %」（0-100）而非固定 px，窗口全屏/缩小时
// 侧边栏保持相同视觉占比，不会在小窗口下占满屏幕。
// - 旧版存的固定 px（>100，如 340/360）会一次性迁移为默认占比
// - 用法：const [logWidth, setLogWidth] = useLogWidthPct(store.keys["test-log-width"]);
// - 配合 TestPageLayout 使用（其 logWidth 即为 0-100 的百分比）
// ============================================================

import { useEffect } from "react";
import { useData } from "../data";
import type { DataKeyRef } from "../data/types";

/** 日志栏宽度比例默认值（%） */
export const LOG_WIDTH_DEFAULT_PCT = 28;

/**
 * 侧边栏/日志栏宽度比例 hook：持久化「占比 %」而非固定 px。
 * 旧版固定 px 值（>100 或非法值）一次性迁移为默认占比。
 * @returns [pct, setPct, remove] —— pct 为 0-100 的百分比
 */
export function useLogWidthPct(
  keyRef: DataKeyRef<number>,
  defaultPct: number = LOG_WIDTH_DEFAULT_PCT,
) {
  const [pct, setPct, remove] = useData<number>(keyRef);

  // 一次性迁移：旧版存的是固定 px（如 340/360），按默认占比归一
  useEffect(() => {
    if (pct > 100 || pct <= 0) setPct(defaultPct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [pct, setPct, remove] as const;
}
