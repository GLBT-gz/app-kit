import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { AppConfig, BrowserInfo, LaunchInfo, PortEntry, BrowserProcessState, BrowserTestParams, BrowserTestResult } from "./types";

// ── 插件命令前缀 ──
const PLUGIN_PREFIX = "plugin:appkit-core|";

/**
 * 带诊断提示的插件命令调用
 *
 * 当命令未找到时，在控制台输出清晰的排查指引，
 * 避免"Command xxx not found"这种难以定位的错误。
 */
async function pluginInvoke<T>(cmdName: string, args?: Record<string, unknown>): Promise<T> {
  const fullCmd = PLUGIN_PREFIX + cmdName;
  try {
    return await tauriInvoke<T>(fullCmd, args);
  } catch (e: unknown) {
    if (String(e).includes("not found")) {
      console.error(
        `[api] 命令未找到: "${fullCmd}"\n` +
        `  请检查以下可能原因:\n` +
        `    1. Rust 端 tauri_bridge.rs 的 generate_handler! 中是否包含该命令\n` +
        `    2. 项目 build.rs 的 commands 列表中是否包含该命令\n` +
        `    3. capabilities/default.json 中是否有对应权限 (appkit-core:allow-xxx)\n` +
        `    4. 是否重新编译了 Rust 后端 (pnpm tauri dev 会自动触发 cargo build)\n` +
        `    5. 命令名拼写是否有误`
      );
    }
    throw e;
  }
}

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

// ── 紫鸟 app.asar patch（000 应用注册的命令） ──

/** 检测紫鸟 app.asar 是否已打 v10.8 patch */
export async function ziniaoPatchStatus(): Promise<{
  installed: boolean;
  asar_path: string;
  patched: boolean;
  main_index_len: number;
  detail: string;
}> {
  return tauriInvoke("ziniao_patch_status");
}

/** 一键打补丁（重打包 + 提权覆盖，会弹 UAC） */
export async function ziniaoPatchApply(): Promise<string> {
  return tauriInvoke("ziniao_patch_apply");
}

// ── 紫鸟 CDP 批量管理（000 应用注册的命令，需 v10.8 patch） ──

/** 紫鸟标签页 */
export interface ZiniaoTab {
  id: string;
  title: string;
  url: string;
}

/** 紫鸟环境实时状态 */
export interface ZiniaoEnvStatus {
  container_id: string;
  port: number;
  user_data_dir: string;
  pid: number;
  browser: string;
  tabs: ZiniaoTab[];
}

/** 批量执行 JS 的单条结果 */
export interface ZiniaoEvalResult {
  port: number;
  container_id: string;
  value: unknown;
}

/** 列出所有运行中紫鸟环境（含标签页） */
export async function ziniaoListEnvs(): Promise<ZiniaoEnvStatus[]> {
  return tauriInvoke("ziniao_list_envs");
}

/** 列出指定端口环境的标签页 */
export async function ziniaoListTabs(port: number): Promise<ZiniaoTab[]> {
  return tauriInvoke("ziniao_list_tabs", { port });
}

/** 在指定环境新建标签页并导航 */
export async function ziniaoOpenTab(port: number, url: string): Promise<string> {
  return tauriInvoke("ziniao_open_tab", { port, url });
}

/** 指定环境第一个页面标签页导航 */
export async function ziniaoNavigate(port: number, url: string): Promise<void> {
  return tauriInvoke("ziniao_navigate", { port, url });
}

/** 指定环境执行 JS */
export async function ziniaoEval(port: number, js: string): Promise<unknown> {
  return tauriInvoke("ziniao_eval", { port, js });
}

/** 所有运行中环境批量执行 JS */
export async function ziniaoEvalAll(js: string): Promise<ZiniaoEvalResult[]> {
  return tauriInvoke("ziniao_eval_all", { js });
}

/** 指定环境截图，返回 PNG base64 */
export async function ziniaoScreenshot(port: number): Promise<string> {
  return tauriInvoke("ziniao_screenshot", { port });
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
