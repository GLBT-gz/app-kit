// ═══════════════════════════════════════════════════════════════
// 统一日志规范（共享层）—— 后端自动化命令通过 app.emit(event, { message, level }) 广播进度
//   - level 取值: "info" | "ok" | "warn" | "error"（"ok" 对应 UI 层的 "success"）
// 各项目不再各自维护 ProgressPayload / toLogLevel（历史上有 010/006/007 三份漂移副本），
// 统一从 @appkit/ui 引用；项目侧 log.ts 只需 re-export 共享实现。
// ═══════════════════════════════════════════════════════════════

import type { LogLevel } from "./components/LogPanel";

/** 后端进度事件 payload（所有自动化命令统一结构） */
export interface ProgressPayload {
  message: string;
  level: string;
}

/** 后端级别 → UI LogLevel 白名单映射（后端统一用 "ok" 表示成功，UI 层为 "success"） */
const LEVEL_MAP: Record<string, LogLevel> = {
  info: "info",
  ok: "success",
  err: "error", // 兼容后端旧写法（失败统一按 error 显示）
  error: "error",
  warn: "warn",
  step: "step",
  debug: "debug",
};

/**
 * 后端日志级别 → UI LogLevel 统一映射。
 * 未知/缺省级别一律按 info 处理。
 */
export function toLogLevel(level?: string | null): LogLevel {
  return LEVEL_MAP[level ?? ""] ?? "info";
}

/**
 * 按返回文案标记推断日志级别并逐行输出，避免把失败内容当成功(OK)显示：
 * - 行含 ✅ → success
 * - 行含 ⚠️/❌/✖ → error（失败/错误，绝不按成功显示）
 * - 行含 ⏳ → warn（超时/待确认）
 * - 无标记行沿用上一条带标记行的级别（多公司结果里失败详情行保持 error）
 * 供测试页/自动化页把后端返回的多行结果字符串转为分级日志。
 */
export function logResultLines(
  log: (message: string, level: LogLevel) => void,
  text: string,
) {
  let level: LogLevel = "success";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes("✅")) level = "success";
    else if (t.includes("⚠️") || t.includes("❌") || t.includes("✖")) level = "error";
    else if (t.includes("⏳")) level = "warn";
    log(t, level);
  }
}
