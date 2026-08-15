// 框架级数据注册（模块加载时自动注册到 DataManager）
import "./data/framework";

// Types
export type { AppConfig, ThemeConfig, AppData, BrowserInfo, LaunchInfo, DirDiagnostic, PortEntry, BrowserProcessState, BrowserTestParams, BrowserTestResult, ProfileInfo, ChildBrowserConfig, BrowserConfig, ProfileEntry } from "./types";

// API
export {
  openDir,
  checkPathExists,
  loadConfig,
  saveConfig,
  setWindowPin,
  installVersion,
  getDataDirectory,
  getInstallDirectory,
  readAllLocalFiles,
  listDataFiles,
  listDatabaseFiles,
  getDbTables,
  clearDbTable,
  deleteDataFiles,
  saveFile,
  detectBrowsers,
  detectCustomProfiles,
  getLaunchCommand,
  launchBrowserProfile,
  createDesktopShortcut,
  createNewUserDataDir,
  detectDebugPorts,
  detectBrowserRunningProcesses,
  testBrowserAutomation,
  ziniaoPatchStatus,
  ziniaoPatchApply,
  ziniaoListEnvs,
  ziniaoListTabs,
  ziniaoOpenTab,
  ziniaoNavigate,
  ziniaoEval,
  ziniaoEvalAll,
  ziniaoScreenshot,
  ziniaoAgentLaunch,
  ziniaoAgentStatus,
  ziniaoAgentBrowserList,
  ziniaoAgentStartBrowser,
  ziniaoAgentCdpPort,
  ziniaoAgentRunning,
  ziniaoAgentClose,
} from "./api";
export type { DataFileEntry, DatabaseFileEntry, DbTableInfo } from "./api";
export type { ZiniaoTab, ZiniaoEnvStatus, ZiniaoEvalResult } from "./api";
export type { ZiniaoAgentBrowser, ZiniaoAgentStatus } from "./api";
export { isTauriRuntime } from "./api";

// Components
export { AppLayout } from "./components/AppLayout";
export type { AppLayoutProps, SettingsTab } from "./components/AppLayout";
export { BrowserConfigPanel } from "./components/BrowserConfigPanel";
export type { BrowserConfigPanelProps, BCPBrowser, BCPProfile } from "./components/BrowserConfigPanel";
export { BrowserConfigSection } from "./components/BrowserConfigSection";
export type { BrowserConfigSectionProps } from "./components/BrowserConfigSection";
export { TopBar } from "./components/TopBar";
export { SettingsSidebar } from "./components/SettingsSidebar";
export { AboutPanel } from "./components/AboutPanel";
export { ShortcutsPanel, getEffectiveShortcuts } from "./components/ShortcutsPanel";
export { CurrentBrowserCards } from "./components/CurrentBrowserCards";
export type { LaunchStatus, ConnectionStatus } from "./components/CurrentBrowserCards";
export { LAUNCH_LABELS, CONNECTION_LABELS } from "./components/CurrentBrowserCards";
export { TabBar } from "./components/TabBar";
export type { TabItem } from "./components/TabBar";
export { ClearButton } from "./components/ClearButton";
export { LogPanel, useLog } from "./components/LogPanel";
export type { LogLevel, LogTable, LogEntry, UseLogReturn, LogPanelProps } from "./components/LogPanel";
export { HomePage } from "./components/HomePage";
export type { HomePageCard, HomePageProps } from "./components/HomePage";

// Hooks（浏览器配置）
export { useBrowserBaseData } from "./hooks/useBrowserBaseData";
export type { BrowserBaseData } from "./hooks/useBrowserBaseData";
export { usePlatformOptions } from "./hooks/usePlatformOptions";
export { usePlatformSelections } from "./hooks/usePlatformSelections";
export { useBrowserProfilesCache } from "./hooks/useBrowserProfilesCache";
export { useWheelTabSwitch } from "./hooks/useWheelTabSwitch";

// 工具
export {
  LS_KEYS,
  safeSetItem,
  safeGetItem,
  safeGetJSON,
  safeSetJSON,
  safeRemoveJSON,
  clearAllAppkitCache,
} from "./localStorageKeys";
export { populateBrowserIcons, getBrowserIcon, stripBrowserCache } from "./utils/browser-icons";

// 数据管理
export { DataManagerPanel } from "./components/DataManagerPanel";
export { DatabaseStorage } from "./components/DatabaseStorage";

// 数据注册
export {
  defineDataStore,
  useData,
  getGroupedDataItems,
  getRegisteredFrontendKeys,
  getRegisteredBackendFiles,
  getAllRegisteredItems,
  isLocalStorageKeyRegistered,
  registerDataItems,
  registerRawDataItem,
  ensureDataDefaults,
  registerDbSelect,
  registerDbExecute,
} from "./data";
export type {
  StorageBackend,
  DeleteBehavior,
  DataCategoryDef,
  FrontendItemDef,
  FileItemDef,
  DbItemDef,
  AnyItemDef,
  DataStoreDef,
  DataKeyRef,
  FileKeyRef,
  DbKeyRef,
  RegisteredDataItem,
} from "./data";

// ── 平台-浏览器绑定 ──
export {
  PlatformConfigPanel,
  PlatformProfileSelector,
  registerPlatforms,
  getRegisteredPlatforms,
} from "./components/PlatformConfigPanel";
export type { PlatformDef, BrowserOption, PlatformConfigPanelProps } from "./components/PlatformConfigPanel";

// ── 自动化设置 ──
export { AutomationSettings } from "./components/AutomationSettings";
export type { AutomationSettingsProps } from "./components/AutomationSettings";

// ── 紫鸟自动化 ──
export { ZiniaoStoreList } from "./components/ziniao/ZiniaoStoreList";
export type { ZiniaoStoreListProps } from "./components/ziniao/ZiniaoStoreList";
export { ZiniaoOpsPanel } from "./components/ziniao/ZiniaoOpsPanel";
export { ZiniaoTestPanel } from "./components/ziniao/ZiniaoTestPanel";
export type { ZiniaoPatchInfo } from "./components/ziniao/ZiniaoTestPanel";
