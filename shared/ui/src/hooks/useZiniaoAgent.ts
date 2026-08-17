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
  ziniaoAgentStopBrowser,
  ziniaoAgentClose,
  ziniaoActivate,
  ziniaoEnterShopPoll,
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
    log("正在探测 agent 服务端口（最长约 40 秒；若紫鸟在补丁安装前启动会立即返回重启提示）…", "step");
    const st = await ziniaoAgentStatus();
    setAgent(st);
    if (!st.running) return "紫鸟主程序未运行";
    if (!st.port) {
      return (
        st.note ||
        "未发现 agent 服务：若紫鸟已在运行请完全退出后点击「打开紫鸟」重启（6.24.2 新架构自动带 --port 参数）；patch 型需安装补丁（登录后约 30s 自动开启）"
      );
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
      throw new Error(
        st.note ||
          "未发现 agent 服务：若紫鸟已在运行请完全退出后点击「打开紫鸟」重启（6.24.2 新架构自动带 --port 参数）；patch 型需安装补丁 / 登录后自动开启",
      );
    }
    return st.port;
  };

  // ③ 打开店铺（browserId 必须传字符串，后端处理）；确认打开后自动进入店铺
  // （处于紫鸟检测页时自动点击「打开账号」，页面加载中则重试，无需手动进入）
  // 全程分步日志：准备打开 → 正在直开 → 已打开自动进入 → 进入成功/失败
  const stepOpen = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    log(`准备打开 ${shop.browserName} (browserId=${shop.browserId})…`, "step");
    const port = await ensurePort();
    setShop(shop.browserId, "直开中…");
    try {
      log(`正在直开 ${shop.browserName}（请求 agent 服务）…`, "info");
      const openResp = await ziniaoAgentStartBrowser(port, shop.browserId);
      // 诊断：完整响应打日志（确认 CDP 端口是否由响应字段返回，v6.26.6 可能不回 9222 公式）
      log(`startBrowser 响应：${JSON.stringify(openResp).slice(0, 400)}`, "debug");
      setShop(shop.browserId, "已直开（启动中…）");
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const ids = await refreshRunning(port);
        if (ids.includes(shop.browserId)) {
          // 确认打开后再取 CDP 端口：内核已监听，公式或扫描探测才可靠
          // 再等 2s：agent 状态就绪可能早于内核 CDP 监听完成
          await sleep(2000);
          let cdp = 0;
          try {
            // 优先用 startBrowser 官方响应返回的 debuggPort（权威归属，杜绝探测错位到
            // 其他运行中环境——曾发生抓错店铺数据的严重事故）；老版本响应不带该字段时
            // 回退动态探测（find_cdp_port 已加归属校验）
            const dbg = (openResp as any)?.data?.webDriverConfig?.debuggPort as number | undefined;
            cdp = dbg || (await ziniaoAgentCdpPort(shop.browserId));
          } catch (e) {
            log(`获取 ${shop.browserName} CDP 端口失败（跳过自动进入）：${e}`, "warn");
            setShop(shop.browserId, "已打开");
            return `已成功打开 ${shop.browserName} (browserId=${shop.browserId})（第 ${i + 1} 秒确认，CDP 未知）`;
          }
          setShop(shop.browserId, "已打开，自动进入店铺…");
          log(`已打开 ${shop.browserName}（CDP :${cdp}），自动进入店铺…`, "info");
          // 自动进入：前端驱动轮询（每轮输出状态，替代 30s 无反馈黑盒）。
          // 最多 6 轮，每轮约 1-2s + 间隔 2.5s；找不到时后端 note 会列出内核 target 定位
          let enterNote = "";
          let entered = false;
          for (let t = 0; t < 6; t++) {
            let poll;
            try {
              poll = await ziniaoEnterShopPoll(cdp, shop.browserName);
            } catch (e) {
              log(`自动进入 ${shop.browserName} 第 ${t + 1} 次调用失败：${e}`, "warn");
              await sleep(2500);
              continue;
            }
            if (poll.entered) {
              setShop(shop.browserId, "已进入");
              enterNote = `，已自动进入：${poll.note}`;
              log(`已成功进入 ${shop.browserName}：${poll.note}`, "success");
              entered = true;
              break;
            }
            log(`自动进入 ${shop.browserName} 第 ${t + 1} 次（CDP :${cdp}）：${poll.note}`, "info");
            await sleep(2500);
          }
          if (!entered) {
            enterNote = "，自动进入未完成（多次尝试均未进入店铺页，请检查紫鸟检测页是否异常）";
            log(enterNote.trimStart().replace(/^，/, ""), "warn");
          }
          return `已成功打开 ${shop.browserName} (browserId=${shop.browserId})，CDP :${cdp}（第 ${i + 1} 秒确认）${enterNote}`;
        }
      }
      const failMsg = `已请求直开 ${shop.browserName}，60s 内未确认（冷启动含内核下载可能需 1-3 分钟）`;
      log(failMsg, "warn");
      return failMsg;
    } catch (e) {
      setShop(shop.browserId, "直开失败");
      log(`打开 ${shop.browserName} 失败: ${e}`, "error");
      throw e;
    }
  };

  // 关闭店铺：优先 agent_mode 官方 stopBrowser（走紫鸟状态清理），失败回退 CDP Browser.close
  const stepClose = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    log(`准备关闭 ${shop.browserName} (browserId=${shop.browserId})…`, "step");
    const port = await ensurePort();
    setShop(shop.browserId, "关闭中…");
    try {
      try {
        log(`正在关闭 ${shop.browserName}（请求 agent 停止）…`, "info");
        await ziniaoAgentStopBrowser(port, shop.browserId);
      } catch (e) {
        log(`官方 stopBrowser 失败，回退 CDP close: ${e}`, "warn");
        await ziniaoAgentClose(shop.browserId);
      }
      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        const ids = await refreshRunning(port);
        if (!ids.includes(shop.browserId)) {
          setShop(shop.browserId, "已关闭");
          log(`已成功关闭 ${shop.browserName}（第 ${i + 1} 秒确认）`, "success");
          return `已关闭 ${shop.browserName}（第 ${i + 1} 秒确认）`;
        }
      }
      const failMsg = `已发送关闭 ${shop.browserName}，但 20s 内状态仍为运行中`;
      log(failMsg, "warn");
      return failMsg;
    } catch (e) {
      setShop(shop.browserId, "关闭失败");
      log(`关闭 ${shop.browserName} 失败: ${e}`, "error");
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
    log(`准备激活 ${shop.browserName}…`, "step");
    const cdp = await ziniaoAgentCdpPort(shop.browserId);
    await ziniaoActivate(cdp);
    setShop(shop.browserId, "已激活");
    log(`已成功激活 ${shop.browserName} (CDP :${cdp})`, "success");
    return `已进入 ${shop.browserName}（激活 :${cdp}）`;
  };

  // 进入店铺（含「打开账号」）：激活 + 若处于紫鸟账号检测扩展页则点击「打开账号」进入真实页面
  const stepEnterShop = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    log(`准备进入 ${shop.browserName}（检测「打开账号」页）…`, "step");
    const cdp = await ziniaoAgentCdpPort(shop.browserId);
    let msg = "";
    for (let t = 0; t < 4; t++) {
      const poll = await ziniaoEnterShopPoll(cdp, shop.browserName);
      if (poll.entered) {
        msg = poll.note;
        break;
      }
      log(`进入 ${shop.browserName} 第 ${t + 1} 次：${poll.note}`, "info");
      await sleep(2500);
    }
    if (!msg) msg = "多次尝试均未进入店铺页";
    setShop(shop.browserId, "已进入");
    log(`已成功进入 ${shop.browserName}：${msg}`, "success");
    return `已进入 ${shop.browserName} :${cdp} → ${msg}`;
  };

  // 统一 log 包装：label + fn()，busy 包裹。
  // quiet=true 时不再输出汇总行（调用方已自行分级输出明细/汇总）。
  const run = async (label: string, fn: () => Promise<string>, quiet = false) => {
    setBusy(true);
    try {
      const msg = await fn();
      if (!quiet) log(`${label} → ${msg}`);
    } catch (e) {
      log(`${label} 失败: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // 并发版：不设置全局 busy，多个操作可并行执行（乐观更新）。
  // 用于达人寄样页左侧单店铺操作（打开/关闭/进入），批量/串行场景仍用 run。
  const runAsync = async (label: string, fn: () => Promise<string>) => {
    try {
      log(`${label} → ${await fn()}`);
    } catch (e) {
      log(`${label} 失败: ${e}`, "error");
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
        log("② 获取店铺列表 → 未发现 agent 服务：若紫鸟已在运行请完全退出后点击「打开紫鸟」重启（6.24.2 新架构自动带 --port 参数）；patch 型需安装补丁（登录后约 30s 自动开启）", "error");
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
    runAsync,
    acceptAll,
  };
}

export type UseZiniaoAgentReturn = ReturnType<typeof useZiniaoAgent>;
export type { Dispatch, SetStateAction };
