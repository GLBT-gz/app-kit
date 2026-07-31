import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { AppConfig } from "./types";

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

/** 获取应用数据目录路径 */
export async function getDataDirectory(): Promise<string> {
  return tauriInvoke("get_data_directory");
}

/** 获取安装目录路径 */
export async function getInstallDirectory(): Promise<string> {
  return tauriInvoke("get_install_directory");
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
