// ============================================================
//  紫鸟主程序运行状态（共享单例轮询）
//
//  与 profileStatusStore（进程扫描）互补：
//    - profileStatusStore 识别 ziniaobrowser.exe（环境内核）→ 各店铺环境「已启动/可连」
//    - 本 store 探测紫鸟主程序本体（ziniao.exe，agent 进程探测 O(1)）→ 主程序卡片「已启动」
//  主程序没有固定 CDP 端口（宿主程序），仅提供 running/pid；agent_mode 端口按需用
//  ziniaoAgentStatus 探测（见「登录并绑定店铺名称」）。
// ============================================================

import { useSyncExternalStore } from "react";
import { ziniaoAgentProcStatus } from "../ziniao-api";

export interface ZiniaoMainStatus {
  running: boolean;
  pid: number | null;
}

/** 轮询间隔：proc 探测为轻量进程查询，开销极小 */
const POLL_INTERVAL_MS = 5000;

let state: ZiniaoMainStatus = { running: false, pid: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

function notify(): void {
  for (const l of listeners) l();
}

function getSnapshot(): ZiniaoMainStatus {
  return state;
}

async function tick(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const st = await ziniaoAgentProcStatus();
    const next: ZiniaoMainStatus = { running: !!st.running, pid: st.pid ?? null };
    if (next.running !== state.running || next.pid !== state.pid) {
      state = next;
      notify();
    }
  } catch {
    // 未注册紫鸟命令的项目（无 plugin feature）→ 静默，保持未运行
  } finally {
    polling = false;
  }
}

function start(): void {
  if (timer !== null) return;
  void tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stop();
  };
}

/** 订阅紫鸟主程序运行状态（全局单例；无订阅者时暂停轮询） */
export function useZiniaoMainStatus(): ZiniaoMainStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
