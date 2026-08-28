// ============================================================
//  Profile 运行状态共享轮询（单一调度器）
//
//  职责：
//    - 全局唯一的 5s 轮询循环：多个组件实例（首页/设置页/平台面板）
//      挂载时只注册兴趣，不各自起 interval（消除重复 IPC 轮询）
//    - 状态快照 diff：仅在实际变化时通知订阅者，避免无意义重渲染
//    - 可见性优化：document.hidden 或所有订阅容器均不可见时跳过本轮检测；
//      容器重新可见时立即补一轮
//
//  状态两个独立维度：
//    - launch：浏览器进程是否已启动（is_running）
//    - conn：CDP 是否可连（后端 TCP 直连探测）
// ============================================================

import { useEffect, useRef, useSyncExternalStore } from "react";
import { detectBrowserRunningProcesses } from "../api";
import type { BrowserProcessState } from "../types";

/** 浏览器进程是否已启动 */
export type LaunchStatus = "not_launched" | "launched" | "shared";
/** CDP 是否可连接 */
export type ConnectionStatus = "not_connectable" | "connectable";

export interface ProfileStatusMaps {
  /** key = bt|user_data_dir|profile_id */
  launch: Record<string, LaunchStatus>;
  conn: Record<string, ConnectionStatus>;
  /**
   * key = bt|user_data_dir|profile_id → running_kind："own" | "shared"
   * shared = 与同目录其它配置共享同一实例，无独立进程可杀
   */
  kind: Record<string, "own" | "shared">;
  /**
   * key = bt|user_data_dir|profile_id → 实际运行的调试端口（可连时为端口字符串，未启动/不可连为 null）。
   * 动态端口每次启动都不同，用于命令弹窗等场景展示真实可连端口
   */
  ports: Record<string, string | null>;
}

export interface ProfileStatusItem {
  bt: string;
  dir: string;
  id: string;
}

/** 轮询间隔：后端是 TCP 直连检测，开销极小 */
const POLL_INTERVAL_MS = 5000;

// ── 共享状态 ──

let state: ProfileStatusMaps = { launch: {}, conn: {}, kind: {}, ports: {} };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function notify(): void {
  for (const l of listeners) l();
}

function setState(next: ProfileStatusMaps): void {
  state = next;
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): ProfileStatusMaps {
  return state;
}

/** 订阅全局 profile 状态快照 */
export function useProfileStatusSnapshot(): ProfileStatusMaps {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── 订阅者登记表 ──

interface Subscriber {
  /** 该订阅者关心的 profile 列表（每次渲染更新） */
  items: ProfileStatusItem[];
  /** 容器当前是否可见（IntersectionObserver 维护） */
  visible: boolean;
}

let nextSubId = 1;
const subscribers = new Map<number, Subscriber>();

/** 收集全部去重后的检测条目 */
function collectItems(): ProfileStatusItem[] {
  const seen = new Set<string>();
  const items: ProfileStatusItem[] = [];
  for (const sub of subscribers.values()) {
    for (const it of sub.items) {
      const k = `${it.dir}|${it.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(it);
    }
  }
  return items;
}

function ensureTimer(): void {
  if (timer !== null || subscribers.size === 0) return;
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

function stopTimerIfIdle(): void {
  if (timer !== null && subscribers.size === 0) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(immediate = false): Promise<void> {
  if (ticking || subscribers.size === 0) return;
  if (typeof document !== "undefined" && document.hidden) return;
  // 所有订阅容器都不可见（tab 切走/display:none）→ 跳过本轮 IPC
  let anyVisible = false;
  for (const sub of subscribers.values()) {
    if (sub.visible) { anyVisible = true; break; }
  }
  if (!anyVisible && !immediate) return;

  const items = collectItems();
  if (items.length === 0) return;

  ticking = true;
  try {
    const states = await detectBrowserRunningProcesses(
      items.map(e => ({ user_data_dir: e.dir, profile_id: e.id })),
    );

    const byLookup: Record<string, BrowserProcessState> = {};
    for (const s of states) {
      byLookup[`${s.user_data_dir}|${s.profile_id}`] = s;
    }

    const launch: Record<string, LaunchStatus> = {};
    const conn: Record<string, ConnectionStatus> = {};
    const kind: Record<string, "own" | "shared"> = {};
    const ports: Record<string, string | null> = {};
    for (const it of items) {
      const key = `${it.bt}|${it.dir}|${it.id}`;
      const st = byLookup[`${it.dir}|${it.id}`];
      if (!st || !st.is_running) {
        launch[key] = "not_launched";
        conn[key] = "not_connectable";
        kind[key] = "own";
        ports[key] = null;
        continue;
      }
      launch[key] = st.running_kind === "shared" ? "shared" : "launched";
      conn[key] = st.cdp_reachable ? "connectable" : "not_connectable";
      kind[key] = st.running_kind === "shared" ? "shared" : "own";
      // 仅可连时才有可信端口；不可连（如无 --remote-debugging-port 启动）视为无端口
      ports[key] = st.cdp_reachable ? st.debug_port : null;
    }

    // 与前一次对比，只有实际变化时才更新，避免无意义重渲染
    let changed = false;
    for (const [k, v] of Object.entries(launch)) {
      if (state.launch[k] !== v) { changed = true; break; }
    }
    if (!changed) {
      for (const [k, v] of Object.entries(conn)) {
        if (state.conn[k] !== v) { changed = true; break; }
      }
    }
    if (!changed) {
      for (const [k, v] of Object.entries(kind)) {
        if (state.kind[k] !== v) { changed = true; break; }
      }
    }
    if (!changed) {
      for (const [k, v] of Object.entries(ports)) {
        if (state.ports[k] !== v) { changed = true; break; }
      }
    }
    if (!changed) {
      for (const k of Object.keys(state.launch)) {
        if (!(k in launch)) { changed = true; break; }
      }
    }
    if (changed) setState({ launch, conn, kind, ports });
  } catch {
    // 检测失败时保持上次状态
  } finally {
    ticking = false;
  }
}

/**
 * 注册一组 profile 的状态兴趣（组件级 hook）。
 *
 * - items 变化自动同步到全局调度器（按 dir|id 去重合并）
 * - containerRef 用于可见性判断：容器隐藏时该订阅者不参与「是否有人看」的判定，
 *   全部订阅者都隐藏时跳过 IPC；重新可见立即补一轮
 * - 组件读取状态用 useProfileStatusSnapshot()
 *
 * @returns 卸载清理函数无需关心，hook 内部自理
 */
export function useRegisterProfileStatusInterest(
  items: ProfileStatusItem[],
  containerRef: React.RefObject<HTMLElement | null>,
): void {
  // items 每次渲染都是新数组：存 ref 供调度器读取，不触发重注册
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const id = nextSubId++;
    const sub: Subscriber = { items: itemsRef.current, visible: true };
    subscribers.set(id, sub);
    ensureTimer();
    // 首个订阅者注册时立即检测一次，避免等 5s
    void tick(true);

    // 容器从 display:none 切回可见时立即检测一次
    let io: IntersectionObserver | null = null;
    const el = containerRef.current;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(entries => {
        const vis = entries.some(en => en.isIntersecting);
        sub.visible = vis;
        if (vis) void tick(true);
      });
      io.observe(el);
    }

    return () => {
      subscribers.delete(id);
      io?.disconnect();
      stopTimerIfIdle();
    };
    // containerRef.current 首次挂载后稳定，仅依赖空数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
