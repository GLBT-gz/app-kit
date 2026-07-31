import { useState, useCallback } from "react";
import {
  setWindowPin,
  AppLayout,
  ShortcutsPanel,
  AboutPanel,
  DataManagerPanel,
  TabBar,
  useData,
} from "@appkit/ui";
import type { SettingsTab, TabItem } from "@appkit/ui";
import { store } from "./data";
import "@appkit/ui/styles/index.css";
import "./App.css";

function App() {
  // ── 主页标签页 ──
  const HOME_TABS: TabItem[] = [
    { id: "home", label: "首页" },
  ];

  const [activeHomeTab, setActiveHomeTab] = useData(store.keys["active-tab"]);

  // ── 设置面板打开状态（打开时禁止标签页切换） ──
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 顶栏标签页 ──
  const tabBar = (
    <TabBar
      tabs={HOME_TABS}
      activeTab={activeHomeTab}
      onTabChange={setActiveHomeTab}
      disabled={settingsOpen}
    />
  );

  const handleTopBarWheel = useCallback((e: React.WheelEvent) => {
    if (settingsOpen) return;
    const idx = HOME_TABS.findIndex(t => t.id === activeHomeTab);
    if (e.deltaY > 0) {
      if (idx < HOME_TABS.length - 1) setActiveHomeTab(HOME_TABS[idx + 1].id);
    } else {
      if (idx > 0) setActiveHomeTab(HOME_TABS[idx - 1].id);
    }
  }, [activeHomeTab, settingsOpen]);

  // ── 设置面板（数据管理、快捷键、关于） ──
  const tabs: SettingsTab[] = [
    {
      id: "data-management",
      label: "数据管理",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>,
      content: <DataManagerPanel appName="AppKit 模板" />,
    },
    {
      id: "shortcuts",
      label: "快捷键",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h.01M10 16h.01M12 16h.01" /></svg>,
      content: <ShortcutsPanel />,
    },
    {
      id: "about",
      label: "关于",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>,
      content: <AboutPanel appId="template" appName="AppKit 模板" />,
    },
  ];

  return (
    <AppLayout
      tabBar={tabBar}
      onTopBarWheel={handleTopBarWheel}
      onSetWindowPin={setWindowPin}
      onSettingsChange={setSettingsOpen}
      settingsTabs={tabs}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 40px", height: "100%", boxSizing: "border-box" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700 }}>AppKit 模板</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", textAlign: "center", maxWidth: 500 }}>
          AppKit 桌面应用基础模板，用于快速创建新项目。
        </p>
      </div>
    </AppLayout>
  );
}

export default App;
