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
} from "./api";
export type { DataFileEntry, DatabaseFileEntry, DbTableInfo } from "./api";
export { isTauriRuntime } from "./tauri-utils";

// ── 紫鸟自动化 API（独立模块，保持 api.ts 中性） ──
export {
  ziniaoPatchStatus,
  ziniaoPatchApply,
  ziniaoListEnvs,
  ziniaoListTabs,
  ziniaoOpenTab,
  ziniaoNavigate,
  ziniaoActivate,
  ziniaoEnterShop,
  ziniaoEval,
  ziniaoEvalAll,
  ziniaoScreenshot,
  ziniaoAgentLaunch,
  ziniaoAgentStatus,
  ziniaoAgentProcStatus,
  ziniaoAgentBrowserList,
  ziniaoAgentStartBrowser,
  ziniaoAgentCdpPort,
  ziniaoAgentRunning,
  ziniaoAgentClose,
  ziniaoParseSidebar,
  ziniaoSwitchMenu,
  ziniaoSamplePrepare,
  ziniaoSampleFetchTab,
  ZINIAO_SAMPLE_TABS,
  crossBrowserStart,
  crossBrowserLoginCheck,
  crossBrowserClose,
} from "./ziniao-api";
export type { ZiniaoTab, ZiniaoEnvStatus, ZiniaoEvalResult } from "./ziniao-api";
export type { ZiniaoAgentBrowser, ZiniaoAgentStatus } from "./ziniao-api";
export type { ZiniaoSidebarItem, ZiniaoSidebarGroup, ZiniaoSidebarParse, ZiniaoSwitchMenuResult } from "./ziniao-api";
export type { ZiniaoSampleRow, ZiniaoTabFetchResult, ZiniaoSamplePrepare } from "./ziniao-api";
export type { CrossStart, CrossLoginStatus } from "./ziniao-api";

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
export { ShopListPanel } from "./components/ShopListPanel";
export type { ShopListPanelProps, ShopListShop } from "./components/ShopListPanel";
export { ClearButton } from "./components/ClearButton";
export { LogPanel, useLog } from "./components/LogPanel";
export type { LogLevel, LogTable, LogEntry, UseLogReturn, LogPanelProps } from "./components/LogPanel";
export { TestSection, TestPageLayout } from "./components/TestLayout";
export type { TestSectionProps, TestPageLayoutProps } from "./components/TestLayout";
export { SheetTable } from "./components/SheetTable";
export type { SheetTableProps } from "./components/SheetTable";
export { ViewToggle } from "./components/ViewToggle";
export type { ViewToggleProps, ViewToggleItem } from "./components/ViewToggle";
export { BrowserConfigBar } from "./components/BrowserConfigBar";
export { CustomSelect, CustomMultiSelect, MultiSelect } from "./components/CustomSelect";
export type { CustomSelectOption } from "./components/CustomSelect";
export { ModeSwitch } from "./components/ModeSwitch";
export type { ModeSwitchProps } from "./components/ModeSwitch";
export { CredentialsForm } from "./components/CredentialsForm";
export type { CredentialField, CredentialGroup, CredentialsFormProps } from "./components/CredentialsForm";
export {
  useTableSelectionCopy,
  toText,
  VirtualTable,
  DataTable,
  MemoDataTable,
} from "./components/table";
export type { TableColumn } from "./components/table";
export { HomePage } from "./components/HomePage";
export type { HomePageCard, HomePageProps } from "./components/HomePage";

// ── 基础控件（controls/，主题变量样式） ──
export { Button } from "./components/controls/Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./components/controls/Button";
export { TextInput, NumberInput, TextArea } from "./components/controls/TextInput";
export { Select } from "./components/controls/Select";
export { Checkbox, Radio } from "./components/controls/Checkbox";
export { Switch } from "./components/controls/Switch";
export { Field } from "./components/controls/Field";

// ── 日志助手（统一后端进度事件 → UI 日志级别） ──
export { toLogLevel, logResultLines } from "./log";
export type { ProgressPayload } from "./log";

// Hooks（浏览器配置）
export { useBrowserBaseData } from "./hooks/useBrowserBaseData";
export type { BrowserBaseData } from "./hooks/useBrowserBaseData";
export { usePlatformOptions } from "./hooks/usePlatformOptions";
export { usePlatformSelections } from "./hooks/usePlatformSelections";
export { useBrowserProfilesCache } from "./hooks/useBrowserProfilesCache";
export { useWheelTabSwitch } from "./hooks/useWheelTabSwitch";
export { useZiniaoAgent } from "./hooks/useZiniaoAgent";
export type { UseZiniaoAgentReturn, ZnLogFn, SetShopState } from "./hooks/useZiniaoAgent";

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

export { ContextMenu, openContextMenu, CTX_MENU_EVENT } from "./components/ContextMenu";
export type { ContextMenuItem } from "./components/ContextMenu";

// ── 紫鸟自动化 ──
export { ZiniaoStoreList } from "./components/ziniao/ZiniaoStoreList";
export type { ZiniaoStoreListProps } from "./components/ziniao/ZiniaoStoreList";
export { ZiniaoTestPanel } from "./components/ziniao/ZiniaoTestPanel";
export type { ZiniaoPatchInfo } from "./components/ziniao/ZiniaoTestPanel";
