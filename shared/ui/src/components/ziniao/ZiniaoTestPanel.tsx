import { useState } from "react";
import {
  ziniaoPatchStatus,
  ziniaoPatchApply,
  ziniaoAgentCdpPort,
  ziniaoEval,
  ziniaoNavigate,
  ziniaoScreenshot,
} from "../../ziniao-api";
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
  main_index_len: number;
  detail: string;
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
  const [js, setJs] = useState(`JSON.stringify({ title: document.title, url: location.href })`);
  const [navUrl, setNavUrl] = useState("");

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
    stepCdp,
    run,
  } = useZiniaoAgent(log);

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

        <TestSection title="1. 紫鸟补丁（自动化集成配置）">
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

        <TestSection title="4. 打开 / 关闭店铺">
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

        {!isTauriRuntime() && (
          <div className="zn-error">当前处于浏览器预览模式（无 Tauri 运行时），无法调用紫鸟命令。请通过桌面应用运行。</div>
        )}
      </div>
    </TestPageLayout>
  );
}
