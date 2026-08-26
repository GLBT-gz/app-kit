import { detectBrowserRunningProcesses, killBrowserProfileProcess, findAvailablePort } from "../api";
import type { BCPProfile } from "../components/BrowserConfigPanel/types";

/**
 * 调试启动前的「Singleton 锁检查 + 释放」。
 * Chrome/Edge 的 Singleton 锁针对整个 user_data_dir：同目录下有任何 profile 在运行，
 * 新进程都无法使用该目录。因此：
 * 1) 检测同 user_data_dir 下运行中的 profile，若有则先确认、再关闭（释放目录锁并等待退出）；
 * 2) 分配随机可用调试端口，由调用方以 --remote-debugging-port 启动。
 * 返回 null 表示用户取消了关闭确认。
 */
export async function debugLaunchWithLockCheck(opts: {
  browserType: string;
  /** 浏览器全部 profile（内部会过滤同 user_data_dir） */
  profiles: BCPProfile[];
  profile: BCPProfile;
  launch: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<string>;
  log: (msg: string, level?: "info" | "warning" | "success") => void;
}): Promise<{ port: number; pid: string } | null> {
  const { browserType, profiles, profile, launch, log } = opts;
  const sameDir = profiles.filter(pr => pr.user_data_dir === profile.user_data_dir);

  const states = await detectBrowserRunningProcesses(
    sameDir.map(pr => ({ user_data_dir: pr.user_data_dir, profile_id: pr.id })),
  );
  // 优先选拥有独立主进程的 profile（可按 profile 精确关闭）；否则退回共享实例的 owner
  const running =
    states.find(s => s.is_running && s.running_kind === "own") || states.find(s => s.is_running);
  if (running) {
    // 共享实例（running_kind==="shared"）本身无独立进程，须关闭其共享主进程释放目录锁
    const killId =
      running.running_kind === "shared" && running.owner_profile_id
        ? running.owner_profile_id
        : running.profile_id;
    const runningProfile =
      sameDir.find(pr => pr.id === killId) ||
      sameDir.find(pr => pr.id === running.profile_id);
    const runningName = runningProfile?.name || running.profile_id;
    if (
      !window.confirm(
        `「${runningName}」正在运行（同一用户目录）。\n调试启动需要先关闭该进程以释放目录锁，未保存的内容可能丢失。\n确定关闭并继续？`,
      )
    ) {
      return null;
    }
    log(`「${runningName}」正在运行（同用户目录），先关闭...`, "warning");
    await killBrowserProfileProcess(browserType, killId, running.user_data_dir);
    log("已关闭旧进程，等待释放目录锁", "success");
    // 等待进程完全退出，释放 Singleton 锁
    await new Promise(r => setTimeout(r, 1500));
  }

  log("查找可用调试端口...", "info");
  const port = await findAvailablePort(40000, 60000);
  const msg = await launch(browserType, profile.id, profile.user_data_dir, port);
  return { port, pid: msg.replace("PID:", "") };
}
