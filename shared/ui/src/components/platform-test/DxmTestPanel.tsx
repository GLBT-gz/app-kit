// ============================================================
// 店小秘平台测试面板（公共组件）—— 所有用到店小秘的项目共享
//
// 从 010-产品上架 TestPanel.tsx 提升收拢：
//   - 左侧测试模块（登录 / 前往各页面 / 浏览器实时监控）
//   - 右侧可拖拽日志栏（实时接收 dxm:progress 进度事件）
//   - 图形验证码弹窗（后端捕获 #verifyImgCode 后推送，输入回传）
// 底层命令见 ../dxm-api（裸名 dxm_*，由项目 Rust 侧注册）。
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLog } from "../LogPanel";
import { TestSection, TestPageLayout } from "../TestLayout";
import { Button } from "../controls/Button";
import { TextInput } from "../controls/TextInput";
import type { BCPBrowser } from "../BrowserConfigPanel";
import { usePlatformBrowserInfo, type ProfilesCache } from "../../hooks/usePlatformBrowserInfo";
import { toLogLevel, type ProgressPayload } from "../../log";
import {
  dxmLogin,
  dxmOpenPage,
  dxmSubmitVerifyCode,
  loadDxmCredentials,
  cancelDxmAutomation,
  dxmMonitorStart,
  dxmMonitorStatus,
  dxmListTabs,
  dxmTabActivate,
  dxmTabClose,
  dxmTabOpen,
  type DxmTabInfo,
} from "../../dxm-api";

// ── 平台测试分节透传 props（公共测试面板各分节共用） ──
export interface PlatformTestCtx {
  browsers: BCPBrowser[];
  cachedProfiles: ProfilesCache;
  configExePaths: Record<string, string>;
  platformSelections: Record<string, string | null>;
  log: (msg: string, ...args: any[]) => void;
}

/** 店小秘测试面板 props（与项目层 TestPanel 保持一致，日志由面板内部管理） */
export interface DxmTestPanelProps {
  browsers: BCPBrowser[];
  cachedProfiles: ProfilesCache;
  configExePaths: Record<string, string>;
  platformSelections: Record<string, string | null>;
  /**
   * 项目私有业务测试分节（渲染在通用骨架之后，共享面板内日志）。
   * 通用骨架只覆盖「登录/前往页面/浏览器监控」，业务抓取类测试由项目注入。
   */
  extraSections?: { title: string; content: (ctx: PlatformTestCtx) => ReactNode }[];
}

// ── 店小秘页面列表 ──
const DXM_PAGES: { key: string; label: string; desc: string }[] = [
  { key: "commodity", label: "商品管理", desc: "商品管理首页" },
  { key: "tiktok_add", label: "TikTok 上架页", desc: "创建 TikTok 产品" },
  { key: "shopee_add", label: "Shopee 上架页", desc: "创建 Shopee 产品" },
  { key: "warehouse", label: "仓库清单", desc: "仓库产品清单" },
];

// ── 测试 1：登录 ──
function DxmLoginSection(props: PlatformTestCtx & { onCancel: () => void }) {
  const browserInfo = usePlatformBrowserInfo(props.platformSelections, "dianxiaomi", props.browsers, props.cachedProfiles, props.configExePaths);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!browserInfo) { props.log("请先在「设置 → 当前自动化设置」中为店小秘配置浏览器", "error"); return; }
    setRunning(true);
    props.log("━━━ 店小秘登录 ━━━", "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");

    let username: string | undefined;
    let password: string | undefined;
    try {
      const creds = await loadDxmCredentials();
      if (creds.username && creds.password) {
        username = creds.username;
        password = creds.password;
        props.log("检测到已保存的账密，将尝试自动登录", "info");
      } else {
        props.log("未配置账密，将打开登录页供手动登录", "warn");
      }
    } catch {
      props.log("加载账密失败，将打开登录页供手动登录", "warn");
    }

    try {
      const r = await dxmLogin({
        exePath: browserInfo.exePath,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        username,
        password,
      });
      for (const line of r.split("\n")) {
        if (line.trim()) props.log(line, "success");
      }
      props.log("━━━ 完成 ━━━", "step");
    } catch (e: any) {
      const msg = String(e);
      props.log(msg.includes("取消") ? msg : `店小秘登录失败: ${e}`, msg.includes("取消") ? "warn" : "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为店小秘配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        <span>浏览器：{browserInfo.displayName}</span>
      </div>
      <div className="test-actions">
        {running ? (
          <Button className="test-start-btn" onClick={props.onCancel} style={{ background: "var(--error)", color: "var(--btn-text)" }}>
            ■ 终止
          </Button>
        ) : (
          <Button className="test-start-btn" onClick={run}>
            ▶ 打开登录页并自动登录
          </Button>
        )}
      </div>
    </div>
  );
}

// ── 测试 2：前往各页面 ──
function DxmOpenPageSection(props: PlatformTestCtx & { onCancel: () => void }) {
  const browserInfo = usePlatformBrowserInfo(props.platformSelections, "dianxiaomi", props.browsers, props.cachedProfiles, props.configExePaths);
  const [running, setRunning] = useState<string | null>(null);

  const run = async (page: { key: string; label: string }) => {
    if (!browserInfo) { props.log("请先在「设置 → 当前自动化设置」中为店小秘配置浏览器", "error"); return; }
    setRunning(page.key);
    props.log("━━━ 前往页面 ━━━", "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");

    let username: string | undefined;
    let password: string | undefined;
    try {
      const creds = await loadDxmCredentials();
      if (creds.username && creds.password) {
        username = creds.username;
        password = creds.password;
      }
    } catch { /* 未配置账密时静默跳过，页面会提示手动登录 */ }

    try {
      const r = await dxmOpenPage({
        exePath: browserInfo.exePath,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        username,
        password,
        page: page.key,
      });
      for (const line of r.split("\n")) {
        if (line.trim()) props.log(line, "success");
      }
      props.log("━━━ 完成 ━━━", "step");
    } catch (e: any) {
      const msg = String(e);
      props.log(msg.includes("取消") ? msg : `打开 ${page.label} 失败: ${e}`, msg.includes("取消") ? "warn" : "error");
    }
    setRunning(null);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为店小秘配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        <span>浏览器：{browserInfo.displayName}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {running ? (
          <Button className="test-start-btn" onClick={props.onCancel} style={{ background: "var(--error)", color: "var(--btn-text)" }}>
            ■ 终止
          </Button>
        ) : (
          DXM_PAGES.map(p => (
            <Button
              key={p.key}
              className="test-start-btn"
              onClick={() => run(p)}
              title={p.desc}
            >
              ▶ {p.label}
            </Button>
          ))
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        未登录时会自动登录（含图形验证码弹窗），登录成功后回到目标页面
      </div>
    </div>
  );
}

// ── 测试 3：浏览器实时监控（标签页列表 + 控制） ──
function DxmMonitorSection(props: PlatformTestCtx) {
  const browserInfo = usePlatformBrowserInfo(props.platformSelections, "dianxiaomi", props.browsers, props.cachedProfiles, props.configExePaths);
  const [port, setPort] = useState<number | null>(null);
  const [tabs, setTabs] = useState<DxmTabInfo[]>([]);
  const [offline, setOffline] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const lastOfflineRef = useRef<boolean | null>(null);

  // 挂载时恢复已连接的监控会话
  useEffect(() => {
    dxmMonitorStatus()
      .then(p => setPort(p))
      .catch(() => { /* 忽略 */ });
  }, []);

  // 连接后轮询标签页（2.5s），浏览器中手动开/关网页实时反映
  useEffect(() => {
    if (port === null) return;
    let stopped = false;
    const tick = async () => {
      try {
        const list = await dxmListTabs();
        if (stopped) return;
        setTabs(list);
        setOffline(false);
      } catch (e: any) {
        if (stopped) return;
        setOffline(true);
      }
    };
    tick();
    const timer = setInterval(tick, 2500);
    return () => { stopped = true; clearInterval(timer); };
  }, [port]);

  // 在线/离线状态变化时记录一条日志（避免刷屏）
  useEffect(() => {
    if (lastOfflineRef.current !== offline) {
      lastOfflineRef.current = offline;
      props.log(offline ? "浏览器未在线（可能已被关闭）" : "浏览器在线，正在监控标签页...", offline ? "warn" : "info");
    }
  }, [offline, props.log]);

  const connect = async () => {
    if (!browserInfo) { props.log("请先在「设置 → 当前自动化设置」中为店小秘配置浏览器", "error"); return; }
    setConnecting(true);
    props.log("━━━ 连接被控浏览器 ━━━", "step");
    try {
      const p = await dxmMonitorStart({ exePath: browserInfo.exePath, profileId: browserInfo.pid, userDataDir: browserInfo.udDir });
      setPort(p);
      props.log(`✅ 监控已连接（调试端口 ${p}），请在浏览器中任意操作`, "success");
    } catch (e: any) {
      props.log(`连接失败: ${e}`, "error");
    }
    setConnecting(false);
  };

  const activate = async (tab: DxmTabInfo) => {
    try {
      await dxmTabActivate(tab.id);
      props.log(`✅ 已切换到「${tab.title || tab.url}」`, "success");
    } catch (e: any) {
      props.log(`切换失败: ${e}`, "error");
    }
  };

  const close = async (tab: DxmTabInfo) => {
    try {
      await dxmTabClose(tab.id);
      props.log(`已关闭「${tab.title || tab.url}」`, "info");
    } catch (e: any) {
      props.log(`关闭失败: ${e}`, "error");
    }
  };

  const open = async () => {
    const url = newUrl.trim();
    if (!url) return;
    try {
      await dxmTabOpen(url);
      props.log(`✅ 已打开新标签页: ${url}`, "success");
      setNewUrl("");
    } catch (e: any) {
      props.log(`打开失败: ${e}`, "error");
    }
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为店小秘配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row">
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>浏览器：{browserInfo.displayName}</span>
        {port === null ? (
          <Button className="test-start-btn" onClick={connect} disabled={connecting}>
            {connecting ? "连接中..." : "▶ 连接浏览器"}
          </Button>
        ) : (
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: offline ? "var(--error, #e5484d)" : "var(--success, #2f9e44)",
          }}>
            {offline ? "● 浏览器离线" : `● 在线（端口 ${port}）`}
          </span>
        )}
      </div>

      {port !== null && (
        <>
          <div className="monitor-tabs">
            {!offline && tabs.length === 0 && (
              <div className="test-empty">暂无标签页，可在浏览器中打开网页后自动出现在这里</div>
            )}
            {tabs.map(t => (
              <div className="monitor-tab-row" key={t.id}>
                <div className="monitor-tab-info">
                  <div className="monitor-tab-title" title={t.url}>{t.title || "(无标题)"}</div>
                  <div className="monitor-tab-url" title={t.url}>{t.url}</div>
                </div>
                <div className="monitor-tab-ops">
                  <Button className="monitor-tab-btn" onClick={() => activate(t)} title="切换到该标签页">切换</Button>
                  <Button className="monitor-tab-btn monitor-tab-btn-danger" onClick={() => close(t)} title="关闭该标签页">关闭</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="test-single-row">
            <TextInput
              className="monitor-tab-input"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="输入网址，回车打开新标签页"
              onKeyDown={e => { if (e.key === "Enter") open(); }}
            />
            <Button className="test-start-btn" onClick={open}>打开</Button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            在浏览器中任意打开/关闭网页，列表每 2.5 秒自动刷新
          </div>
        </>
      )}
    </div>
  );
}

// ── 测试面板主组件（分栏布局：左侧测试模块 / 右侧可拖拽日志栏） ──
export function DxmTestPanel(props: DxmTestPanelProps) {
  const logCtx = useLog({ eventName: null, storageKey: "test:log:dxm" });
  const [logWidth, setLogWidth] = useState(28);

  // ── 实时进度事件监听（事件名与后端命令一一对应） ──
  useEffect(() => {
    const setup = listen<ProgressPayload>("dxm:progress", (event) => {
      const { message, level } = event.payload;
      if (message) logCtx.log(message, toLogLevel(level));
    });
    return () => { setup.then(fn => fn()); };
  }, [logCtx.log]);

  // ── 图形验证码弹窗（顶层统一监听，登录/前往页面均可能触发） ──
  const [verifyImage, setVerifyImage] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [showVerifyModal, setShowVerifyModal] = useState(false);

  useEffect(() => {
    const setup = listen<{ image: string }>("dxm:verify-code", (event) => {
      setVerifyImage(event.payload.image);
      setVerifyCode("");
      setShowVerifyModal(true);
    });
    return () => { setup.then(fn => fn()); };
  }, []);

  const submitVerifyCode = async () => {
    try {
      await dxmSubmitVerifyCode(verifyCode);
      setShowVerifyModal(false);
      setVerifyImage(null);
      logCtx.log("✅ 验证码已提交", "success");
    } catch (e: any) {
      logCtx.log(`验证码提交失败: ${e}`, "error");
    }
  };

  const cancelVerifyCode = async () => {
    try {
      await dxmSubmitVerifyCode("");
    } catch (_) { /* ignore */ }
    setShowVerifyModal(false);
    setVerifyImage(null);
    logCtx.log("⛔ 用户取消了验证码输入", "warn");
  };

  // ── 终止当前自动化（同时关闭验证码弹窗） ──
  const handleCancel = useCallback(() => {
    setShowVerifyModal(false);
    setVerifyImage(null);
    cancelDxmAutomation().catch((e: any) => logCtx.log(`终止失败: ${e}`, "error"));
  }, [logCtx.log]);

  const clearLog = useCallback(() => logCtx.clear(), [logCtx]);

  const sectionProps: PlatformTestCtx = {
    browsers: props.browsers,
    cachedProfiles: props.cachedProfiles,
    configExePaths: props.configExePaths,
    platformSelections: props.platformSelections,
    log: logCtx.log,
  };
  const cancelProps = { ...sectionProps, onCancel: handleCancel };

  return (
    <TestPageLayout
      log={logCtx}
      logWidth={logWidth}
      onLogWidthChange={setLogWidth}
      emptyText="选择模块后点击「运行」查看输出"
      onClear={clearLog}
    >
      <div className="test-modules">
        <div className="test-panel-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
          <span>店小秘功能测试</span>
        </div>
        <TestSection title="1. 登录店小秘"><DxmLoginSection {...cancelProps} /></TestSection>
        <TestSection title="2. 前往各页面（未登录自动登录）"><DxmOpenPageSection {...cancelProps} /></TestSection>
        <TestSection title="3. 浏览器实时监控（标签页）"><DxmMonitorSection {...sectionProps} /></TestSection>
        {props.extraSections?.map(s => (
          <TestSection key={s.title} title={s.title}>{s.content(sectionProps)}</TestSection>
        ))}
      </div>

      {/* 验证码弹窗 */}
      {showVerifyModal && (
        <div className="verify-overlay" onClick={cancelVerifyCode}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999,
          }}>
          <div className="verify-dialog" onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 12, padding: 24, minWidth: 360,
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)", textAlign: "center",
            }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>请输入验证码</h3>
            {verifyImage && (
              <img src={verifyImage} alt="验证码"
                style={{ border: "1px solid #ddd", borderRadius: 8, marginBottom: 16, maxWidth: 200 }}
              />
            )}
            <TextInput
              type="text"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value)}
              placeholder="输入验证码"
              maxLength={4}
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") submitVerifyCode(); }}
              style={{
                width: "100%", padding: "8px 12px", fontSize: 18, textAlign: "center",
                border: "1px solid var(--border-input)", borderRadius: 8, marginBottom: 16,
                boxSizing: "border-box", letterSpacing: 8,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Button onClick={cancelVerifyCode}
                style={{
                  padding: "8px 24px", border: "1px solid var(--border-input)", borderRadius: 6,
                  background: "var(--bg-surface)", cursor: "pointer",
                }}>
                取消
              </Button>
              <Button onClick={submitVerifyCode}
                style={{
                  padding: "8px 24px", border: "none", borderRadius: 6,
                  background: "var(--accent)", color: "var(--btn-text)", cursor: "pointer",
                }}>
                确认
              </Button>
            </div>
          </div>
        </div>
      )}
    </TestPageLayout>
  );
}
