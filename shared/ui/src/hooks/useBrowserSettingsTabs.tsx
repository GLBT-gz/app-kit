import { useCallback, useMemo } from "react";
import type { SettingsTab } from "../components/AppLayout";
import { BrowserConfigSection } from "../components/BrowserConfigSection";
import { CurrentBrowserCards } from "../components/CurrentBrowserCards";
import type { BCPProfile } from "../components/BrowserConfigPanel";
import { detectCustomProfiles } from "../api";
import { useBrowserBaseData } from "./useBrowserBaseData";
import { toBCPBrowser } from "../utils/browser-mapping";

/** profiles 模式下的选中项（999-Agent 等需要完整 profile 信息的场景） */
export interface SelectedProfile {
  browserType: string;
  name: string;
  userDataDir: string;
  id: string;
}

export interface BrowserSettingsTabsOptions {
  /**
   * 选中态形态：
   * - "keys"（默认）：selectedKeys/onSelectedKeysChange，存 key 字符串数组
   * - "profiles"：selectedProfiles/onSelectedProfilesChange，存完整 profile 对象数组
   * 不传任何选中态 props 时为纯展示（点击卡片无选择行为）
   */
  mode?: "keys" | "profiles";

  // ── keys 模式 ──
  /** 选中的卡片 key 列表（bt|user_data_dir|id） */
  selectedKeys?: string[];
  /** 选中集合变更回调 */
  onSelectedKeysChange?: (keys: string[]) => void;

  // ── profiles 模式 ──
  /** 选中的 profile 对象列表 */
  selectedProfiles?: SelectedProfile[];
  /** 选中集合变更回调 */
  onSelectedProfilesChange?: (next: SelectedProfile[]) => void;

  /** 「全局浏览器配置」tab 上方渲染分隔横线（侧边栏分组用） */
  dividerBefore?: boolean;
}

const BROWSER_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
);

const CURRENT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
);

/**
 * 生成「全局浏览器配置 / 当前浏览器配置」两个公共设置 tab。
 *
 * ## 收敛内容
 * - 浏览器数据获取（内部调用 useBrowserBaseData，项目不再自行解构透传）
 * - detectCustomProfiles 的 version 字段映射包装（此前 13 处逐字重复的内联代码）
 * - tab id/label/icon 与两个组件的 props 组装
 *
 * ## 项目侧用法
 * ```tsx
 * const browserTabs = useBrowserSettingsTabs({
 *   selectedKeys: selectedCardKeys,
 *   onSelectedKeysChange: setSelectedCardKeys,
 * });
 * const tabs: SettingsTab[] = [...browserTabs, /* 项目自有 tab *\/];
 * ```
 */
export function useBrowserSettingsTabs(options: BrowserSettingsTabsOptions = {}): SettingsTab[] {
  const {
    mode,
    selectedKeys,
    onSelectedKeysChange,
    selectedProfiles,
    onSelectedProfilesChange,
    dividerBefore = false,
  } = options;

  const { browsers, exePaths, userDataDirs, loading, updateExePaths, updateUserDataDirs } = useBrowserBaseData();

  // 后端结构归一化（browser_version → version），见 utils/browser-mapping.ts
  const handleDetectProfiles = useCallback(
    (bt: string, exePath: string | null, userDirs: string[]) =>
      detectCustomProfiles(bt, exePath, userDirs).then(toBCPBrowser),
    [],
  );

  const handleSelectionChange = useMemo(() => {
    if (!onSelectedKeysChange && !onSelectedProfilesChange) return undefined;
    if (mode === "profiles") {
      return (_keys: string[], bt: string, p: BCPProfile, selected: boolean) => {
        const cur = selectedProfiles || [];
        const next = selected
          ? [...cur, { browserType: bt, name: p.name, userDataDir: p.user_data_dir, id: p.id }]
          : cur.filter(pp => !(pp.id === p.id && pp.userDataDir === p.user_data_dir && pp.browserType === bt));
        onSelectedProfilesChange?.(next);
      };
    }
    return (keys: string[]) => onSelectedKeysChange?.(keys);
  }, [mode, selectedProfiles, onSelectedProfilesChange, onSelectedKeysChange]);

  const mappedSelectedKeys = useMemo(() => {
    if (mode !== "profiles") return selectedKeys;
    return (selectedProfiles || []).map(p => `${p.browserType}|${p.userDataDir}|${p.id}`);
  }, [mode, selectedKeys, selectedProfiles]);

  return [
    {
      id: "browser",
      label: "全局浏览器配置",
      icon: BROWSER_ICON,
      dividerBefore,
      content: (
        <BrowserConfigSection
          browsers={browsers}
          exePaths={exePaths}
          userDataDirs={userDataDirs}
          loading={loading}
          onExePathsChange={updateExePaths}
          onUserDataDirsChange={updateUserDataDirs}
        />
      ),
    },
    {
      id: "current",
      label: "当前浏览器配置",
      icon: CURRENT_ICON,
      content: (
        <CurrentBrowserCards
          browsers={browsers}
          onDetectProfiles={handleDetectProfiles}
          selectedKeys={mappedSelectedKeys}
          onSelectionChange={handleSelectionChange}
        />
      ),
    },
  ];
}
