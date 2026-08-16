import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ziniaoAgentLaunch,
  ziniaoAgentStatus,
  ziniaoAgentProcStatus,
  ziniaoAgentBrowserList,
  ziniaoAgentStartBrowser,
  ziniaoAgentCdpPort,
  ziniaoAgentRunning,
  ziniaoAgentClose,
  ziniaoActivate,
  ziniaoEnterShop,
  ziniaoEval,
  ziniaoScreenshot,
} from "../ziniao-api";
import type { ZiniaoAgentBrowser, ZiniaoAgentStatus } from "../ziniao-api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 将 shop 状态写入 shopState（key 统一为 String(browserId)） */
export type SetShopState = (id: number, st: string) => void;

/** useLog 的 log 函数签名（与 LogPanel 对齐） */
export type ZnLogFn = (msg: string, level?: "info" | "success" | "error" | "warn" | "step" | "debug") => void;

/**
 * 紫鸟自动化核心逻辑 hook（公共组件共用）
 *
 * OpsPanel / TestPanel 的重复逻辑统一收敛于此：
 * 状态（busy/agent/shops/running/shots/shopState）+ 步骤
 * （打开紫鸟 / 店铺列表 / 打开 / 关闭 / CDP 验证）+ 统一 log 包装。
 *
 * 差异部分由调用方实现：补丁检查安装（TestPanel）、JS/导航（OpsPanel）、选中状态。
 */
export function useZiniaoAgent(log: ZnLogFn) {
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<ZiniaoAgentStatus | null>(null);
  const [shops, setShops] = useState<ZiniaoAgentBrowser[]>([]);
  const [shots, setShots] = useState<Record<string, string>>({});
  const [shopState, setShopState] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<Set<number>>(new Set());

  const setShop: SetShopState = (id, st) =>
    setShopState((prev) => ({ ...prev, [String(id)]: st }));

  const refreshRunning = async (port: number): Promise<number[]> => {
    const ids = await ziniaoAgentRunning(port);
    setRunning(new Set(ids));
    return ids;
  };

  // ① 打开紫鸟
  const stepLaunch = async (): Promise<string> => {
    const r = await ziniaoAgentLaunch();
    // 立即刷新进程运行状态（轻量，不探测 agent_mode），避免徽标误报"未检测到运行中"
    try {
      setAgent(await ziniaoAgentProcStatus());
    } catch {
      /* 忽略，保持原状态 */
    }
    return r.launched ? `已启动紫鸟主程序 (PID ${r.pid})` : `紫鸟已在运行 (PID ${r.pid})`;
  };

  // ② 店铺列表（含运行状态）
  const stepList = async (): Promise<string> => {
    const st = await ziniaoAgentStatus();
    setAgent(st);
    if (!st.running) return "紫鸟主程序未运行";
    if (!st.port) {
      return "未发现 agent_mode 服务：请确认紫鸟已登录且 v10.9 补丁已安装（登录后约 30s 内自动开启）";
    }
    const [list, ids] = await Promise.all([
      ziniaoAgentBrowserList(st.port),
      refreshRunning(st.port),
    ]);
    setShops(list);
    return `agent_mode 端口 :${st.port}，共 ${list.length} 个店铺，${ids.length} 个已打开`;
  };

  // 获取 agent_mode 端口：优先用本实例已探测状态，否则实时探测一次。
  // 用途：缓存店铺列表页（达人寄样）未执行「店铺列表」时也能直接打开/关闭店铺。
  const ensurePort = async (): Promise<number> => {
    if (agent?.port) return agent.port;
    const st = await ziniaoAgentStatus();
    setAgent(st);
    if (!st.port) {
      throw new Error("未发现 agent_mode 服务：请先执行「店铺列表」，或确认紫鸟已登录且 v10.9 补丁已安装");
    }
    return st.port;
  };

  // ③ 打开店铺（browserId 必须传字符串，后端处理）
  const stepOpen = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    const port = await ensurePort();
    setShop(shop.browserId, "直开中…");
    try {
      await ziniaoAgentStartBrowser(port, shop.browserId);
      const cdp = await ziniaoAgentCdpPort(shop.browserId);
      setShop(shop.browserId, `已直开，CDP :${cdp}（启动中…）`);
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const ids = await refreshRunning(port);
        if (ids.includes(shop.browserId)) {
          setShop(shop.browserId, "已打开");
          return `已打开 ${shop.browserName} (browserId=${shop.browserId})，CDP :${cdp}（第 ${i + 1} 秒确认）`;
        }
      }
      return `已请求直开 ${shop.browserName}，60s 内未确认。冷启动含内核下载可能需 1-3 分钟`;
    } catch (e) {
      setShop(shop.browserId, "直开失败");
      throw e;
    }
  };

  // 关闭店铺（CDP Browser.close）
  const stepClose = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    const port = await ensurePort();
    setShop(shop.browserId, "关闭中…");
    try {
      await ziniaoAgentClose(shop.browserId);
      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        const ids = await refreshRunning(port);
        if (!ids.includes(shop.browserId)) {
          setShop(shop.browserId, "已关闭");
          return `已关闭 ${shop.browserName}（第 ${i + 1} 秒确认）`;
        }
      }
      setShop(shop.browserId, "未确认关闭");
      return `已发送关闭 ${shop.browserName}，但 20s 内状态仍为运行中`;
    } catch (e) {
      setShop(shop.browserId, "关闭失败");
      throw e;
    }
  };

  // ④ CDP 控制：等待内核就绪 → eval → 截图
  const stepCdp = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    const cdp = await ziniaoAgentCdpPort(shop.browserId);
    setShop(shop.browserId, "CDP 连接中…");
    let info = "";
    for (let i = 0; i < 60; i++) {
      try {
        const v = await ziniaoEval(
          cdp,
          `JSON.stringify({ title: document.title, url: location.href })`,
        );
        info = `:${cdp} → ${v}`;
        break;
      } catch {
        await sleep(1500);
      }
    }
    if (!info) {
      setShop(shop.browserId, "CDP 超时");
      throw new Error(`CDP :${cdp} 内核 90s 内未就绪（冷启动含内核下载可能更久）`);
    }
    let shotNote = "";
    try {
      const b64 = await ziniaoScreenshot(cdp);
      setShots((prev) => ({ ...prev, [String(shop.browserId)]: b64 }));
      shotNote = `，截图 ${Math.round((b64.length * 3) / 4)}B`;
    } catch {
      shotNote = "（截图失败）";
    }
    setShop(shop.browserId, "CDP 正常");
    return `CDP 控制 ${info}${shotNote}`;
  };

  // 进入店铺（激活页面窗口置前，不重新打开；适用于已打开的环境）
  const stepEnter = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    const cdp = await ziniaoAgentCdpPort(shop.browserId);
    await ziniaoActivate(cdp);
    setShop(shop.browserId, "已激活");
    return `已进入 ${shop.browserName}（激活 :${cdp}）`;
  };

  // 进入店铺（含「打开账号」）：激活 + 若处于紫鸟账号检测扩展页则点击「打开账号」进入真实页面
  const stepEnterShop = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    const cdp = await ziniaoAgentCdpPort(shop.browserId);
    const msg = await ziniaoEnterShop(cdp);
    setShop(shop.browserId, "已进入");
    return `已进入 ${shop.browserName} :${cdp} → ${msg}`;
  };

  // 统一 log 包装：label + fn()，busy 包裹
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    try {
      log(`${label} → ${await fn()}`);
    } catch (e) {
      log(`${label} 失败: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // 一键验收：①→②→③（第一个未打开店铺）→④
  const acceptAll = async (onFirst: (shop: ZiniaoAgentBrowser) => void) => {
    setBusy(true);
    try {
      log(`① 自动打开紫鸟 → ${await stepLaunch()}`);
      const st = await ziniaoAgentStatus();
      setAgent(st);
      if (!st.running || !st.port) {
        log("② 获取店铺列表 → 未发现 agent_mode 服务（需登录 + v10.9 补丁）", "error");
        return;
      }
      log(`② 获取店铺列表 → agent_mode :${st.port}，拉取中…`);
      const list = await ziniaoAgentBrowserList(st.port);
      const ids = await refreshRunning(st.port);
      setShops(list);
      log(`  共 ${list.length} 个店铺，${ids.length} 个已打开`);
      if (list.length === 0) return;
      const first = list.find((s) => !ids.includes(s.browserId)) ?? list[0];
      onFirst(first);
      log(`③ 打开店铺 → ${first.browserName} (browserId=${first.browserId})`);
      await ziniaoAgentStartBrowser(st.port, first.browserId);
      const cdp = await ziniaoAgentCdpPort(first.browserId);
      log(`  直开请求成功，等待内核就绪 (:${cdp})…`);
      log(`④ CDP 控制 → ${await stepCdp(first)}`);
      log("✅ 全部通过", "success");
    } catch (e) {
      log(`验收失败: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    agent,
    shops,
    shots,
    shopState,
    running,
    setBusy,
    setAgent,
    setShops,
    setShots,
    setShopState,
    setRunning,
    setShop,
    refreshRunning,
    stepLaunch,
    stepList,
    stepOpen,
    stepClose,
    stepCdp,
    stepEnter,
    stepEnterShop,
    run,
    acceptAll,
  };
}

export type UseZiniaoAgentReturn = ReturnType<typeof useZiniaoAgent>;
export type { Dispatch, SetStateAction };
