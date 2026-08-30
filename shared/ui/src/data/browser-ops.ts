// ============================================================
//  浏览器 profile 操作适配器（注册式）
//
//  默认：Edge/Chrome 直接启动进程 / 精确杀进程树。
//  由外部主程序/服务托管的浏览器类型，由业务侧注册处理器后走各自官方路径，
//  框架本身不内置任何具体平台知识。
//
//  接入点：BrowserConfigSection / CurrentBrowserCards 的默认 launcher/close 改用
//  launchProfileSmart / closeProfileSmart，项目侧无需感知浏览器类型差异。
//
//  扩展方式（业务侧在应用入口调用一次）：
//    registerBrowserLaunchHandler("<type>", fn)
//    registerBrowserCloseHandler("<type>", fn)
//    registerBrowserDebugLaunchHandler("<type>", fn)  // 托管型浏览器不适用「杀进程+换端口重启」
// ============================================================

import { launchBrowserProfile, killBrowserProfileProcess } from "../api";
import { debugLaunchWithLockCheck } from "../components/browserLaunch";
import type { BCPProfile } from "../components/BrowserConfigPanel/types";

type LaunchHandler = (
  browserType: string,
  profileId: string,
  userDataDir: string,
  debugPort: number,
) => Promise<string>;

type CloseHandler = (browserType: string, profileId: string, userDataDir: string) => Promise<string>;

/** 调试启动处理器：返回真实 CDP 端口与 PID（托管型浏览器由其服务分配端口） */
type DebugLaunchHandler = (
  browserType: string,
  profile: BCPProfile,
  launch: LaunchHandler,
) => Promise<{ port: number; pid: string } | null>;

const launchHandlers = new Map<string, LaunchHandler>();
const closeHandlers = new Map<string, CloseHandler>();
const debugLaunchHandlers = new Map<string, DebugLaunchHandler>();

/** 注册某浏览器类型的启动处理器（托管型浏览器走其官方服务拉起） */
export function registerBrowserLaunchHandler(browserType: string, handler: LaunchHandler): void {
  launchHandlers.set(browserType, handler);
}

/** 注册某浏览器类型的关闭处理器 */
export function registerBrowserCloseHandler(browserType: string, handler: CloseHandler): void {
  closeHandlers.set(browserType, handler);
}

/** 注册某浏览器类型的调试启动处理器（跳过默认的锁检查+换端口重启模型） */
export function registerBrowserDebugLaunchHandler(
  browserType: string,
  handler: DebugLaunchHandler,
): void {
  debugLaunchHandlers.set(browserType, handler);
}

/** 该浏览器类型是否由外部服务托管（已注册启动处理器） */
export function isManagedBrowserType(browserType: string): boolean {
  return launchHandlers.has(browserType);
}

/** 智能启动：有注册处理器走注册路径，否则默认直接启动进程 */
export async function launchProfileSmart(
  browserType: string,
  profileId: string,
  userDataDir: string,
  debugPort: number,
): Promise<string> {
  const h = launchHandlers.get(browserType);
  if (h) return h(browserType, profileId, userDataDir, debugPort);
  return launchBrowserProfile(browserType, profileId, userDataDir, debugPort);
}

/** 智能关闭：有注册处理器走注册路径，否则默认按 profile 精确杀进程树 */
export async function closeProfileSmart(
  browserType: string,
  profileId: string,
  userDataDir: string,
): Promise<string> {
  const h = closeHandlers.get(browserType);
  if (h) return h(browserType, profileId, userDataDir);
  return killBrowserProfileProcess(browserType, profileId, userDataDir);
}

/**
 * 智能调试启动。
 *
 * 默认（Edge/Chrome）：锁检查 + 关闭旧进程 + 找随机端口 + 启动（debugLaunchWithLockCheck）。
 * 注册式托管浏览器：不走「杀进程+换端口重启」模型——环境由其服务拉起并分配调试端口，
 * 交由注册的 debugLaunch 处理器解析真实 CDP 端口返回。
 */
export async function debugLaunchProfileSmart(
  browserType: string,
  profile: BCPProfile,
  opts: {
    profiles: BCPProfile[];
    log: (msg: string, level?: "info" | "warning" | "success") => void;
  },
): Promise<{ port: number; pid: string } | null> {
  const h = debugLaunchHandlers.get(browserType);
  if (h) return h(browserType, profile, launchProfileSmart);
  return debugLaunchWithLockCheck({
    browserType,
    profiles: opts.profiles,
    profile,
    launch: (bt, id, dir, port) => launchProfileSmart(bt, id, dir, port),
    log: opts.log,
  });
}
