// 框架级 Tauri 调用工具（api.ts 与各业务 API 模块共用）

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

// ── 插件命令前缀 ──
const PLUGIN_PREFIX = "plugin:appkit-core|";

/**
 * 是否运行在 Tauri 运行时中。
 *
 * 在浏览器里直接打开 vite dev server 时没有 `window.__TAURI_INTERNALS__`，
 * 此时 `@tauri-apps/api` 的 invoke 会抛 `Cannot read properties of undefined (reading 'invoke')`。
 * 所有 Tauri 命令调用前应先检测，给出友好提示而非裸 TypeError。
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

/** 非 Tauri 环境下的统一错误信息 */
export function tauriRuntimeError(cmd: string): Error {
  return new Error(
    `命令 ${cmd} 需要 Tauri 运行时。当前处于浏览器预览模式（vite dev server），请通过桌面应用运行：npm run tauri dev`
  );
}

/**
 * 带诊断提示的插件命令调用
 *
 * 当命令未找到时，在控制台输出清晰的排查指引，
 * 避免"Command xxx not found"这种难以定位的错误。
 */
export async function pluginInvoke<T>(cmdName: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw tauriRuntimeError(cmdName);
  const fullCmd = PLUGIN_PREFIX + cmdName;
  try {
    return await tauriInvoke<T>(fullCmd, args);
  } catch (e: unknown) {
    if (String(e).includes("not found")) {
      console.error(
        `[api] 命令未找到: "${fullCmd}"\n` +
        `  请检查以下可能原因:\n` +
        `    1. Rust 端 tauri_bridge.rs 的 generate_handler! 中是否包含该命令\n` +
        `    2. 项目 build.rs 的 commands 列表中是否包含该命令\n` +
        `    3. capabilities/default.json 中是否有对应权限 (appkit-core:allow-xxx)\n` +
        `    4. 是否重新编译了 Rust 后端 (pnpm tauri dev 会自动触发 cargo build)\n` +
        `    5. 命令名拼写是否有误`
      );
    }
    throw e;
  }
}

export { tauriInvoke };
