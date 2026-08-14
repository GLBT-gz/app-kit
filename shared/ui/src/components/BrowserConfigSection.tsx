import { useState, useEffect, useCallback, useMemo, memo, startTransition } from "react";
import { BrowserConfigPanel, type BCPBrowser } from "./BrowserConfigPanel";
import { detectCustomProfiles, getLaunchCommand, launchBrowserProfile, openDir, checkPathExists, createNewUserDataDir, createDesktopShortcut } from "../api";
import { open } from "@tauri-apps/plugin-dialog";
import { safeGetJSON } from "../localStorageKeys";
import { useBrowserStore, refreshBrowserData } from "../data/browserStore";

export interface BrowserConfigSectionProps {
  /** 浏览器列表（来自 useBrowserBaseData，已是最终检测结果） */
  browsers: BCPBrowser[];
  /** 浏览器可执行路径配置 */
  exePaths: Record<string, string>;
  /** 浏览器用户数据目录配置 */
  userDataDirs: Record<string, string[]>;
  /** 浏览器数据是否正在加载 */
  loading: boolean;
  /**
   * exePaths 变更回调。
   * 接受 SetStateAction，由 useBrowserBaseData 的 updateExePaths 提供。
   * 该方法同时更新 state 和 localStorage。
   */
  onExePathsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /**
   * userDataDirs 变更回调。
   * 接受 SetStateAction，由 useBrowserBaseData 的 updateUserDataDirs 提供。
   * 该方法同时更新 state 和 localStorage。
   */
  onUserDataDirsChange: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}

/**
 * 浏览器配置展示组件（全局浏览器配置页）。
 *
 * ## 按需检测
 * - 挂载时调用 refreshBrowserData()：进入本页面才触发一次后端检测
 *   （应用启动不检测，见 browserStore 的更新协议）
 * - 检测中侧边栏图标转圈；「重新检测」按钮由 BrowserConfigPanel
 *   在侧边栏顶部渲染（整批检测全部浏览器）
 */
function BrowserConfigSection({
  browsers,
  exePaths,
  userDataDirs,
  onExePathsChange,
  onUserDataDirsChange,
}: BrowserConfigSectionProps) {
  // ── 单一数据源订阅：检测中状态（侧边栏图标转圈 + 按钮禁用） ──
  const { loading } = useBrowserStore();

  // ── 按需检测：进入全局配置页才触发（in-flight 去重，并发挂载只检测一次） ──
  useEffect(() => {
    refreshBrowserData();
  }, []);

  // ── 本地 UI 状态：选中的浏览器类型标签 ──
  const [activeBrowser, setActiveBrowser] = useState<string | null>(null);

  // 当浏览器列表就绪且未选中时，自动选第一个
  useEffect(() => {
    if (browsers.length > 0 && !activeBrowser) {
      const saved = safeGetJSON<string | null>("core-active-browser-tab");
      setActiveBrowser(saved || browsers[0].browser_type);
    }
  }, [browsers, activeBrowser]);

  const mappedBrowsers: BCPBrowser[] = useMemo(() => browsers.map(b => ({
    ...b,
    version: (b as any).browser_version,
  })), [browsers]);

  const handleBrowseFile = useCallback(async () => {
    const result = await open({
      title: "选择浏览器可执行文件",
      filters: [{ name: "可执行文件", extensions: ["exe"] }],
      multiple: false,
      directory: false,
    });
    return result || null;
  }, []);

  const handleBrowseDirectory = useCallback(async () => {
    const result = await open({
      title: "选择用户数据目录",
      multiple: true,
      directory: true,
    });
    return result || null;
  }, []);

  const handleDetectProfiles = useCallback(async (
    browserType: string,
    exePath: string | null,
    userDirs: string[],
  ): Promise<BCPBrowser> => {
    const result = await detectCustomProfiles(browserType, exePath, userDirs);
    return { ...result, version: result.browser_version } as unknown as BCPBrowser;
  }, []);

  /**
   * 滚轮切换时用 startTransition 降低优先级，避免频繁 setState
   * 与 BrowserConfigPanel 的 RAF 节流产生冲突导致切换失效。
   */
  const handleActiveBrowserTypeChange = useCallback((bt: string | null) => {
    if (bt === null) return;
    startTransition(() => {
      setActiveBrowser(bt);
    });
  }, []);

  /** 手动重新检测全部浏览器 */
  const handleRefresh = useCallback(() => {
    refreshBrowserData();
  }, []);

  return (
    <BrowserConfigPanel
      browsers={mappedBrowsers}
      activeBrowserType={activeBrowser}
      onActiveBrowserTypeChange={handleActiveBrowserTypeChange}
      exePaths={exePaths}
      onExePathsChange={onExePathsChange}
      userDataDirs={userDataDirs}
      onUserDataDirsChange={onUserDataDirsChange}
      onCheckPath={checkPathExists}
      onOpenDir={openDir}
      onBrowseFile={handleBrowseFile}
      onBrowseDirectory={handleBrowseDirectory}
      onDetectProfiles={handleDetectProfiles}
      refreshing={loading}
      onRefreshAll={handleRefresh}
      onLaunchProfile={launchBrowserProfile}
      onGetLaunchCommand={getLaunchCommand}
      onCreateUserDataDir={createNewUserDataDir}
      onCreateShortcut={createDesktopShortcut}
    />
  );
}

const BrowserConfigSectionMemo = /* @__PURE__ */ memo(BrowserConfigSection);
export default BrowserConfigSectionMemo;
export { BrowserConfigSectionMemo as BrowserConfigSection };
