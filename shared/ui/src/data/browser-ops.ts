// ============================================================
//  浏览器 profile 操作适配器（注册式）
//
//  默认：Edge/Chrome 直接启动进程 / 精确杀进程树。
//  特殊类型（如紫鸟）注册后走各自官方路径：
//    - 紫鸟环境由主程序 agent 服务拉起（内核 stub 直启会静默退出，见 platforms/ziniao registry.rs），
//      启动 → agent startBrowser(browserId)，端口 → agent 探测 CDP；
//      关闭 → 优先 agent stopBrowser，回退 CDP close。
//
//  接入点：BrowserConfigSection / CurrentBrowserCards 的默认 launcher/close 改用
//  launchProfileSmart / closeProfileSmart，项目侧无需感知浏览器类型差异。
// ============================================================

import { launchBrowserProfile, killBrowserProfileProcess } from "../api";
import { debugLaunchWithLockCheck } from "../components/browserLaunch";
import type { BCPProfile } from "../components/BrowserConfigPanel/types";
import {
  ziniaoAgentStatus,
  ziniaoAgentLaunch,
  ziniaoAgentStartBrowser,
  ziniaoAgentCdpPort,
  ziniaoAgentStopBrowser,
  ziniaoAgentClose,
} from "../ziniao-api";

type LaunchHandler = (
  browserType: string,
  profileId: string,
  userDataDir: string,
  debugPort: number,
) => Promise<string>;

type CloseHandler = (browserType: string, profileId: string, userDataDir: string) => Promise<string>;

const launchHandlers = new Map<string, LaunchHandler>();
const closeHandlers = new Map<string, CloseHandler>();

/** 注册某浏览器类型的启动处理器（如紫鸟走 agent startBrowser） */
export function registerBrowserLaunchHandler(browserType: string, handler: LaunchHandler): void {
  launchHandlers.set(browserType, handler);
}

/** 注册某浏览器类型的关闭处理器 */
export function registerBrowserCloseHandler(browserType: string, handler: CloseHandler): void {
  closeHandlers.set(browserType, handler);
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
 * 注册式托管浏览器（如紫鸟）：不走「杀进程+换端口重启」模型——环境由 agent 拉起并分配
 * 调试端口，直接经 launchProfileSmart 打开后解析真实 CDP 端口返回。
 */
export async function debugLaunchProfileSmart(
  browserType: string,
  profile: BCPProfile,
  opts: {
    profiles: BCPProfile[];
    log: (msg: string, level?: "info" | "warning" | "success") => void;
  },
): Promise<{ port: number; pid: string } | null> {
  if (browserType === "ziniao") {
    const msg = await launchProfileSmart(browserType, profile.id, profile.user_data_dir, 0);
    const browserId = Number(profile.id);
    if (Number.isNaN(browserId)) throw new Error(`无效的紫鸟环境 ID: ${profile.id}`);
    // 打开后解析真实 CDP 端口（新架构端口随机，按内核进程监听精确归属）
    const port = await ziniaoAgentCdpPort(browserId);
    return { port, pid: msg.replace("PID:", "") };
  }
  return debugLaunchWithLockCheck({
    browserType,
    profiles: opts.profiles,
    profile,
    launch: (bt, id, dir, port) => launchProfileSmart(bt, id, dir, port),
    log: opts.log,
  });
}

// ── 紫鸟适配（app-kit 内置：ziniao-api 已在此库，无需项目注册） ──

registerBrowserLaunchHandler("ziniao", async (_bt, profileId, _dir, _debugPort) => {
  // 紫鸟主程序入口（id=Default）：直接打开紫鸟主程序，不视为店铺环境
  if (profileId === "Default") {
    const launched = await ziniaoAgentLaunch();
    return `PID:${launched.pid ?? ""}`;
  }

  const browserId = Number(profileId);
  if (Number.isNaN(browserId)) throw new Error(`无效的紫鸟环境 ID: ${profileId}`);

  let st = await ziniaoAgentStatus();
  if (!st.port) {
    // 未探测到 agent 服务：尝试拉起紫鸟主程序再等登录态（已运行则复用）
    const launched = await ziniaoAgentLaunch();
    if (!launched.launched && !st.running) {
      throw new Error("紫鸟主程序未运行");
    }
    st = await ziniaoAgentStatus();
  }
  if (!st.port) {
    throw new Error(st.note || "未发现 agent 服务，请确认紫鸟已登录");
  }

  await ziniaoAgentStartBrowser(st.port, browserId);
  // 官方拉起后等内核 CDP 端口就绪（按 browserId 归属精确定位）
  const port = await ziniaoAgentCdpPort(browserId);
  return `PID:${st.pid ?? ""} port:${port}`;
});

registerBrowserCloseHandler("ziniao", async (_bt, profileId) => {
  const browserId = Number(profileId);
  if (Number.isNaN(browserId)) throw new Error(`无效的紫鸟环境 ID: ${profileId}`);
  // 优先官方 stopBrowser（agent 端口可用时）；失败回退 CDP close
  try {
    const st = await ziniaoAgentStatus();
    if (st.port) {
      await ziniaoAgentStopBrowser(st.port, browserId);
      return "已通过 agent 关闭";
    }
  } catch {
    /* 回退 */
  }
  await ziniaoAgentClose(browserId);
  return "已关闭";
});
