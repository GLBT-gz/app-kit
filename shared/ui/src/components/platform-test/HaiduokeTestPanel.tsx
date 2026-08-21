// ============================================================
// 海多客平台测试面板（公共组件）—— 006/007 共享
//
// 通用骨架（命令契约见 ../haiduoke-api，裸名 test_haiduoke_* 由项目 Rust 侧注册）：
//   1. 海多客登录（打开登录页，已保存账密自动登录）
// 项目私有业务测试（006 最新采购单号 / 007 获取库存）经 extraSections 注入（共享面板内日志）。
// 实时进度经事件 haiduoke-test-progress 推送（{ message, level }，level "ok"→success）。
//
// 浏览器解析支持两种模式：
//   - 多浏览器模式（007）：platformSelections[platformKey] 字符串解析（usePlatformBrowserInfo）
//   - 单浏览器模式（006）：browserOverride 直读浏览器配置（跳过 platformSelections）
// 账密由各项目通过 loadCredentials 回调从自己的凭证存储读取。
// ============================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLog } from "../LogPanel";
import { TestSection, TestPageLayout } from "../TestLayout";
import type { BCPBrowser } from "../BrowserConfigPanel";
import { usePlatformBrowserInfo, type ProfilesCache } from "../../hooks/usePlatformBrowserInfo";
import { toLogLevel, type ProgressPayload } from "../../log";
import { testHaiduokeOpenLogin } from "../../haiduoke-api";
import type { PlatformTestCtx } from "./DxmTestPanel";

/** 海多客测试面板 props（与项目层 TestPanel 保持一致，日志由面板内部管理） */
export interface HaiduokeTestPanelProps {
  browsers: BCPBrowser[];
  cachedProfiles: ProfilesCache;
  configExePaths: Record<string, string>;
  platformSelections: Record<string, string | null>;
  /** 浏览器配置的平台 key（默认 "haiduoke"） */
  platformKey?: string;
  /** 单浏览器模式（006）：直读浏览器配置覆盖 platformSelections 解析 */
  browserOverride?: { exePath: string; userDataDir: string; profileId: string; displayName?: string };
  /** 账密加载回调（各项目从自己的凭证存储读取；返回空则手动登录） */
  loadCredentials?: () => Promise<{ phone?: string; password?: string }>;
  /** 终止当前自动化（各项目按自己规范实现；缺省仅结束运行态） */
  onCancel?: () => void;
  /**
   * 项目私有业务测试分节（渲染在通用骨架之后，共享面板内日志）。
   * 通用骨架只覆盖「登录」，业务抓取类测试由项目注入。
   */
  extraSections?: { title: string; content: (ctx: PlatformTestCtx) => ReactNode }[];
}

/** 骨架分节上下文（PlatformTestCtx + 双模式浏览器解析与账密回调） */
interface HaiduokeSectionCtx extends PlatformTestCtx {
  platformKey: string;
  browserOverride?: HaiduokeTestPanelProps["browserOverride"];
  loadCredentials?: HaiduokeTestPanelProps["loadCredentials"];
  onCancel?: () => void;
}

// ── 骨架 1：海多客登录 ──
function HaiduokeLoginSection(props: HaiduokeSectionCtx) {
  // 单浏览器模式（006）：browserOverride 直读；多浏览器模式（007）：platformSelections 解析
  const overrideInfo = useMemo(() => {
    if (props.browserOverride?.exePath) {
      return {
        exePath: props.browserOverride.exePath,
        pid: props.browserOverride.profileId,
        udDir: props.browserOverride.userDataDir,
        displayName: props.browserOverride.displayName || "当前浏览器配置",
      };
    }
    return null;
  }, [props.browserOverride]);
  const platformInfo = usePlatformBrowserInfo(props.platformSelections, props.platformKey, props.browsers, props.cachedProfiles, props.configExePaths);
  const browserInfo = overrideInfo ?? platformInfo;

  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!browserInfo) { props.log("请先在「设置 → 当前自动化设置」中为海多客配置浏览器", "error"); return; }
    setRunning(true);
    props.log("━━━ 海多客登录测试 ━━━", "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");

    let phone: string | undefined;
    let password: string | undefined;
    if (props.loadCredentials) {
      try {
        const creds = await props.loadCredentials();
        phone = creds.phone;
        password = creds.password;
        props.log(phone && password ? "检测到已保存的账密，将尝试自动登录" : "未配置账密，请手动登录", "info");
      } catch {
        props.log("加载账密失败，请手动登录", "warn");
      }
    } else {
      props.log("未配置账密，请手动登录", "info");
    }

    try {
      const r = await testHaiduokeOpenLogin({
        exePath: browserInfo.exePath,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        phone,
        password,
      });
      for (const line of r.split("\n")) {
        if (line.trim()) props.log(line, "success");
      }
      props.log("━━━ 完成 ━━━", "step");
    } catch (e: any) {
      props.log(`海多客登录测试失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为海多客配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        <span>浏览器：{browserInfo.displayName}</span>
      </div>
      <div className="test-actions">
        {running ? (
          <button className="test-start-btn" onClick={() => { props.onCancel?.(); setRunning(false); }} style={{ background: "var(--error)", color: "var(--btn-text)" }}>
            ■ 终止
          </button>
        ) : (
          <button className="test-start-btn" onClick={run}>▶ 打开登录页</button>
        )}
      </div>
    </div>
  );
}

// ── 测试面板主组件（分栏布局：左侧测试模块 / 右侧可拖拽日志栏） ──
export function HaiduokeTestPanel(props: HaiduokeTestPanelProps) {
  const logCtx = useLog({ eventName: null, storageKey: "test:log:haiduoke" });
  const [logWidth, setLogWidth] = useState(360);

  // ── 实时进度事件监听（事件名与后端命令一致：haiduoke-test-progress） ──
  useEffect(() => {
    const setup = listen<ProgressPayload>("haiduoke-test-progress", (event) => {
      const { message, level } = event.payload;
      if (message) logCtx.log(message, toLogLevel(level));
    });
    return () => { setup.then(fn => fn()); };
  }, [logCtx.log]);

  const clearLog = useCallback(() => logCtx.clear(), [logCtx]);

  const sectionProps: PlatformTestCtx = {
    browsers: props.browsers,
    cachedProfiles: props.cachedProfiles,
    configExePaths: props.configExePaths,
    platformSelections: props.platformSelections,
    log: logCtx.log,
  };
  const hdkCtx: HaiduokeSectionCtx = {
    ...sectionProps,
    platformKey: props.platformKey ?? "haiduoke",
    browserOverride: props.browserOverride,
    loadCredentials: props.loadCredentials,
    onCancel: props.onCancel,
  };

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
          <span>海多客功能测试</span>
        </div>
        <TestSection title="1. 海多客登录"><HaiduokeLoginSection {...hdkCtx} /></TestSection>
        {props.extraSections?.map(s => (
          <TestSection key={s.title} title={s.title}>{s.content(sectionProps)}</TestSection>
        ))}
      </div>
    </TestPageLayout>
  );
}
