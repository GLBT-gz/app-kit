import { useCallback, useState } from "react";
import {
  ziniaoAgentLaunch,
  ziniaoAgentStatus,
  ziniaoAgentBrowserList,
  ziniaoAgentStartBrowser,
  ziniaoAgentCdpPort,
  ziniaoAgentRunning,
  ziniaoAgentClose,
  ziniaoEval,
  ziniaoScreenshot,
  ziniaoPatchStatus,
  ziniaoPatchApply,
  isTauriRuntime,
} from "../../api";
import type { ZiniaoAgentBrowser, ZiniaoAgentStatus } from "../../api";
import { useLog, LogPanel } from "../LogPanel";
import { ZiniaoStoreList } from "./ZiniaoStoreList";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 紫鸟补丁状态（对应 tauri ziniao_patch_status） */
export interface ZiniaoPatchInfo {
  installed: boolean;
  asar_path: string;
  patched: boolean;
  v109: boolean;
  main_index_len: number;
  detail: string;
}

/**
 * 紫鸟测试页（公共组件）
 *
 * 参考 Temu 运营工具测试页：左侧功能模块，右侧运行日志。
 * 覆盖：补丁检查/安装、自动打开紫鸟、店铺解析、打开/关闭店铺、CDP 控制、一键验收。
 */
export function ZiniaoTestPanel() {
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<ZiniaoAgentStatus | null>(null);
  const [shops, setShops] = useState<ZiniaoAgentBrowser[]>([]);
  const [patch, setPatch] = useState<ZiniaoPatchInfo | null>(null);
  const [patchNote, setPatchNote] = useState("");
  const [selectedShopId, setSelectedShopId] = useState<number | null>(null);
  const [shots, setShots] = useState<Record<string, string>>({});
  const [shopState, setShopState] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<Set<number>>(new Set());
  const [logWidth, setLogWidth] = useState(360);

  const logCtx = useLog({ eventName: null, storageKey: "ziniao:test-log" });
  const { log } = logCtx;

  const setShop = (id: number, st: string) =>
    setShopState((prev) => ({ ...prev, [String(id)]: st }));

  const refreshRunning = async (port: number) => {
    const ids = await ziniaoAgentRunning(port);
    setRunning(new Set(ids));
    return ids;
  };

  // ① 打开紫鸟
  const stepLaunch = async (): Promise<string> => {
    const r = await ziniaoAgentLaunch();
    return r.launched ? `已启动紫鸟主程序 (PID ${r.pid})` : `紫鸟已在运行 (PID ${r.pid})`;
  };

  // ② 店铺列表
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
    if (list.length > 0 && selectedShopId === null) setSelectedShopId(list[0].browserId);
    return `agent_mode 端口 :${st.port}，共 ${list.length} 个店铺，${ids.length} 个已打开`;
  };

  // ③ 打开店铺
  const stepOpen = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    const port = agent?.port;
    if (!port) throw new Error("请先执行「店铺列表」");
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

  // 关闭店铺
  const stepClose = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    const port = agent?.port;
    if (!port) throw new Error("请先执行「店铺列表」");
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

  // ④ CDP 验证
  const stepCdp = async (shop: ZiniaoAgentBrowser): Promise<string> => {
    const cdp = await ziniaoAgentCdpPort(shop.browserId);
    setShop(shop.browserId, "CDP 连接中…");
    let info = "";
    for (let i = 0; i < 60; i++) {
      try {
        const v = await ziniaoEval(cdp, `JSON.stringify({ title: document.title, url: location.href })`);
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

  // 补丁状态检查
  const stepPatchStatus = async (): Promise<string> => {
    const st = await ziniaoPatchStatus();
    setPatch(st);
    if (!st.installed) return `未安装紫鸟（未找到 app.asar）`;
    if (st.v109) return `已安装 v10.9 补丁（含 agent_mode 自动开启）`;
    if (st.patched) return `已安装 v10.8 补丁（端口兜底），但缺 agent_mode 自动开启，可一键升级`;
    return `未打补丁：多环境 CDP 端口冲突，且 agent_mode 不会自动开启`;
  };

  // 一键安装补丁（弹 UAC）
  const stepPatchApply = async (): Promise<string> => {
    const msg = await ziniaoPatchApply();
    setPatchNote(msg);
    return msg;
  };

  // 一键验收：补丁检查 → ①→②→③（第一个未打开）→④
  const acceptAll = async () => {
    setBusy(true);
    try {
      log(`0. 检查补丁 → ${await stepPatchStatus()}`);
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
      setSelectedShopId(first.browserId);
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

  // 选中店铺对象
  const selectedShop = shops.find((s) => s.browserId === selectedShopId) ?? null;

  // 日志宽度拖拽
  const handleSplitterDown = useCallback(() => {
    const onMove = (ev: MouseEvent) => {
      const rect = document.querySelector(".zn-test")?.getBoundingClientRect();
      if (!rect) return;
      const w = rect.right - ev.clientX;
      setLogWidth(Math.min(Math.max(w, 240), 600));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const shopSelect = (
    <select
      className="zn-input"
      value={selectedShopId ?? ""}
      onChange={(e) => setSelectedShopId(e.target.value ? Number(e.target.value) : null)}
      style={{ maxWidth: 320 }}
    >
      {shops.length === 0 && <option value="">暂未加载到店铺</option>}
      {shops.map((s) => (
        <option key={s.browserId} value={s.browserId}>
          {s.browserName}（{s.platform_name} · {s.browserId}）
        </option>
      ))}
    </select>
  );

  return (
    <div className="zn-test">
      {/* 左侧：功能模块 */}
      <div className="zn-test-left">
        <div className="zn-test-module">
          <div className="zn-test-module-head">一键验收</div>
          <div className="zn-hint">补丁检查 → 打开紫鸟 → 店铺列表 → 打开首个未打开店铺 → CDP 验证（含截图）</div>
          <div>
            <button className="zn-btn primary" disabled={busy} onClick={acceptAll}>
              {busy ? "验收中…" : "▶ 一键验收"}
            </button>
          </div>
        </div>

        <div className="zn-test-module">
          <div className="zn-test-module-head">0. 紫鸟补丁（自动化集成配置）</div>
          <div className="zn-shop-ops">
            <button className="zn-btn" disabled={busy} onClick={() => run("检查补丁", stepPatchStatus)}>
              检查补丁状态
            </button>
            <button className="zn-btn" disabled={busy || patch?.v109} onClick={() => run("安装补丁", stepPatchApply)}>
              {patch?.v109 ? "已是最新" : "一键安装 v10.9"}
            </button>
            {patch && (
              <span className={`zn-badge ${patch.v109 ? "ok" : patch.patched ? "warn" : "err"}`}>
                {patch.v109 ? "v10.9" : patch.patched ? "v10.8" : "未打补丁"}
              </span>
            )}
          </div>
          {patch && <div className="zn-hint">detail: {patch.detail}</div>}
          {patchNote && <div className="zn-hint">提示: {patchNote}</div>}
        </div>

        <div className="zn-test-module">
          <div className="zn-test-module-head">① 自动打开紫鸟（启动后请手动登录）</div>
          <div className="zn-shop-ops">
            <button className="zn-btn" disabled={busy} onClick={() => run("打开紫鸟", stepLaunch)}>
              打开紫鸟
            </button>
            {agent?.running ? (
              <span className="zn-badge ok">agent_mode :{agent.port ?? "?"}</span>
            ) : (
              <span className="zn-badge warn">未检测到运行中</span>
            )}
          </div>
        </div>

        <div className="zn-test-module">
          <div className="zn-test-module-head">② 店铺列表（解析已有店铺）</div>
          <div className="zn-shop-ops">
            <button className="zn-btn" disabled={busy} onClick={() => run("获取店铺列表", stepList)}>
              获取店铺列表
            </button>
            <button
              className="zn-btn"
              disabled={busy || !agent?.port}
              onClick={() =>
                run("刷新运行状态", async () => {
                  if (!agent?.port) throw new Error("请先执行「店铺列表」");
                  const ids = await refreshRunning(agent.port);
                  return `${ids.length} 个环境已打开`;
                })
              }
            >
              刷新状态
            </button>
            <span className="zn-sub">
              {shops.length} 个店铺 / 运行 {running.size}
            </span>
          </div>
        </div>

        <div className="zn-test-module">
          <div className="zn-test-module-head">③ 打开 / 关闭店铺</div>
          <div className="zn-shop-ops">{shopSelect}</div>
          <div className="zn-shop-ops">
            <button
              className="zn-btn"
              disabled={busy || !selectedShop}
              onClick={() => selectedShop && run(`打开 ${selectedShop.browserName}`, () => stepOpen(selectedShop))}
            >
              打开选中店铺
            </button>
            <button
              className="zn-btn danger"
              disabled={busy || !selectedShop}
              onClick={() => selectedShop && run(`关闭 ${selectedShop.browserName}`, () => stepClose(selectedShop))}
            >
              关闭选中店铺
            </button>
          </div>
        </div>

        <div className="zn-test-module">
          <div className="zn-test-module-head">④ CDP 控制（eval + 截图）</div>
          <div className="zn-shop-ops">{shopSelect}</div>
          <div className="zn-shop-ops">
            <button
              className="zn-btn"
              disabled={busy || !selectedShop}
              onClick={() => selectedShop && run(`CDP ${selectedShop.browserName}`, () => stepCdp(selectedShop))}
            >
              CDP 验证 + 截图
            </button>
          </div>
        </div>

        {shops.length > 0 && (
          <div className="zn-test-module">
            <div className="zn-test-module-head">店铺明细</div>
            <ZiniaoStoreList
              shops={shops}
              running={running}
              busy={busy}
              shots={shots}
              shopState={shopState}
              onOpen={(s) => run(`打开 ${s.browserName}`, () => stepOpen(s))}
              onClose={(s) => run(`关闭 ${s.browserName}`, () => stepClose(s))}
              onCdp={(s) => run(`CDP ${s.browserName}`, () => stepCdp(s))}
            />
          </div>
        )}

        {!isTauriRuntime() && (
          <div className="zn-error">当前处于浏览器预览模式（无 Tauri 运行时），无法调用紫鸟命令。请通过桌面应用运行。</div>
        )}
      </div>

      {/* 拖拽分隔条 */}
      <div className="zn-test-splitter" onMouseDown={handleSplitterDown} title="拖拽调整日志宽度" />

      {/* 右侧：日志 */}
      <div className="zn-test-log" style={{ width: logWidth }}>
        <LogPanel log={logCtx} title="运行日志" emptyText="选择模块后点击「运行」查看输出" />
      </div>
    </div>
  );
}
