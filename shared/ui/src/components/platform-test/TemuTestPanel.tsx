// ============================================================
// Temu 平台测试面板（公共组件）—— 所有用到 Temu 的项目共享
//
// 通用骨架（命令契约见 ../temu-api，裸名 test_temu_* 由项目 Rust 侧注册）：
//   1. Temu 自动登录（可视化/后台模式可选）
//   2. 登录后关闭所有弹窗广告
//   3. 获取所有店铺列表
//   4. 切换到指定店铺（目标店铺取 load_cached_shops 缓存）
//   5. 左侧路由导航（预定义常用路由）
// 项目私有业务测试（备货/销量等）经 extraSections 注入（共享面板内日志）。
// 平台维度：广州（temu-gz）/ 香港（temu-hk），对应 platformSelections 的两个 key。
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLog } from "../LogPanel";
import { TestSection, TestPageLayout } from "../TestLayout";
import { CustomSelect } from "../CustomSelect";
import type { BCPBrowser } from "../BrowserConfigPanel";
import { usePlatformBrowserInfo, type ProfilesCache } from "../../hooks/usePlatformBrowserInfo";
import {
  loadTemuCachedShops,
  testTemuAutoLogin,
  testTemuClosePopups,
  testTemuGetShops,
  testTemuNavigateMenu,
  testTemuSwitchShop,
  type TemuPlatform,
} from "../../temu-api";
import type { PlatformTestCtx } from "./DxmTestPanel";

/** Temu 测试面板 props（与项目层 TestPanel 保持一致，日志由面板内部管理） */
export interface TemuTestPanelProps {
  browsers: BCPBrowser[];
  cachedProfiles: ProfilesCache;
  configExePaths: Record<string, string>;
  platformSelections: Record<string, string | null>;
  /**
   * 项目私有业务测试分节（渲染在通用骨架之后，共享面板内日志）。
   * 通用骨架只覆盖「登录/弹窗/店铺/切换/导航」，业务抓取类测试由项目注入。
   */
  extraSections?: { title: string; content: (ctx: PlatformTestCtx) => ReactNode }[];
}

/** 骨架分节上下文（PlatformTestCtx + 当前平台） */
interface TemuSectionCtx extends PlatformTestCtx {
  platform: TemuPlatform;
  setPlatform: (p: TemuPlatform) => void;
}

const PLATFORM_LABEL: Record<TemuPlatform, string> = { gz: "广州", hk: "香港" };

/** 从平台选择字符串解析浏览器信息（temu-gz / temu-hk） */
function useTemuBrowserInfo(ctx: TemuSectionCtx) {
  return usePlatformBrowserInfo(
    ctx.platformSelections,
    ctx.platform === "gz" ? "temu-gz" : "temu-hk",
    ctx.browsers,
    ctx.cachedProfiles,
    ctx.configExePaths,
  );
}

// ── 平台切换（广州/香港） ──
function PlatformToggle({ value, onChange }: { value: TemuPlatform; onChange: (p: TemuPlatform) => void }) {
  return (
    <div className="test-platform-toggle">
      <button className={`test-platform-btn${value === "gz" ? " active" : ""}`} onClick={() => onChange("gz")}>广州</button>
      <button className={`test-platform-btn${value === "hk" ? " active" : ""}`} onClick={() => onChange("hk")}>香港</button>
    </div>
  );
}

// ── 运行模式（可视化/后台） ──
function ModeToggle({ value, onChange }: { value: "visible" | "background"; onChange: (m: "visible" | "background") => void }) {
  return (
    <div className="test-platform-toggle">
      <button className={`test-platform-btn${value === "visible" ? " active" : ""}`} onClick={() => onChange("visible")}>可视化</button>
      <button className={`test-platform-btn${value === "background" ? " active" : ""}`} onClick={() => onChange("background")}>后台模式</button>
    </div>
  );
}

/** 分步日志输出：✅→success / ❌→error / 其余→info */
function logResult(props: PlatformTestCtx, r: string) {
  for (const line of r.split("\n")) {
    if (line.trim()) props.log(line, line.includes("✅") ? "success" : line.includes("❌") ? "error" : "info");
  }
}

// ── 骨架 1：自动登录 ──
function TemuAutoLoginSection(props: TemuSectionCtx) {
  const [mode, setMode] = useState<"visible" | "background">("visible");
  const [running, setRunning] = useState(false);
  const browserInfo = useTemuBrowserInfo(props);
  const platformLabel = PLATFORM_LABEL[props.platform];

  const run = async () => {
    if (!browserInfo) { props.log(`请先在「设置 → 当前自动化设置」中为 temu${platformLabel} 配置浏览器`, "error"); return; }
    setRunning(true);
    props.log(`━━━ 开始 Temu ${platformLabel} 自动登录 ━━━`, "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");
    props.log("正在启动浏览器并连接 CDP...", "step");
    try {
      const r = await testTemuAutoLogin({
        exePath: browserInfo.exePath,
        browserType: browserInfo.bt,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        platform: props.platform,
        headless: mode === "background",
      });
      logResult(props, r);
      props.log("━━━ 自动登录完成 ━━━", "step");
    } catch (e: any) {
      props.log(`自动登录失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为 temu{platformLabel} 配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row">
        <span className="test-config-label">浏览器配置：</span>
        <span className="test-config-value">{browserInfo.displayName}</span>
      </div>
      <div className="test-single-row">
        <span className="test-config-label">平　　台：</span>
        <PlatformToggle value={props.platform} onChange={props.setPlatform} />
      </div>
      <div className="test-single-row">
        <span className="test-config-label">运行模式：</span>
        <ModeToggle value={mode} onChange={setMode} />
      </div>
      <div className="test-actions">
        <button className="test-start-btn" onClick={run} disabled={running}>
          {running ? "自动登录中..." : "▶ 打开 Temu 并自动登录"}
        </button>
      </div>
    </div>
  );
}

// ── 骨架 2：关闭弹窗 ──
function TemuClosePopupsSection(props: TemuSectionCtx) {
  const [running, setRunning] = useState(false);
  const browserInfo = useTemuBrowserInfo(props);
  const platformLabel = PLATFORM_LABEL[props.platform];

  const run = async () => {
    if (!browserInfo) { props.log(`请先在「设置 → 当前自动化设置」中为 temu${platformLabel} 配置浏览器`, "error"); return; }
    setRunning(true);
    props.log(`━━━ 开始 Temu ${platformLabel} 弹窗清理测试 ━━━`, "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");
    props.log("正在启动浏览器并连接 CDP...", "step");
    try {
      const r = await testTemuClosePopups({
        exePath: browserInfo.exePath,
        browserType: browserInfo.bt,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        platform: props.platform,
      });
      logResult(props, r);
      props.log("━━━ 弹窗清理测试完成 ━━━", "step");
    } catch (e: any) {
      props.log(`弹窗清理测试失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为 temu{platformLabel} 配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row">
        <span className="test-config-label">浏览器配置：</span>
        <span className="test-config-value">{browserInfo.displayName}</span>
      </div>
      <div className="test-single-row">
        <span className="test-config-label">平　　台：</span>
        <PlatformToggle value={props.platform} onChange={props.setPlatform} />
      </div>
      <div className="test-actions">
        <button className="test-start-btn" onClick={run} disabled={running}>
          {running ? "清理中..." : "▶ 登录 Temu 并关闭弹窗"}
        </button>
      </div>
    </div>
  );
}

// ── 骨架 3：获取店铺列表 ──
function TemuGetShopsSection(props: TemuSectionCtx) {
  const [mode, setMode] = useState<"visible" | "background">("visible");
  const [running, setRunning] = useState(false);
  const browserInfo = useTemuBrowserInfo(props);
  const platformLabel = PLATFORM_LABEL[props.platform];

  const run = async () => {
    if (!browserInfo) { props.log(`请先在「设置 → 当前自动化设置」中为 temu${platformLabel} 配置浏览器`, "error"); return; }
    setRunning(true);
    props.log(`━━━ 开始 Temu ${platformLabel} 获取店铺 ━━━`, "step");
    props.log(`使用 ${browserInfo.displayName}`, "step");
    props.log("正在启动浏览器并连接 CDP...", "step");
    try {
      const r = await testTemuGetShops({
        exePath: browserInfo.exePath,
        browserType: browserInfo.bt,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        platform: props.platform,
        headless: mode === "background",
      });
      logResult(props, r);
      props.log("━━━ 获取店铺完成 ━━━", "step");
    } catch (e: any) {
      props.log(`获取店铺失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为 temu{platformLabel} 配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row">
        <span className="test-config-label">浏览器配置：</span>
        <span className="test-config-value">{browserInfo.displayName}</span>
      </div>
      <div className="test-single-row">
        <span className="test-config-label">平　　台：</span>
        <PlatformToggle value={props.platform} onChange={props.setPlatform} />
      </div>
      <div className="test-single-row">
        <span className="test-config-label">运行模式：</span>
        <ModeToggle value={mode} onChange={setMode} />
      </div>
      <div className="test-actions">
        <button className="test-start-btn" onClick={run} disabled={running}>
          {running ? "获取中..." : "▶ 登录 Temu 并获取店铺"}
        </button>
      </div>
    </div>
  );
}

// ── 骨架 4：切换店铺 ──
function TemuSwitchShopSection(props: TemuSectionCtx) {
  const [shops, setShops] = useState<any[]>([]);
  const [targetMallName, setTargetMallName] = useState("");
  const [running, setRunning] = useState(false);
  const browserInfo = useTemuBrowserInfo(props);
  const platformLabel = PLATFORM_LABEL[props.platform];

  // 加载缓存店铺列表
  useEffect(() => {
    loadTemuCachedShops().then((cache) => {
      const list = cache?.[props.platform === "gz" ? "gz_shops" : "hk_shops"] || [];
      setShops(list);
      if (list.length > 0) setTargetMallName(list[0].mall_name);
    }).catch(() => setShops([]));
  }, [props.platform]);

  const run = async () => {
    if (!browserInfo) { props.log(`请先在「设置 → 当前自动化设置」中为 temu${platformLabel} 配置浏览器`, "error"); return; }
    if (!targetMallName) { props.log("请选择目标店铺", "error"); return; }
    setRunning(true);
    props.log(`使用 ${browserInfo.displayName} 切换到店铺: ${targetMallName}`, "step");
    props.log(`平台: ${platformLabel}`, "info");
    props.log(`目标店铺: ${targetMallName}`, "info");
    try {
      const r = await testTemuSwitchShop({
        exePath: browserInfo.exePath,
        browserType: browserInfo.bt,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        platform: props.platform,
        targetMallName,
      });
      logResult(props, r);
    } catch (e: any) {
      props.log(`切换失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为 temu{platformLabel} 配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row">
        <span className="test-config-label">浏览器配置：</span>
        <span className="test-config-value">{browserInfo.displayName}</span>
      </div>
      <div className="test-single-row">
        <span className="test-config-label">平　　台：</span>
        <PlatformToggle value={props.platform} onChange={props.setPlatform} />
      </div>
      <div className="test-single-row">
        <span className="test-config-label">目标店铺：</span>
        <CustomSelect
          options={shops.map((s: any) => ({
            key: s.mall_name,
            displayName: s.alias ? `${s.alias}（${s.mall_name}）` : s.mall_name,
          }))}
          value={targetMallName}
          onChange={v => setTargetMallName(v ?? "")}
          placeholder="选择目标店铺..."
        />
      </div>
      <div className="test-actions">
        <button className="test-start-btn" onClick={run} disabled={running}>
          {running ? "切换中..." : "▶ 切换到该店铺"}
        </button>
      </div>
    </div>
  );
}

// ── 骨架 5：左侧路由导航 ──
function TemuNavigateSection(props: TemuSectionCtx) {
  const [running, setRunning] = useState(false);
  const browserInfo = useTemuBrowserInfo(props);
  const platformLabel = PLATFORM_LABEL[props.platform];

  // 预定义路由
  const ROUTES = [
    { label: "备货管理 > 我的备货单", menu1: "备货管理", menu2: "我的备货单" },
    { label: "商品管理 > 商品列表", menu1: "商品管理", menu2: "商品列表" },
    { label: "质量管理 > 商品品质看板", menu1: "质量管理", menu2: "商品品质看板" },
    { label: "账户资金 > 对账中心", menu1: "账户资金", menu2: "对账中心" },
    { label: "账户资金 > 资金中心", menu1: "账户资金", menu2: "资金中心" },
  ];
  const [routeIdx, setRouteIdx] = useState(0);

  const run = async () => {
    if (!browserInfo) { props.log(`请先在「设置 → 当前自动化设置」中为 temu${platformLabel} 配置浏览器`, "error"); return; }
    const route = ROUTES[routeIdx];
    setRunning(true);
    props.log(`使用 ${browserInfo.displayName} 导航到: ${route.menu1} > ${route.menu2}`, "step");
    props.log(`平台: ${platformLabel}`, "info");
    try {
      const r = await testTemuNavigateMenu({
        exePath: browserInfo.exePath,
        browserType: browserInfo.bt,
        profileId: browserInfo.pid,
        userDataDir: browserInfo.udDir,
        platform: props.platform,
        menu1: route.menu1,
        menu2: route.menu2,
      });
      logResult(props, r);
    } catch (e: any) {
      props.log(`导航失败: ${e}`, "error");
    }
    setRunning(false);
  };

  if (!browserInfo) {
    return <div className="test-empty">请先在「设置 → 当前自动化设置」中为 temu{platformLabel} 配置浏览器</div>;
  }

  return (
    <div className="test-single-config">
      <div className="test-single-row">
        <span className="test-config-label">浏览器配置：</span>
        <span className="test-config-value">{browserInfo.displayName}</span>
      </div>
      <div className="test-single-row">
        <span className="test-config-label">平　　台：</span>
        <PlatformToggle value={props.platform} onChange={props.setPlatform} />
      </div>
      <div className="test-single-row">
        <span className="test-config-label">目标路由：</span>
        <CustomSelect
          options={ROUTES.map((r, i) => ({ key: String(i), displayName: r.label }))}
          value={String(routeIdx)}
          onChange={v => setRouteIdx(Number(v))}
          placeholder="选择路由..."
        />
      </div>
      <div className="test-actions">
        <button className="test-start-btn" onClick={run} disabled={running}>
          {running ? "导航中..." : "▶ 导航到该页面"}
        </button>
      </div>
    </div>
  );
}

// ── 测试面板主组件（分栏布局：左侧测试模块 / 右侧可拖拽日志栏） ──
export function TemuTestPanel(props: TemuTestPanelProps) {
  const logCtx = useLog({ eventName: null, storageKey: "test:log:temu" });
  const [logWidth, setLogWidth] = useState(28);
  const [platform, setPlatform] = useState<TemuPlatform>("gz");

  const clearLog = useCallback(() => logCtx.clear(), [logCtx]);

  const sectionProps: PlatformTestCtx = {
    browsers: props.browsers,
    cachedProfiles: props.cachedProfiles,
    configExePaths: props.configExePaths,
    platformSelections: props.platformSelections,
    log: logCtx.log,
  };
  const temuCtx: TemuSectionCtx = { ...sectionProps, platform, setPlatform };

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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
          <span>Temu 功能测试</span>
        </div>
        <TestSection title="1. Temu 自动登录"><TemuAutoLoginSection {...temuCtx} /></TestSection>
        <TestSection title="2. Temu 弹窗清理"><TemuClosePopupsSection {...temuCtx} /></TestSection>
        <TestSection title="3. Temu 获取店铺列表"><TemuGetShopsSection {...temuCtx} /></TestSection>
        <TestSection title="4. Temu 切换店铺"><TemuSwitchShopSection {...temuCtx} /></TestSection>
        <TestSection title="5. Temu 左侧路由导航"><TemuNavigateSection {...temuCtx} /></TestSection>
        {props.extraSections?.map(s => (
          <TestSection key={s.title} title={s.title}>{s.content(sectionProps)}</TestSection>
        ))}
      </div>
    </TestPageLayout>
  );
}
