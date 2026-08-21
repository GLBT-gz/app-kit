// ============================================================
// 多维表格（kdocs）平台测试面板（公共组件）—— 所有用到多维表格的项目共享
//
// 通用骨架（006/007 均已注册同名命令）：
//   1. 打开多维表格（URL 可输入，默认取 props.defaultUrl）
//   2. 解析侧边栏
//   3. 解析脚本列表
//   4. 运行脚本并读取日志（route/scriptName 可输入，默认取 props.runScriptDefaults）
// 项目私有业务测试经 extraSections 注入（共享面板内日志）。
// 实时进度经事件 kdocs-test-progress 推送（{ message, level }）。
// 底层命令见 ../kdocs-api（裸名 test_kdocs_* / cancel_kdocs，由项目 Rust 侧注册）。
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLog } from "../LogPanel";
import { TestSection, TestPageLayout } from "../TestLayout";
import { Button } from "../controls/Button";
import { TextInput } from "../controls/TextInput";
import type { BCPBrowser } from "../BrowserConfigPanel";
import { usePlatformBrowserInfo, type ProfilesCache } from "../../hooks/usePlatformBrowserInfo";
import { toLogLevel, type ProgressPayload } from "../../log";
import { cancelKdocs, testKdocsOpen, testKdocsParseScripts, testKdocsRunScript, testKdocsSidebar } from "../../kdocs-api";
import type { PlatformTestCtx } from "./DxmTestPanel";

/** 通用骨架模块（可按项目裁剪；未在列表中的模块不渲染） */
export type KdocsPanelModule = "open" | "sidebar" | "scripts" | "run";

/** 多维表格测试面板 props（与项目层 TestPanel 保持一致，日志由面板内部管理） */
export interface KdocsTestPanelProps {
  browsers: BCPBrowser[];
  cachedProfiles: ProfilesCache;
  configExePaths: Record<string, string>;
  platformSelections: Record<string, string | null>;
  /** 浏览器配置的平台 key（默认 "kdocs"；如 003 配置在 "feishu" key 下则传 "feishu"） */
  platformKey?: string;
  /** 打开/侧边栏/脚本列表模块的默认多维表格 URL（可编辑） */
  defaultUrl?: string;
  /** 运行脚本模块的默认路由/脚本名（可编辑；006 由「当前自动化设置」配置带入） */
  runScriptDefaults?: { route?: string; scriptName?: string };
  /** 通用骨架裁剪（默认全部 4 项；如 003 仅支持打开则传 ["open"]） */
  modules?: KdocsPanelModule[];
  /**
   * 项目私有业务测试分节（渲染在通用骨架之后，共享面板内日志）。
   * 通用骨架只覆盖「打开/侧边栏/脚本列表/运行脚本」，业务抓取类测试由项目注入。
   */
  extraSections?: { title: string; content: (ctx: PlatformTestCtx) => ReactNode }[];
}

/** 骨架分节上下文（PlatformTestCtx + 可自定义平台 key） */
interface KdocsSectionCtx extends PlatformTestCtx {
  platformKey: string;
}

// ── 骨架 1：打开多维表格 ──
function KdocsOpenSection(props: KdocsSectionCtx & { url: string; onUrlChange: (v: string) => void; onCancel: () => void }) {
  const browserInfo = usePlatformBrowserInfo(props.platformSelections, props.platformKey, props.browsers, props.cachedProfiles, props.configExePaths);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!browserInfo) { props.log("请先在「设置 → 当前自动化设置」中为多维表格配置浏览器", "error"); return; }
    if (!props.url.trim()) { props.log("请先填写多维表格 URL", "error"); return; }
    setRunning(true);
    props.log("━━━ 打开多维表格 ━━━", "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");
    props.log(`目标: ${props.url.trim()}`, "step");
    try {
      const r = await testKdocsOpen({
        exePath: browserInfo.exePath,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        kdocsUrl: props.url.trim(),
      });
      for (const line of r.split("\n")) {
        if (line.trim()) props.log(line, "success");
      }
      props.log("━━━ 完成 ━━━", "step");
    } catch (e: any) {
      props.log(`打开失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为多维表格配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        <span>浏览器：{browserInfo.displayName}</span>
      </div>
      <div className="test-form-row">
        <label>多维表格 URL：</label>
        <TextInput
          className="kdocs-url-input"
          value={props.url}
          onChange={e => props.onUrlChange(e.target.value)}
          placeholder="https://365.kdocs.cn/l/..."
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      <div className="test-actions">
        {running ? (
          <Button className="test-start-btn" onClick={props.onCancel} style={{ background: "var(--error)", color: "var(--btn-text)" }}>
            ■ 终止
          </Button>
        ) : (
          <Button className="test-start-btn" onClick={run}>▶ 打开多维表格</Button>
        )}
      </div>
    </div>
  );
}

// ── 骨架 2：解析侧边栏（只读） ──
function KdocsSidebarSection(props: KdocsSectionCtx & { url: string; onCancel: () => void }) {
  const browserInfo = usePlatformBrowserInfo(props.platformSelections, props.platformKey, props.browsers, props.cachedProfiles, props.configExePaths);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!browserInfo) { props.log("请先在「设置 → 当前自动化设置」中为多维表格配置浏览器", "error"); return; }
    if (!props.url.trim()) { props.log("请先填写多维表格 URL", "error"); return; }
    setRunning(true);
    props.log("━━━ 解析侧边栏 ━━━", "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");
    props.log("只读检测，不会点击任何按钮，输出侧边栏树 + 可导航目标", "step");
    try {
      const r = await testKdocsSidebar({
        exePath: browserInfo.exePath,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        kdocsUrl: props.url.trim(),
      });
      for (const line of r.split("\n")) {
        if (line.trim()) props.log(line, "success");
      }
      props.log("━━━ 完成 ━━━", "step");
    } catch (e: any) {
      props.log(`解析侧边栏失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为多维表格配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        <span>浏览器：{browserInfo.displayName}</span>
      </div>
      <div className="test-single-row" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        <span>目标：{props.url.trim() || "（未填写 URL）"}</span>
      </div>
      <div className="test-actions">
        {running ? (
          <Button className="test-start-btn" onClick={props.onCancel} style={{ background: "var(--error)", color: "var(--btn-text)" }}>
            ■ 终止
          </Button>
        ) : (
          <Button className="test-start-btn" onClick={run}>▶ 解析侧边栏</Button>
        )}
      </div>
    </div>
  );
}

// ── 骨架 3：解析脚本列表（只读） ──
function KdocsParseScriptsSection(props: PlatformTestCtx & { url: string; onCancel: () => void }) {
  const browserInfo = usePlatformBrowserInfo(props.platformSelections, "kdocs", props.browsers, props.cachedProfiles, props.configExePaths);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!browserInfo) { props.log("请先在「设置 → 当前自动化设置」中为多维表格配置浏览器", "error"); return; }
    if (!props.url.trim()) { props.log("请先填写多维表格 URL", "error"); return; }
    setRunning(true);
    props.log("━━━ 解析脚本列表 ━━━", "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");
    try {
      const r = await testKdocsParseScripts({
        exePath: browserInfo.exePath,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        kdocsUrl: props.url.trim(),
      });
      for (const line of r.split("\n")) {
        if (line.trim()) props.log(line, "success");
      }
      props.log("━━━ 完成 ━━━", "step");
    } catch (e: any) {
      props.log(`解析脚本列表失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为多维表格配置浏览器</div>;
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
          <Button className="test-start-btn" onClick={run}>📜 解析脚本列表</Button>
        )}
      </div>
    </div>
  );
}

// ── 骨架 4：运行脚本并读取日志 ──
function KdocsRunScriptSection(props: KdocsSectionCtx & { url: string; defaults?: { route?: string; scriptName?: string }; onCancel: () => void }) {
  const browserInfo = usePlatformBrowserInfo(props.platformSelections, props.platformKey, props.browsers, props.cachedProfiles, props.configExePaths);
  const [running, setRunning] = useState(false);
  const [scriptName, setScriptName] = useState(props.defaults?.scriptName ?? "");
  const [route, setRoute] = useState(props.defaults?.route ?? "");

  const run = async () => {
    if (!browserInfo) { props.log("请先在「设置 → 当前自动化设置」中为多维表格配置浏览器", "error"); return; }
    if (!props.url.trim()) { props.log("请先填写多维表格 URL", "error"); return; }
    if (!scriptName.trim()) { props.log("请填写要运行的脚本名", "error"); return; }
    setRunning(true);
    props.log("━━━ 运行脚本并读取日志 ━━━", "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");
    props.log(`脚本：${scriptName.trim()}`, "step");
    try {
      const r = await testKdocsRunScript({
        exePath: browserInfo.exePath,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        kdocsUrl: props.url.trim(),
        scriptName: scriptName.trim(),
        // 始终传字符串：006 后端 route 为必选 String，传空串由后端提示「请配置路由」；
        // 007 后端无 route 参数（serde 忽略多余字段），传空串无影响
        route: route.trim(),
      });
      for (const line of r.split("\n")) {
        if (line.trim()) props.log(line, "success");
      }
      props.log("━━━ 完成 ━━━", "step");
    } catch (e: any) {
      props.log(`运行脚本失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为多维表格配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        <span>浏览器：{browserInfo.displayName}</span>
      </div>
      <div className="test-form-row">
        <label>脚本名：</label>
        <TextInput
          value={scriptName}
          onChange={e => setScriptName(e.target.value)}
          placeholder="输入要运行的脚本名"
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      <div className="test-form-row">
        <label>左侧路由：</label>
        <TextInput
          value={route}
          onChange={e => setRoute(e.target.value)}
          placeholder="（可选）006 所需路由，007 可留空"
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      <div className="test-actions">
        {running ? (
          <Button className="test-start-btn" onClick={props.onCancel} style={{ background: "var(--error)", color: "var(--btn-text)" }}>
            ■ 终止
          </Button>
        ) : (
          <Button className="test-start-btn" onClick={run}>▶ 运行脚本并读取日志</Button>
        )}
      </div>
    </div>
  );
}

// ── 测试面板主组件（分栏布局：左侧测试模块 / 右侧可拖拽日志栏） ──
export function KdocsTestPanel(props: KdocsTestPanelProps) {
  const logCtx = useLog({ eventName: null, storageKey: "test:log:kdocs" });
  const [logWidth, setLogWidth] = useState(360);
  const [url, setUrl] = useState(props.defaultUrl ?? "");
  const modules = props.modules ?? ["open", "sidebar", "scripts", "run"];

  // ── 实时进度事件监听（事件名与后端命令一致：kdocs-test-progress） ──
  useEffect(() => {
    const setup = listen<ProgressPayload>("kdocs-test-progress", (event) => {
      const { message, level } = event.payload;
      if (message) logCtx.log(message, toLogLevel(level));
    });
    return () => { setup.then(fn => fn()); };
  }, [logCtx.log]);

  // ── 终止当前自动化 ──
  const handleCancel = useCallback(() => {
    cancelKdocs().catch((e: any) => logCtx.log(`终止失败: ${e}`, "error"));
  }, [logCtx.log]);

  const clearLog = useCallback(() => logCtx.clear(), [logCtx]);

  const sectionProps: PlatformTestCtx = {
    browsers: props.browsers,
    cachedProfiles: props.cachedProfiles,
    configExePaths: props.configExePaths,
    platformSelections: props.platformSelections,
    log: logCtx.log,
  };
  const kdocsCtx: KdocsSectionCtx = { ...sectionProps, platformKey: props.platformKey ?? "kdocs" };
  const cancelProps = { ...kdocsCtx, onCancel: handleCancel };
  const urlProps = { ...cancelProps, url, onUrlChange: setUrl };

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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
          <span>多维表格功能测试</span>
        </div>
        {modules.includes("open") && (
          <TestSection title="1. 打开多维表格"><KdocsOpenSection {...urlProps} /></TestSection>
        )}
        {modules.includes("sidebar") && (
          <TestSection title="2. 解析侧边栏"><KdocsSidebarSection {...cancelProps} url={url} /></TestSection>
        )}
        {modules.includes("scripts") && (
          <TestSection title="3. 解析脚本列表"><KdocsParseScriptsSection {...cancelProps} url={url} /></TestSection>
        )}
        {modules.includes("run") && (
          <TestSection title="4. 运行脚本并读取日志"><KdocsRunScriptSection {...cancelProps} url={url} defaults={props.runScriptDefaults} /></TestSection>
        )}
        {props.extraSections?.map(s => (
          <TestSection key={s.title} title={s.title}>{s.content(sectionProps)}</TestSection>
        ))}
      </div>
    </TestPageLayout>
  );
}
