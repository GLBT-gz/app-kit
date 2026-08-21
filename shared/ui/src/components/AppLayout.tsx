import { useState, useEffect, useCallback, useRef } from "react";
import { TopBar } from "./TopBar";
import { SettingsSidebar } from "./SettingsSidebar";
import { getEffectiveShortcuts, type ShortcutDef } from "./ShortcutsPanel";
import { safeGetJSON, safeSetJSON, LS_KEYS } from "../localStorageKeys";
import { ensureDataDefaults } from "../data";

export interface SettingsTab {
  id: string;
  label: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

export interface AppLayoutProps {
  /** 主内容区（设置面板关闭时显示） */
  children?: React.ReactNode;
  /** 设置面板标签页列表 */
  settingsTabs?: SettingsTab[];
  /** 默认选中的标签页 ID，默认取第一个 */
  defaultSettingsTab?: string;
  /** 设置侧边栏初始宽度 */
  settingsSidebarWidth?: number;
  /** 设置面板打开/关闭状态变更回调 */
  onSettingsChange?: (open: boolean) => void;
  /** 窗口置顶 Tauri API 调用（默认无操作） */
  onSetWindowPin?: (pin: boolean) => Promise<void>;
  /** 项目注册的额外快捷键：显示在快捷键面板并参与按键分发，onTrigger 为触发动作 */
  registeredShortcuts?: (ShortcutDef & { onTrigger?: () => void })[];
  /** 顶栏左侧自定义 tab 栏 */
  tabBar?: React.ReactNode;
  /** 顶栏滚轮事件（项目自定义，如切换 tab） */
  onTopBarWheel?: (e: React.WheelEvent) => void;
  /** 外部触发打开设置面板到指定标签页（设为非空值时触发） */
  openSettingsTo?: string | null;
}

/** 从 localStorage 读取主题缓存 */
function loadCachedTheme() {
  try {
    const raw = localStorage.getItem(LS_KEYS.THEME);
    if (!raw) return { mode: "dark" as const, accentHue: 210, pinOnTop: false };
    const parsed = JSON.parse(raw);
    return {
      mode: (parsed.mode === "light" ? "light" : "dark") as "dark" | "light",
      accentHue: typeof parsed.accentHue === "number" ? parsed.accentHue : 210,
      pinOnTop: !!parsed.pinOnTop,
    };
  } catch {
    return { mode: "dark" as const, accentHue: 210, pinOnTop: false };
  }
}

/** 从 localStorage 读取字体选择（默认 Maple Mono，非法值回退默认） */
function loadCachedFont(): string {
  try {
    const raw = localStorage.getItem(LS_KEYS.FONT);
    const parsed = raw ? JSON.parse(raw) : null;
    const f = typeof parsed?.font === "string" ? parsed.font : "";
    return ["maple-cn", "system", "kaiti", "simsun", "yahei"].includes(f) ? f : "maple";
  } catch {
    return "maple";
  }
}

export function AppLayout({
  children,
  settingsTabs = [],
  defaultSettingsTab,
  settingsSidebarWidth: initialSidebarWidth = 14,
  onSettingsChange,
  onSetWindowPin,
  registeredShortcuts,
  tabBar,
  onTopBarWheel,
  openSettingsTo,
}: AppLayoutProps) {
  // ── 确保所有注册的 localStorage 默认值已写入（只在第一次挂载时执行，避免覆盖用户手动清除的数据） ──
  useEffect(() => { ensureDataDefaults(); }, []);

  // ── 从 localStorage 直接读取缓存的主题配置 ──
  const cached = loadCachedTheme();
  const [theme, setTheme] = useState<"dark" | "light">(cached.mode);
  const [accentHue, setAccentHue] = useState(cached.accentHue);
  const [pinOnTop, setPinOnTop] = useState(cached.pinOnTop);
  const [font, setFont] = useState(loadCachedFont);

  // ── 浏览位置：路径数组，如 ['设置','全局浏览器配置'] 或 ['首页'] ──
  const naviPath = safeGetJSON<string[]>(LS_KEYS.NAV_LOCATION) ?? [];

  const [showSettings, setShowSettings] = useState(() => {
    if (naviPath) return naviPath[0] === '设置';
    const page = new URLSearchParams(window.location.search).get("settings");
    return page !== null;
  });
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [settingsTab, setSettingsTab] = useState(() => {
    if (naviPath && naviPath[0] === '设置' && naviPath[1]) {
      const found = settingsTabs.find(t => t.label === naviPath[1]);
      if (found) return found.id;
    }
    return defaultSettingsTab ?? settingsTabs[0]?.id ?? "";
  });
  const [settingsSidebarWidth, setSettingsSidebarWidth] = useState(() => {
    const v = safeGetJSON<number>(LS_KEYS.SIDEBAR_WIDTH);
    if (typeof v !== "number" || Number.isNaN(v)) return initialSidebarWidth;
    // 旧版存的是固定 px（如 175/340，恒 >100），一次性迁移为默认占比；0-100 视为占比直接使用
    return v > 100 ? initialSidebarWidth : v;
  });

  // ── 双状态：sidebarHighlightTab 即时更新，settingsTab 同步渲染 ──
  const [sidebarHighlightTab, setSidebarHighlightTab] = useState(settingsTab);

  // ── 已挂载的标签页集合：页面层叠方案 ──
  // 设置面板打开后，在浏览器空闲时（requestIdleCallback）逐帧预挂载全部标签页
  // （display:none 不可见）。滚轮切换任何 tab 都只是切换可见层（display），
  // 无首次挂载渲染成本；预挂载只发生在空闲间隙，用户滚轮/交互时自动让路。
  const mountedTabsRef = useRef<Set<string>>(new Set([settingsTab]));
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set([settingsTab]));

  // ── 逐帧预挂载未挂载的标签页（层叠）：仅设置面板打开时执行 ──
  useEffect(() => {
    if (!showSettings) return;
    let cancelled = false;
    const ids = resolvedTabs.map(t => t.id);
    const schedule = () => {
      if (cancelled) return;
      const next = ids.find(id => !mountedTabsRef.current.has(id));
      if (!next) return;
      mountedTabsRef.current.add(next);
      setMountedTabs(new Set(mountedTabsRef.current));
      requestIdleCallback(schedule, { timeout: 1500 });
    };
    requestIdleCallback(schedule, { timeout: 1500 });
    return () => { cancelled = true; };
    // resolvedTabs 在设置面板打开期间稳定，仅依赖 showSettings 即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  // ── 主题/置顶变化时持久化到 localStorage ──
  const skipOnce = useRef(true);
  useEffect(() => {
    if (skipOnce.current) { skipOnce.current = false; return; }
    safeSetJSON(LS_KEYS.THEME, { mode: theme, accentHue, pinOnTop });
  }, [theme, accentHue, pinOnTop]);

  // ── 字体选择持久化 ──
  const skipFontOnce = useRef(true);
  useEffect(() => {
    if (skipFontOnce.current) { skipFontOnce.current = false; return; }
    safeSetJSON(LS_KEYS.FONT, { font });
  }, [font]);

  // 字体选择应用到 <html data-font>（theme.css 根据它切换 --font-ui / --font-mono）
  useEffect(() => {
    document.documentElement.setAttribute("data-font", font);
  }, [font]);

  // ── 置顶同步到窗口 ──
  useEffect(() => {
    if (pinOnTop) {
      const timer = setTimeout(() => {
        onSetWindowPin?.(true).catch(() => {});
      }, 300);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 通知外部设置面板开/关
  useEffect(() => { onSettingsChange?.(showSettings); }, [showSettings, onSettingsChange]);

  // 持久化浏览位置到 core-nav-location
  useEffect(() => {
    if (showSettings) {
      const tab = settingsTabs.find(t => t.id === settingsTab);
      if (tab) {
        const existing = safeGetJSON<string[]>(LS_KEYS.NAV_LOCATION) ?? [];
        const navPath: string[] = ['设置', tab.label];
        if (tab.id === 'data-management' && existing.length >= 3 && existing[1] === '数据管理') {
          navPath.push(existing[2]);
        }
        safeSetJSON(LS_KEYS.NAV_LOCATION, navPath);
      } else {
        safeSetJSON(LS_KEYS.NAV_LOCATION, ['设置']);
      }
    } else {
      safeSetJSON(LS_KEYS.NAV_LOCATION, ['首页']);
    }
  }, [showSettings, settingsTab, settingsTabs]);

  // 持久化侧边栏宽度到独立 key
  useEffect(() => {
    safeSetJSON(LS_KEYS.SIDEBAR_WIDTH, settingsSidebarWidth);
  }, [settingsSidebarWidth]);

  // 外部触发打开设置面板到指定标签页
  useEffect(() => {
    if (openSettingsTo) {
      setSidebarHighlightTab(openSettingsTo);
      setSettingsTab(openSettingsTo);
      setShowSettings(true);
    }
  }, [openSettingsTo]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 同步强调色 CSS 变量
  useEffect(() => {
    const isBright = accentHue >= 45 && accentHue <= 165;
    const root = document.documentElement;
    root.style.setProperty("--accent", `hsl(${accentHue}, 95%, 53%)`);
    root.style.setProperty("--accent-hover", `hsl(${accentHue}, 80%, 45%)`);
    root.style.setProperty("--accent-light", `hsla(${accentHue}, 95%, 53%, 0.15)`);
    root.style.setProperty("--btn-text", isBright ? "#111111" : "#ffffff");
  }, [accentHue]);

  const closeSettings = useCallback(() => {
    setSettingsClosing(true);
    setTimeout(() => { setShowSettings(false); setSettingsClosing(false); }, 180);
  }, []);

  // 可配置快捷键处理
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      const key = e.key === "Escape" ? "Esc" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key !== "Control" && key !== "Alt" && key !== "Shift" && key !== "Meta") {
        parts.push(key);
      }
      const combo = parts.join("+");

      if (!combo) return;
      const shortcuts = getEffectiveShortcuts(registeredShortcuts);

      if (combo === shortcuts["toggle-settings"]) {
        e.preventDefault();
        if (showSettings) { closeSettings(); } else { setShowSettings(true); }
        return;
      }

      if (combo === shortcuts["back-to-home"] && showSettings) {
        e.preventDefault();
        closeSettings();
        return;
      }

      if (combo === shortcuts["toggle-pin"]) {
        e.preventDefault();
        setPinOnTop(prev => {
          const next = !prev;
          (onSetWindowPin || (async () => {}))(next).catch(() => {});
          return next;
        });
        return;
      }

      if (combo === shortcuts["toggle-theme"]) {
        e.preventDefault();
        setTheme(t => t === "dark" ? "light" : "dark");
        return;
      }

      // 注册式快捷键分发：项目通过 registeredShortcuts 注册的快捷键
      if (registeredShortcuts) {
        for (const def of registeredShortcuts) {
          if (combo === shortcuts[def.id]) {
            e.preventDefault();
            def.onTrigger?.();
            return;
          }
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSettings, closeSettings, onSetWindowPin, registeredShortcuts]);

  const resolvedTabs = settingsTabs.length > 0
    ? settingsTabs
    : [{ id: "about", label: "关于", icon: <DefaultAboutIcon />, content: <DefaultAboutContent /> }];

  const validSettingsTab = resolvedTabs.some(t => t.id === settingsTab)
    ? settingsTab
    : resolvedTabs[0]?.id || "";

  // ── 标签页切换：高亮与内容同步立即切换（对齐 DataManagerPanel 的层级方案） ──
  // 不包 startTransition：后台检测完成的全量渲染已降为低优先级（见 browserStore），
  // 若此处再降级，主线程忙时内容切换会被排队，表现为高亮已变但内容滞后（卡顿）
  const handleTabChange = useCallback((newId: string) => {
    setSidebarHighlightTab(newId);
    setSettingsTab(newId);
  }, []);

  return (
    <div className="app">
      <TopBar
        showSettings={showSettings}
        onToggleSettings={() => showSettings ? closeSettings() : setShowSettings(true)}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === "dark" ? "light" : "dark")}
        accentHue={accentHue}
        onChangeAccentHue={setAccentHue}
        pinOnTop={pinOnTop}
        onTogglePin={() => setPinOnTop(v => !v)}
        setWindowPin={onSetWindowPin || (async () => {})}
        font={font}
        onChangeFont={setFont}
        tabBar={tabBar}
        onWheel={onTopBarWheel}
      />

      <div className="flex flex-1 min-h-0">
          <div className="page-content" style={{ display: showSettings ? 'none' : undefined }}>
            {children}
          </div>
          <div className={`settings-panel ${settingsClosing ? "closing" : ""}`} style={{ display: showSettings ? undefined : 'none' }}>
            <SettingsSidebar
              tabs={resolvedTabs.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
              activeTab={sidebarHighlightTab}
              onTabChange={handleTabChange}
              sidebarWidth={settingsSidebarWidth}
              onWidthChange={setSettingsSidebarWidth}
            />
            <div className="settings-content">
              {resolvedTabs.map(t => {
                const isMounted = mountedTabs.has(t.id);
                const isActive = t.id === validSettingsTab;
                if (!isMounted && !isActive) return null;
                return (
                  <div
                    key={t.id}
                    style={{
                      display: isActive ? "flex" : "none",
                      flexDirection: "column",
                      flex: 1,
                      minHeight: 0,
                    }}
                  >
                    {t.content}
                  </div>
                );
              })}
              {resolvedTabs.length === 0 && (
                <div className="empty-state">未知设置页面</div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
}

function DefaultAboutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function DefaultAboutContent() {
  return (
    <div className="about-panel">
      <h2 className="about-title">关于 AppKit</h2>
      <div className="about-section">
        <p>AppKit 桌面应用基础模板</p>
      </div>
    </div>
  );
}
