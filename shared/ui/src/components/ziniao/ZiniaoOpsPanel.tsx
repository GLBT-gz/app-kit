import { useCallback, useEffect, useRef, useState } from "react";
import {
  ziniaoAgentCdpPort,
  ziniaoEval,
  ziniaoScreenshot,
  ziniaoNavigate,
} from "../../ziniao-api";
import { isTauriRuntime } from "../../tauri-utils";
import type { ZiniaoAgentBrowser } from "../../ziniao-api";
import { useLog, LogPanel } from "../LogPanel";
import { useZiniaoAgent } from "../../hooks/useZiniaoAgent";
import { ZiniaoStoreList } from "./ZiniaoStoreList";

/**
 * 紫鸟自动化运营主界面（公共组件）
 *
 * 布局参考 Temu 运营工具：左侧店铺列表，右侧 日志 / 表格 / CDP 控制 / 规则说明。
 * 功能：自动打开紫鸟、解析店铺、打开/关闭店铺、CDP 控制（eval/导航/截图）。
 * 核心步骤逻辑由公共 hook useZiniaoAgent 提供，本组件只负责布局与 JS/导航控制。
 * 依赖：紫鸟 v10.9 补丁（登录后自动开启 agent_mode HTTP 服务）。
 */
export function ZiniaoOpsPanel() {
  const [selected, setSelected] = useState<ZiniaoAgentBrowser | null>(null);
  const [js, setJs] = useState(`JSON.stringify({ title: document.title, url: location.href })`);
  const [navUrl, setNavUrl] = useState("");
  const [leftWidth, setLeftWidth] = useState(340);

  const logCtx = useLog({ eventName: null, storageKey: "ziniao:ops-log" });
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
    acceptAll,
  } = useZiniaoAgent(log);

  // 对选中店铺执行 JS
  const runEval = async (): Promise<string> => {
    if (!selected) throw new Error("请先在左侧选择一个店铺");
    const cdp = await ziniaoAgentCdpPort(selected.browserId);
    const v = await ziniaoEval(cdp, js);
    return `eval ${selected.browserName} :${cdp} → ${JSON.stringify(v)}`;
  };

  // 对选中店铺导航
  const runNav = async (): Promise<string> => {
    if (!selected) throw new Error("请先在左侧选择一个店铺");
    if (!navUrl) throw new Error("请输入目标 URL");
    const cdp = await ziniaoAgentCdpPort(selected.browserId);
    await ziniaoNavigate(cdp, navUrl);
    return `导航 ${selected.browserName} :${cdp} → ${navUrl}`;
  };

  // 左列宽度拖拽
  const dragging = useRef(false);
  const handleSplitterDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const rect = document.querySelector(".zn-ops-body")?.getBoundingClientRect();
      if (!rect) return;
      const w = e.clientX - rect.left;
      setLeftWidth(Math.min(Math.max(w, 240), 520));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const isRunning = (id: number) => running.has(id);

  return (
    <div className="zn-ops">
      <div className="zn-ops-header">
        <h2 className="zn-title">紫鸟自动化运营</h2>
        <button className="zn-btn primary" disabled={busy} onClick={() => acceptAll(setSelected)}>
          {busy ? "运行中…" : "一键验收"}
        </button>
        <button className="zn-btn" disabled={busy} onClick={() => run("① 打开紫鸟", stepLaunch)}>
          ① 打开紫鸟
        </button>
        <button className="zn-btn" disabled={busy} onClick={() => run("② 获取店铺列表", stepList)}>
          ② 店铺列表
        </button>
        <button
          className="zn-btn"
          disabled={busy || !agent?.port}
          onClick={() =>
            run("刷新运行状态", async () => {
              if (!agent?.port) throw new Error("请先执行「获取店铺列表」");
              const ids = await refreshRunning(agent.port);
              return `${ids.length} 个环境已打开`;
            })
          }
        >
          刷新状态
        </button>
        {agent?.running ? (
          <span className="zn-badge ok">agent_mode :{agent.port ?? "?"}</span>
        ) : (
          <span className="zn-badge warn">紫鸟未运行</span>
        )}
      </div>

      {!isTauriRuntime() && (
        <div className="zn-hint" style={{ padding: "0 16px" }}>
          当前处于浏览器预览模式（无 Tauri 运行时），无法调用紫鸟命令。请通过桌面应用运行。
        </div>
      )}

      <div className="zn-ops-body">
        {/* 左列：店铺列表 */}
        <div className="zn-ops-left" style={{ width: leftWidth }}>
          <div className="zn-ops-left-head">
            <span>店铺列表</span>
            <span className="zn-sub">
              {shops.length} 个 / 运行 {running.size}
            </span>
          </div>
          {shops.length === 0 && <div className="zn-empty">暂无店铺，请点「② 店铺列表」</div>}
          {shops.map((s) => {
            const on = isRunning(s.browserId);
            return (
              <div
                key={s.browserId}
                className={`zn-shop${selected?.browserId === s.browserId ? " active" : ""}`}
                onClick={() => setSelected(s)}
              >
                <div className="zn-shop-name">
                  {s.browserName}
                  <span className={`zn-shop-state ${on ? "on" : "off"}`} style={{ marginLeft: 8 }}>
                    {on ? "●" : "○"}
                  </span>
                </div>
                <div className="zn-shop-meta">
                  {s.platform_name} · {s.browserId}
                </div>
                <div className="zn-shop-ops">
                  {on ? (
                    <button
                      className="zn-btn danger"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        run(`关闭 ${s.browserName}`, () => stepClose(s));
                      }}
                    >
                      关闭
                    </button>
                  ) : (
                    <button
                      className="zn-btn"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        run(`打开 ${s.browserName}`, () => stepOpen(s));
                      }}
                    >
                      打开
                    </button>
                  )}
                  <button
                    className="zn-btn"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      run(`CDP ${s.browserName}`, () => stepCdp(s));
                    }}
                  >
                    CDP
                  </button>
                  <span className="zn-sub">{shopState[String(s.browserId)] ?? ""}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 拖拽分隔条 */}
        <div
          className="zn-splitter"
          onMouseDown={handleSplitterDown}
          title="拖拽调整列表宽度"
        />

        {/* 右列：日志 + 表格 + CDP 控制 + 规则说明 */}
        <div className="zn-ops-right">
          <div className="zn-card">
            <div className="zn-card-head">运行日志</div>
            <LogPanel log={logCtx} title="" emptyText="点击上方按钮或「一键验收」查看输出" />
          </div>

          {shops.length > 0 && (
            <div className="zn-card">
              <div className="zn-card-head">
                店铺明细（{shops.length}，运行中 {running.size}）
              </div>
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

          <div className="zn-card">
            <div className="zn-card-head">
              CDP 控制
              {selected && (
                <span className="zn-sub">
                  → 当前选中：{selected.browserName}（CDP :
                  {selected ? `9222 + ${selected.browserId} % 5000` : ""}）
                </span>
              )}
            </div>
            {!selected ? (
              <div className="zn-hint">请在左侧选择一个店铺后执行 JS / 导航 / 截图。</div>
            ) : (
              <>
                <div className="zn-shop-ops">
                  <span className="zn-sub">执行 JS：</span>
                  <textarea
                    className="zn-input zn-js"
                    value={js}
                    rows={2}
                    style={{ flex: 1, resize: "vertical" }}
                    onChange={(e) => setJs(e.target.value)}
                  />
                  <button className="zn-btn" disabled={busy} onClick={() => run("执行 JS", runEval)}>
                    执行
                  </button>
                  <button
                    className="zn-btn"
                    disabled={busy}
                    onClick={() =>
                      run(`截图 ${selected.browserName}`, async () => {
                        const cdp = await ziniaoAgentCdpPort(selected.browserId);
                        const b64 = await ziniaoScreenshot(cdp);
                        setShots((prev) => ({ ...prev, [String(selected.browserId)]: b64 }));
                        return `截图 :${cdp} → ${Math.round((b64.length * 3) / 4)}B`;
                      })
                    }
                  >
                    截图
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
                  <button className="zn-btn" disabled={busy} onClick={() => run("导航", runNav)}>
                    导航
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="zn-card">
            <div className="zn-card-head">规则说明</div>
            <div className="zn-guide">
              <p>1. <b>v10.9 补丁</b>：登录后主程序自动开启 <code>agent_mode</code> HTTP 服务（端口动态，<code>127.0.0.1</code>），无需 webdriver 权限。</p>
              <p>2. <b>店铺解析</b>：通过 <code>POST getBrowserList</code>（免认证）拉取全部店铺；<code>getRunningInfo</code> 标记「已打开/未打开」。</p>
              <p>3. <b>打开店铺</b>：<code>POST startBrowserByAgentMode</code>（browserId 需为字符串）；CDP 端口 = <code>9222 + browserId % 5000</code>。</p>
              <p>4. <b>CDP 控制</b>：内核监听上述端口，可执行 JS / 导航 / 截图 / 开标签页等。冷启动含内核下载可能需 1-3 分钟。</p>
              <p>5. <b>关闭店铺</b>：CDP <code>Browser.close</code>，1 秒释放端口，官方状态同步清理。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
