import { useEffect, useState } from "react";
import {
  ziniaoPatchStatus,
  ziniaoPatchApply,
  ziniaoAgentProcStatus,
  ziniaoAgentStop,
  ziniaoAgentCdpPort,
  ziniaoEval,
  ziniaoNavigate,
  ziniaoScreenshot,
} from "../../ziniao-api";
import { ziniaoParseSidebar, ziniaoSwitchMenu } from "../../ziniao-api";
import type { ZiniaoSidebarItem, ZiniaoSidebarParse } from "../../ziniao-api";
import { safeGetJSON, safeSetJSON } from "../../localStorageKeys";
import { isTauriRuntime } from "../../tauri-utils";
import { useLog } from "../LogPanel";
import { TestSection, TestPageLayout } from "../TestLayout";
import { useZiniaoAgent } from "../../hooks/useZiniaoAgent";
import { ZiniaoStoreList } from "./ZiniaoStoreList";

/** 紫鸟补丁状态（对应 tauri ziniao_patch_status） */
export interface ZiniaoPatchInfo {
  installed: boolean;
  asar_path: string;
  patched: boolean;
  v109: boolean;
  /** v109 注入为旧版（启动后 33s 窗口，错过即永久失效），需重装为常驻版 */
  v109_stale: boolean;
  version: string;
  /** 架构类型：patch（v6.25.16 系需补丁）/ native（6.24.2 系原生支持） */
  arch: string;
  main_index_len: number;
  detail: string;
}

/** TK01 固定测试环境（省去每次解析店铺）：
 * browserId=27520698532963，CDP 端口 = 9222 + browserId % 5000 = 12185 */
const TK01_BROWSER_ID = 27520698532963;
const TK01_CDP_PORT = 12185;

/** TikTok Shop 侧边栏菜单项行（含「切换」按钮） */
function TtsItemRow({
  item,
  disabled,
  onSwitch,
}: {
  item: ZiniaoSidebarItem;
  disabled: boolean;
  onSwitch: (item: ZiniaoSidebarItem) => void;
}) {
  return (
    <div className={`tts-item${item.selected ? " selected" : ""}`}>
      <span className="tts-item-name" title={item.name}>{item.name}</span>
      <span className="tts-item-href" title={item.href}>{item.href}</span>
      {item.selected && <span className="zn-badge ok">当前</span>}
      <button className="tts-switch-btn" disabled={disabled} onClick={() => onSwitch(item)}>
        切换
      </button>
    </div>
  );
}

/** 补丁状态 → 用户可读文案（检查/一键检测共用） */
function patchStatusText(st: ZiniaoPatchInfo): string {
  if (!st.installed) return "未安装紫鸟（未找到 app.asar）";
  if (st.arch === "native") return "新架构（6.24.2+）原生支持，无需补丁";
  if (st.v109 && st.v109_stale)
    return "补丁为旧版（启动后 33 秒内未登录即永久失效），点「一键检测」自动重装";
  if (st.v109) return "补丁已安装（agent_mode 自动开启）";
  if (st.patched) return "部分补丁（缺 agent_mode 自动开启），可一键升级";
  // 未打补丁：透出后端 detail（区分 6.25.16 端口公式缺失 / 6.26.6 web_driver 需凭证）
  return st.detail;
}

/**
 * 紫鸟测试页（公共组件）
 *
 * 布局参考 007 库存周转测试页：左侧测试模块（TestSection 卡片，序号从 1 开始），右侧可拖拽日志栏。
 * 覆盖：补丁检查/安装、自动打开紫鸟、店铺解析、打开/关闭店铺、CDP 控制。
 * 核心步骤逻辑由公共 hook useZiniaoAgent 提供，本组件只负责布局与补丁模块。
 */
export function ZiniaoTestPanel() {
  const [patch, setPatch] = useState<ZiniaoPatchInfo | null>(null);
  const [patchNote, setPatchNote] = useState("");
  const [selectedShopId, setSelectedShopId] = useState<number | null>(null);
  const [logWidth, setLogWidth] = useState(360);
  const [ttsMenu, setTtsMenu] = useState<ZiniaoSidebarParse | null>(null);
  const [ttsMenuShopId, setTtsMenuShopId] = useState<number | null>(null);
  const [js, setJs] = useState(`JSON.stringify({ title: document.title, url: location.href })`);
  const [navUrl, setNavUrl] = useState("");
  // ── 测试 8：TK01 固定环境（端口 12185，省去每次解析店铺） ──
  const [tkDetected, setTkDetected] = useState<string | null>(null);
  const [tkMenu, setTkMenu] = useState<ZiniaoSidebarParse | null>(null);

  const logCtx = useLog({ eventName: null, storageKey: "ziniao:test-log" });
  const { log } = logCtx;

  const {
    busy,
    agent,
    shops,
    shots,
    shopState,
    running,
    setShots,
    refreshRunning,
    stepLaunch,
    stepList,
    stepOpen,
    stepClose,
    stepEnterShop,
    stepCdp,
    run,
    setAgent,
  } = useZiniaoAgent(log);

  // 挂载时轻量刷新状态卡（进程/补丁 O(1)；不探测 agent 端口，避免最长 40s 等待）
  useEffect(() => {
    ziniaoPatchStatus().then(setPatch).catch(() => {});
    ziniaoAgentProcStatus().then(setAgent).catch(() => {});
  }, []);

  // 补丁状态检查
  const stepPatchStatus = async (): Promise<string> => {
    const st = await ziniaoPatchStatus();
    setPatch(st);
    return patchStatusText(st);
  };

  // 一键安装补丁（弹 UAC）
  const stepPatchApply = async (): Promise<string> => {
    const msg = await ziniaoPatchApply();
    setPatchNote(msg);
    return msg;
  };

  // 一键检测（全自动）：补丁 → 自动停/装/重启紫鸟 → agent → 店铺列表
  // 用户只需点一次：补丁缺失/旧版自动重装并重启紫鸟，无需手动操作
  const stepOneClickTest = async (): Promise<string> => {
    // ① 补丁检查：patch 型未打或旧版注入 → 自动「停紫鸟 → 装补丁 → 重启紫鸟」
    const st = await ziniaoPatchStatus();
    setPatch(st);
    log(`① 检查补丁 → ${patchStatusText(st)}`, "info");
    if (st.installed && st.arch === "patch" && (!st.v109 || st.v109_stale)) {
      log("  补丁需要处理：自动停止紫鸟 → 安装补丁 → 自动重启（已打开的店铺环境会关闭）…", "warn");
      const killed = await ziniaoAgentStop();
      log(`  已停止紫鸟进程 ${killed} 个`, "info");
      const msg = await ziniaoPatchApply();
      setPatchNote(msg);
      setPatch(await ziniaoPatchStatus());
      log(`  补丁安装 → ${msg}`, msg.includes("失败") ? "error" : "success");
      log(`  自动重启紫鸟 → ${await stepLaunch()}`, "info");
    } else {
      // ② 补丁无问题：确保紫鸟运行
      log(`② 打开紫鸟 → ${await stepLaunch()}`, "info");
    }
    // ③ 探测 agent（10 秒内出结果）+ 店铺列表
    const listMsg = await stepList();
    const failed = !listMsg.startsWith("agent_mode");
    log(`③ 获取店铺列表 → ${listMsg}`, failed ? "error" : "success");
    if (failed) return listMsg;
    return `检测通过：紫鸟可启动、可控制 → ${listMsg}`;
  };

  // 对选中店铺执行 JS
  const runJs = async (): Promise<string> => {
    if (!selectedShop) throw new Error("请先在店铺下拉中选择一个店铺");
    const cdp = await ziniaoAgentCdpPort(selectedShop.browserId);
    const v = await ziniaoEval(cdp, js);
    return `eval ${selectedShop.browserName} :${cdp} → ${JSON.stringify(v)}`;
  };

  // 对选中店铺导航到 URL
  const runNav = async (): Promise<string> => {
    if (!selectedShop) throw new Error("请先在店铺下拉中选择一个店铺");
    if (!navUrl) throw new Error("请输入目标 URL");
    const cdp = await ziniaoAgentCdpPort(selectedShop.browserId);
    await ziniaoNavigate(cdp, navUrl);
    return `导航 ${selectedShop.browserName} :${cdp} → ${navUrl}`;
  };

  // 对选中店铺独立截图（不经过 CDP 验证流程）
  const shotOnly = async (): Promise<string> => {
    if (!selectedShop) throw new Error("请先在店铺下拉中选择一个店铺");
    const cdp = await ziniaoAgentCdpPort(selectedShop.browserId);
    const b64 = await ziniaoScreenshot(cdp);
    setShots((prev) => ({ ...prev, [String(selectedShop.browserId)]: b64 }));
    return `截图 ${selectedShop.browserName} :${cdp} → ${Math.round((b64.length * 3) / 4)}B`;
  };

  // ── TikTok Shop 侧边栏：切换店铺时自动加载该店铺的菜单缓存 ──
  useEffect(() => {
    if (selectedShopId === null) return;
    const cached = safeGetJSON<ZiniaoSidebarParse>(`tts-menu-${selectedShopId}`);
    if (cached && cached.ok) {
      setTtsMenu(cached);
      setTtsMenuShopId(selectedShopId);
    } else {
      setTtsMenu(null);
      setTtsMenuShopId(null);
    }
  }, [selectedShopId]);

  // 解析左侧菜单 → 展示 + 缓存（localStorage tts-menu-{browserId}）
  const parseTtsMenu = async (): Promise<string> => {
    if (!selectedShop) throw new Error("请先在店铺下拉中选择一个店铺");
    const cdp = await ziniaoAgentCdpPort(selectedShop.browserId);
    const menu = await ziniaoParseSidebar(cdp);
    if (!menu.ok) {
      const msg = `解析失败: ${menu.error ?? "未知错误"} · ${menu.note}`;
      log(`解析TikTok菜单 → ${msg}`, "error");
      return "";
    }
    setTtsMenu(menu);
    setTtsMenuShopId(selectedShop.browserId);
    safeSetJSON(`tts-menu-${selectedShop.browserId}`, menu);
    const total = menu.links.length + menu.groups.reduce((n, g) => n + g.items.length, 0);
    const msg = `解析成功：${menu.groups.length} 个分组 / ${total} 个菜单项 · ${menu.note}，已缓存`;
    log(`解析TikTok菜单 → ${msg}`, "success");
    return "";
  };

  // 切换到指定菜单项（定位→展开父分组→物理点击→URL 轮询验证均由后端完成），成功/失败分级着色
  const switchTtsItem = (item: ZiniaoSidebarItem) =>
    run(`切换 ${item.name}`, async () => {
      if (!selectedShop) throw new Error("请先选择店铺");
      const cdp = await ziniaoAgentCdpPort(selectedShop.browserId);
      const res = await ziniaoSwitchMenu(cdp, item.href || item.name);
      const msg = res.note + (res.matched_by ? `（匹配:${res.matched_by}）` : "");
      log(`切换 ${item.name} → ${msg}`, res.note.startsWith("切换成功") ? "success" : "error");
      return "";
    }, true);

  // 菜单结构诊断：输出后端双策略解析（精准优先 + 语义兜底）的解析方式/失败原因
  const exportTtsMenuHtml = () =>
    run("菜单结构诊断", async () => {
      if (!selectedShop) throw new Error("请先选择店铺");
      const cdp = await ziniaoAgentCdpPort(selectedShop.browserId);
      const menu = await ziniaoParseSidebar(cdp);
      if (!menu.ok) {
        const msg = `解析失败: ${menu.error ?? "未知错误"} · ${menu.note}`;
        log(`菜单结构诊断 → ${msg}`, "error");
        return "";
      }
      const msg = `${menu.note}（${menu.groups.length} 组 / ${menu.items.length} 项，当前页 ${menu.path}）`;
      log(`菜单结构诊断 → ${msg}`, "info");
      return "";
    });

  // 依次切换全部菜单项，统计成功/失败
  const testAllTtsRoutes = () =>
    run("全部路由切换测试", async () => {
      if (!selectedShop || !ttsMenu) throw new Error("请先解析侧边栏菜单");
      const cdp = await ziniaoAgentCdpPort(selectedShop.browserId);
      const targets: ZiniaoSidebarItem[] = [
        ...ttsMenu.links,
        ...ttsMenu.groups.flatMap((g) => g.items),
      ];
      if (targets.length === 0) return "菜单为空，无可切换项";
      let ok = 0;
      const fails: string[] = [];
      for (const item of targets) {
        const res = await ziniaoSwitchMenu(cdp, item.href || item.name);
        if (res.note.startsWith("切换成功")) {
          ok++;
          log(`  ✓ ${res.note}`, "success");
        } else {
          fails.push(`${item.name}: ${res.note}`);
          log(`  ✗ ${res.note}`, "error");
        }
      }
      const summary = `成功 ${ok}/${targets.length}${fails.length ? `，失败：${fails.join("；")}` : ""}`;
      if (fails.length) log(`全部路由切换测试 → ${summary}`, "error");
      else log(`全部路由切换测试 → ${summary}`, "success");
      return "";
    }, true);

  // ── 测试 8：TK01 固定环境（端口 12185）实时检测 / 菜单切换 / 全路由巡航 ──
  // 固定端口直连，不依赖「店铺列表」解析（省去每次解析店铺/解析失败）

  // 实时检测：读取当前 URL/标题/是否卖家中心
  const tkDetect = () =>
    run("实时检测 TK01", async () => {
      const v = (await ziniaoEval(
        TK01_CDP_PORT,
        `JSON.stringify({ url: location.href, title: document.title, onSeller: !!document.querySelector('.sidebar-root') })`,
      )) as string;
      const d = JSON.parse(v) as { url: string; title: string; onSeller: boolean };
      setTkDetected(d.url);
      return `TK01 :${TK01_CDP_PORT} → ${d.onSeller ? "卖家中心" : "非卖家页"} · ${d.title} · ${d.url}`;
    }, true);

  // 解析左侧菜单（固定端口）
  const tkParseMenu = () =>
    run("解析 TK01 左侧菜单", async () => {
      const menu = await ziniaoParseSidebar(TK01_CDP_PORT);
      setTkMenu(menu);
      if (!menu.ok) throw new Error(menu.note);
      return menu.note;
    }, true);

  // 切换菜单项：href 优先，not-found 时用 name 重试（div 模式页候选无 href）
  const tkSwitchItem = (item: ZiniaoSidebarItem) =>
    run(`TK01 切换 ${item.name}`, async () => {
      let res = await ziniaoSwitchMenu(TK01_CDP_PORT, item.href || item.name);
      if (!res.matched && item.href) {
        const retry = await ziniaoSwitchMenu(TK01_CDP_PORT, item.name);
        if (retry.matched) res = retry;
      }
      const msg = res.note + (res.matched_by ? `（匹配:${res.matched_by}）` : "");
      const good = res.note.startsWith("切换成功") || res.note.startsWith("已在目标页");
      log(`TK01 切换 ${item.name} → ${msg}`, good ? "success" : "error");
      // 切换后刷新菜单，更新「当前」徽标
      const menu = await ziniaoParseSidebar(TK01_CDP_PORT);
      if (menu.ok) setTkMenu(menu);
      return "";
    }, true);

  // 全部路由切换测试（巡航 34 项菜单）
  const tkCruise = () =>
    run("TK01 全部路由切换测试", async () => {
      if (!tkMenu) throw new Error("请先解析 TK01 左侧菜单");
      const targets: ZiniaoSidebarItem[] = [...tkMenu.links, ...tkMenu.groups.flatMap((g) => g.items)];
      if (targets.length === 0) return "菜单为空，无可切换项";
      let ok = 0;
      const fails: string[] = [];
      for (const item of targets) {
        let res = await ziniaoSwitchMenu(TK01_CDP_PORT, item.href || item.name);
        if (!res.matched && item.href) {
          const retry = await ziniaoSwitchMenu(TK01_CDP_PORT, item.name);
          if (retry.matched) res = retry;
        }
        const good = res.note.startsWith("切换成功") || res.note.startsWith("已在目标页");
        if (good) {
          ok++;
          log(`  ✓ ${item.name} → ${res.note}`, "success");
        } else {
          fails.push(`${item.name}: ${res.note}`);
          log(`  ✗ ${item.name} → ${res.note}`, "error");
        }
      }
      const summary = `成功 ${ok}/${targets.length}${fails.length ? `，失败：${fails.join("；")}` : ""}`;
      if (fails.length) log(`TK01 全部路由切换测试 → ${summary}`, "error");
      else log(`TK01 全部路由切换测试 → ${summary}`, "success");
      return "";
    }, true);

  // TK01 截图
  const tkShot = async (): Promise<string> => {
    const b64 = await ziniaoScreenshot(TK01_CDP_PORT);
    setShots((prev) => ({ ...prev, [String(TK01_BROWSER_ID)]: b64 }));
    return `TK01 截图 :${TK01_CDP_PORT} → ${Math.round((b64.length * 3) / 4)}B`;
  };

  // 选中店铺对象
  const selectedShop = shops.find((s) => s.browserId === selectedShopId) ?? null;

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
    <TestPageLayout
      log={logCtx}
      logWidth={logWidth}
      onLogWidthChange={setLogWidth}
      minWidth={240}
      emptyText="选择模块后点击「运行」查看输出"
    >
      <div className="test-modules">
        <div className="test-panel-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
          <span>紫鸟功能测试</span>
        </div>

        <TestSection title="紫鸟状态（一键检测）">
          <div className="zn-shop-ops">
            <button className="zn-btn" disabled={busy} onClick={() => run("一键检测", stepOneClickTest)}>
              一键检测
            </button>
            <span className="zn-sub">自动检查补丁 → 启动紫鸟 → 探测 agent → 拉取店铺列表，一步完成</span>
          </div>
          <div className="zn-shop-ops">
            <span className={`zn-badge ${agent?.running ? "ok" : "warn"}`}>
              {agent?.running ? `紫鸟运行中${agent?.pid ? ` (PID ${agent.pid})` : ""}` : "紫鸟未运行"}
            </span>
            <span className={`zn-badge ${agent?.port ? "ok" : "warn"}`}>
              {agent?.port ? `agent :${agent.port}` : "agent 未就绪"}
            </span>
            <span
              className={`zn-badge ${
                !patch
                  ? ""
                  : patch.arch === "native"
                    ? "ok"
                    : patch.v109 && patch.v109_stale
                      ? "warn"
                      : patch.v109
                        ? "ok"
                        : patch.patched
                          ? "warn"
                          : "err"
              }`}
            >
              {!patch
                ? "补丁未知（点一键检测或检查补丁）"
                : patch.arch === "native"
                  ? "原生支持，无需补丁"
                  : patch.v109 && patch.v109_stale
                    ? "补丁旧版"
                    : patch.v109
                      ? "补丁已装"
                      : patch.patched
                        ? "部分补丁"
                        : "未打补丁"}
            </span>
            <span className="zn-sub">{shops.length} 个店铺</span>
          </div>
        </TestSection>

        <TestSection title="1. 紫鸟补丁（自动化集成配置）">
          <div className="zn-shop-ops">
            <button className="zn-btn" disabled={busy} onClick={() => run("检查补丁", stepPatchStatus)}>
              检查补丁状态
            </button>
            <button
              className="zn-btn"
              disabled={busy || (patch?.v109 && !patch?.v109_stale)}
              onClick={() => run("安装补丁", stepPatchApply)}
            >
              {patch?.v109 && !patch?.v109_stale
                ? "已是最新"
                : patch?.v109
                  ? "一键升级（旧版注入）"
                  : "一键安装补丁"}
            </button>
            {patch && (
              <span
                className={`zn-badge ${
                  patch.v109 && !patch.v109_stale ? "ok" : patch.v109 || patch.patched ? "warn" : "err"
                }`}
              >
                {patch.v109 && !patch.v109_stale
                  ? "已打补丁"
                  : patch.v109
                    ? "旧版补丁"
                    : patch.patched
                      ? "部分补丁"
                      : "未打补丁"}
              </span>
            )}
          </div>
          {patch && <div className="zn-hint">detail: {patch.detail}</div>}
          {patchNote && <div className="zn-hint">提示: {patchNote}</div>}
        </TestSection>

        <TestSection title="2. 自动打开紫鸟（启动后请手动登录）">
          <div className="zn-shop-ops">
            <button className="zn-btn" disabled={busy} onClick={() => run("打开紫鸟", stepLaunch)}>
              打开紫鸟
            </button>
            {agent?.running ? (
              agent?.port ? (
                <span className="zn-badge ok">agent_mode :{agent.port}</span>
              ) : (
                <span className="zn-badge warn">紫鸟已运行（agent_mode 未就绪，点「店铺列表」探测）</span>
              )
            ) : (
              <span className="zn-badge warn">未检测到运行中</span>
            )}
          </div>
        </TestSection>

        <TestSection title="3. 店铺列表（解析已有店铺）">
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
        </TestSection>

        <TestSection title="4. 打开 / 关闭 / 进入店铺">
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
              className="zn-btn"
              disabled={busy || !selectedShop}
              title="激活页面；若处于紫鸟账号检测扩展页则点击「打开账号」进入店铺"
              onClick={() => selectedShop && run(`进入 ${selectedShop.browserName}`, () => stepEnterShop(selectedShop))}
            >
              进入选中店铺
            </button>
            <button
              className="zn-btn danger"
              disabled={busy || !selectedShop}
              onClick={() => selectedShop && run(`关闭 ${selectedShop.browserName}`, () => stepClose(selectedShop))}
            >
              关闭选中店铺
            </button>
          </div>
        </TestSection>

        <TestSection title="5. CDP 控制（验证 / JS / 导航 / 截图）">
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
          <div className="zn-shop-ops">
            <span className="zn-sub">执行 JS：</span>
            <textarea
              className="zn-input zn-js"
              value={js}
              rows={2}
              style={{ flex: 1, resize: "vertical" }}
              onChange={(e) => setJs(e.target.value)}
            />
            <button className="zn-btn" disabled={busy || !selectedShop} onClick={() => run("执行 JS", runJs)}>
              执行
            </button>
          </div>
          <div className="zn-shop-ops">
            <span className="zn-sub">导航到：</span>
            <input
              className="zn-input"
              value={navUrl}
              placeholder="https://…"
              style={{ flex: 1 }}
              onChange={(e) => setNavUrl(e.target.value)}
            />
            <button className="zn-btn" disabled={busy || !selectedShop} onClick={() => run("导航", runNav)}>
              导航
            </button>
            <button className="zn-btn" disabled={busy || !selectedShop} onClick={() => run("截图", shotOnly)}>
              截图
            </button>
          </div>
        </TestSection>

        {shops.length > 0 && (
          <TestSection title="6. 店铺明细">
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
          </TestSection>
        )}

        <TestSection title="7. TikTok Shop 侧边栏（解析/缓存/路由切换）">
          <div className="zn-shop-ops">{shopSelect}</div>
          <div className="zn-shop-ops">
            <button
              className="zn-btn"
              disabled={busy || !selectedShop}
              onClick={() => run("解析TikTok菜单", parseTtsMenu, true)}
            >
              解析左侧菜单
            </button>
            <button
              className="zn-btn"
              disabled={busy || !selectedShop || !ttsMenu}
              onClick={testAllTtsRoutes}
            >
              全部路由切换测试
            </button>
            <button
              className="zn-btn"
              disabled={busy || !selectedShop}
              onClick={exportTtsMenuHtml}
              title="先手动展开 1-2 个分组再点，导出侧边栏完整 HTML 到日志"
            >
              导出菜单 HTML
            </button>
            {ttsMenu && (
              <span className="zn-sub">
                {ttsMenuShopId === selectedShopId ? "（当前店铺解析）" : "（缓存）"} ·
                {ttsMenu.groups.length} 组 /{" "}
                {ttsMenu.links.length + ttsMenu.groups.reduce((n, g) => n + g.items.length, 0)} 项
                {ttsMenu.path ? ` · ${ttsMenu.path}` : ""}
              </span>
            )}
          </div>
          {ttsMenu && (
            <div className="tts-menu">
              {ttsMenu.links.map((it) => (
                <TtsItemRow key={it.href} item={it} disabled={busy || !selectedShop} onSwitch={switchTtsItem} />
              ))}
              {ttsMenu.groups.map((g) => (
                <div className="tts-group" key={g.name}>
                  <div className="tts-group-header">
                    <span className="tts-group-name">{g.name}</span>
                    {g.expanded && <span className="zn-badge ok">已展开</span>}
                    <span className="tts-group-count">{g.items.length} 项</span>
                  </div>
                  {g.items.map((it) => (
                    <TtsItemRow key={it.href} item={it} disabled={busy || !selectedShop} onSwitch={switchTtsItem} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </TestSection>

        <TestSection title="8. TK01 实时检测（固定端口 12185，无需解析店铺）">
          <div className="zn-shop-ops">
            <span className="zn-badge ok">TK01</span>
            <span className="zn-badge">browserId {TK01_BROWSER_ID}</span>
            <span className={`zn-badge ${tkDetected ? "ok" : "warn"}`}>CDP :{TK01_CDP_PORT}</span>
            <button className="zn-btn" disabled={busy} onClick={tkDetect}>
              实时检测
            </button>
            <button className="zn-btn" disabled={busy} onClick={tkParseMenu}>
              解析左侧菜单
            </button>
            <button className="zn-btn" disabled={busy || !tkMenu} onClick={tkCruise}>
              全部路由切换测试
            </button>
            <button className="zn-btn" disabled={busy} onClick={() => run("TK01 截图", tkShot)}>
              截图
            </button>
            {tkDetected && <span className="zn-sub mono">{tkDetected}</span>}
          </div>
          {tkMenu && (
            <div className="zn-shop-ops">
              <span className="zn-sub">
                {tkMenu.groups.length} 组 /{" "}
                {tkMenu.links.length + tkMenu.groups.reduce((n, g) => n + g.items.length, 0)} 项
                {tkMenu.path ? ` · ${tkMenu.path}` : ""} · {tkMenu.note}
              </span>
            </div>
          )}
          {tkMenu && (
            <div className="tts-menu">
              {tkMenu.links.map((it) => (
                <TtsItemRow key={it.href} item={it} disabled={busy} onSwitch={tkSwitchItem} />
              ))}
              {tkMenu.groups.map((g) => (
                <div className="tts-group" key={g.name}>
                  <div className="tts-group-header">
                    <span className="tts-group-name">{g.name}</span>
                    {g.expanded && <span className="zn-badge ok">已展开</span>}
                    <span className="tts-group-count">{g.items.length} 项</span>
                  </div>
                  {g.items.map((it) => (
                    <TtsItemRow key={it.href} item={it} disabled={busy} onSwitch={tkSwitchItem} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </TestSection>

        {!isTauriRuntime() && (
          <div className="zn-error">当前处于浏览器预览模式（无 Tauri 运行时），无法调用紫鸟命令。请通过桌面应用运行。</div>
        )}
      </div>
    </TestPageLayout>
  );
}
