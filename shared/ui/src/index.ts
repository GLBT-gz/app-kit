// 框架级数据注册（模块加载时自动注册到 DataManager）
import "./data/framework";

// Types
export type { AppConfig, ThemeConfig, AppData } from "./types";

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
} from "./api";
export type { DataFileEntry, DatabaseFileEntry, DbTableInfo } from "./api";

// Components
export { AppLayout } from "./components/AppLayout";
export type { AppLayoutProps, SettingsTab } from "./components/AppLayout";
export { TopBar } from "./components/TopBar";
export { SettingsSidebar } from "./components/SettingsSidebar";
export { AboutPanel } from "./components/AboutPanel";
export { ShortcutsPanel, getEffectiveShortcuts } from "./components/ShortcutsPanel";
export { TabBar } from "./components/TabBar";
export type { TabItem } from "./components/TabBar";
export { ClearButton } from "./components/ClearButton";
export { LogPanel, useLog } from "./components/LogPanel";
export type { LogLevel, LogTable, LogEntry, UseLogReturn, LogPanelProps } from "./components/LogPanel";
export { HomePage } from "./components/HomePage";
export type { HomePageCard, HomePageProps } from "./components/HomePage";

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
