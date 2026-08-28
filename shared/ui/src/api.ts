import type { AppConfig, BrowserInfo, LaunchInfo, PortEntry, BrowserProcessState, BrowserTestParams, BrowserTestResult } from "./types";
import { pluginInvoke, tauriInvoke } from "./tauri-utils";

/** 在资源管理器中打开目录 */
export async function openDir(path: string): Promise<string> {
  return pluginInvoke("open_directory", { path });
}

/** 检查路径是否存在 */
export async function checkPathExists(path: string): Promise<boolean> {
  return pluginInvoke("check_path_exists", { path });
}

/** 加载持久化配置（安全版本，不调用后端） */
export async function loadConfig(): Promise<{ show_history: null }> {
  return { show_history: null };
}

/** 保存持久化配置（安全版本，不调用后端） */
export async function saveConfig(_config: AppConfig): Promise<void> {
  // 不再持久化配置到后端
}

/** 设置窗口置顶 */
export async function setWindowPin(pin: boolean): Promise<void> {
  return tauriInvoke("set_window_pin", { pin });
}

/** 下载安装包到指定路径 */
export async function installVersion(url: string, savePath: string): Promise<string> {
  return tauriInvoke("install_version", { url, savePath });
}

/** 获取应用数据目录路径 */
export async function getDataDirectory(): Promise<string> {
  return pluginInvoke("get_data_directory");
}

/** 获取安装目录路径 */
export async function getInstallDirectory(): Promise<string> {
  return pluginInvoke("get_install_directory");
}

// ── 本地文件读写 ──

/** 批量读取多个本地文件 */
export async function readAllLocalFiles(paths: string[]): Promise<Record<string, string>> {
  return pluginInvoke("read_all_local_files", { paths });
}

/** 数据目录下的文件条目 */
export interface DataFileEntry {
  name: string;
  size: number;
  modified: string;
}

/** 列出 app_data_dir 下所有文件 */
export async function listDataFiles(): Promise<DataFileEntry[]> {
  return pluginInvoke("list_data_files");
}

/** 数据库文件条目 */
export interface DatabaseFileEntry {
  name: string;
  rel_path: string;
  size: number;
  modified: string;
}

/** 列出 app_data_dir 下的所有 .db 数据库文件 */
export async function listDatabaseFiles(): Promise<DatabaseFileEntry[]> {
  return pluginInvoke("list_database_files");
}

/** 数据库表信息 */
export interface DbTableInfo {
  name: string;
  row_count: number;
}

/** 获取数据库文件中的表列表及行数 */
export async function getDbTables(dbRelPath: string): Promise<DbTableInfo[]> {
  return pluginInvoke("get_db_tables", { dbRelPath });
}

/** 清空数据库文件中的指定表 */
export async function clearDbTable(dbRelPath: string, tableName: string): Promise<void> {
  return pluginInvoke("clear_db_table", { dbRelPath, tableName });
}

/** 删除 config_dir 下的指定文件列表 */
export async function deleteDataFiles(files: string[]): Promise<void> {
  return pluginInvoke("delete_data_files", { files });
}

/** 保存 Base64 编码的文件到指定路径 */
export async function saveFile(path: string, dataB64: string): Promise<void> {
  return pluginInvoke("save_file", { path, dataB64 });
}

/** 读取文件并以 Base64 返回（Excel 导入等前端解析场景） */
export async function readFileBase64(path: string): Promise<string> {
  return pluginInvoke("read_file_base64", { path });
}

// ── 浏览器配置管理 ──

/** 检测所有已安装的浏览器（内置 + 注册的自定义浏览器） */
export async function detectBrowsers(): Promise<BrowserInfo[]> {
  return pluginInvoke("detect_browsers");
}

/** 返回当前支持的（已注册）浏览器类型：内置 edge/chrome + 业务项目注册的类型 */
export async function detectBrowserTypes(): Promise<string[]> {
  return pluginInvoke("detect_browser_types");
}

/** 使用自定义路径检测浏览器配置 */
export async function detectCustomProfiles(
  browserType: string,
  customExePath: string | null,
  userDataDirs: string[]
): Promise<BrowserInfo> {
  return pluginInvoke("detect_custom_profiles", {
    browserType,
    customExePath,
    userDataDirs,
  });
}

/** 生成启动命令 */
export async function getLaunchCommand(
  browserType: string,
  profileId: string,
  userDataDir: string,
  debugPort: number
): Promise<LaunchInfo> {
  return pluginInvoke("get_launch_command", {
    browserType,
    profileId,
    userDataDir,
    debugPort,
  });
}

/** 启动浏览器指定配置 */
export async function launchBrowserProfile(
  browserType: string,
  profileId: string,
  userDataDir: string,
  debugPort: number
): Promise<string> {
  return pluginInvoke("launch_browser_profile", {
    browserType,
    profileId,
    userDataDir,
    debugPort,
  });
}

/** 查找可用端口（用于调试启动浏览器） */
export async function findAvailablePort(start: number, end: number): Promise<number> {
  return pluginInvoke("find_available_port", { start, end });
}

/** 杀死指定配置的浏览器进程（调试启动前清理已有实例） */
export async function killBrowserProfileProcess(browserType: string, profileId: string, userDataDir: string): Promise<string> {
  return pluginInvoke("kill_browser_profile_process", { browserType, profileId, userDataDir });
}

/** 杀死指定浏览器的所有进程（Edge → msedge.exe, Chrome → chrome.exe, EDecker → edecker.exe） */
export async function killAllBrowserProcesses(browserType: string): Promise<string> {
  return pluginInvoke("kill_all_browser_processes", { browserType });
}

/** 创建桌面快捷方式 */
export async function createDesktopShortcut(
  browserType: string,
  profileId: string,
  userDataDir: string,
  profileName: string,
  avatarPath: string,
  debugPort: number
): Promise<string> {
  return pluginInvoke("create_desktop_shortcut", {
    browserType,
    profileId,
    userDataDir,
    profileName,
    avatarPath,
    debugPort,
  });
}

/** 创建新的浏览器用户数据目录 */
export async function createNewUserDataDir(
  browserType: string,
  parentDir: string,
  dirName: string
): Promise<string> {
  return pluginInvoke("create_new_user_data_dir", {
    browserType,
    parentDir,
    dirName,
  });
}

/** 检测浏览器调试端口（返回 profile 到端口的映射） */
export async function detectDebugPorts(profiles: { user_data_dir: string; profile_id: string }[]): Promise<PortEntry[]> {
  return pluginInvoke("detect_debug_ports", { profiles: profiles.map(p => [p.user_data_dir, p.profile_id]) });
}

/** 检测浏览器进程运行状态（不分配端口，仅检测是否运行） */
export async function detectBrowserRunningProcesses(profiles: { user_data_dir: string; profile_id: string }[]): Promise<BrowserProcessState[]> {
  return pluginInvoke("detect_browser_running_processes", { profiles: profiles.map(p => [p.user_data_dir, p.profile_id]) });
}

// ── 浏览器自动化测试（000 模板项目专用） ──

/** 批量浏览器自动化测试：启动/连接 → 打开百度 → 获取页面内容前500字符 */
export async function testBrowserAutomation(browsers: BrowserTestParams[]): Promise<BrowserTestResult[]> {
  return tauriInvoke("test_browser_automation", { browsers });
}
