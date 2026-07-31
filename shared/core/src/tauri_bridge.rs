//! Tauri 插件桥接层
//!
//! 将 `shared/core` 中的通用能力打包为 Tauri 插件，
//! 项目只需 `.plugin(appkit_core::tauri_bridge::init())` 即可注册所有通用命令。
//!
//! 包含的命令（均为中性通用能力）：
//! - detect_browsers, detect_custom_profiles, diagnose_directory（浏览器检测）
//! - get_launch_command, launch_browser_profile, create_desktop_shortcut
//! - get_avatar_path, create_new_user_data_dir（浏览器配置）
//! - detect_debug_ports, detect_browser_running_processes, find_available_port
//! - kill_browser_profile_process, kill_all_browser_processes（进程管理）
//! - get_all_data, set_app_theme, set_app_config（主题/配置）
//! - delete_data_files, write_local_file, read_all_local_files
//! - list_data_files, list_database_files（数据文件管理）
//! - open_directory, check_path_exists, get_app_version, save_file（通用工具）

use crate::browser::management;
use crate::config::{AppConfig, AppData, PortEntry, ThemeConfig};
use crate::config::store::SharedAppData;
use serde::Serialize;

// ── 浏览器检测与配置 ──

/// 用户数据目录诊断结果
#[derive(Debug, Serialize)]
pub struct DirDiagnostic {
    pub path: String,
    pub exists: bool,
    pub local_state_exists: bool,
    pub local_state_file_size: u64,
    pub local_state_readable: bool,
    pub has_info_cache: bool,
    pub profile_count: usize,
    pub profile_keys: Vec<String>,
    pub info_cache_keys: Vec<String>,
}

/// 检测所有已安装浏览器（Edge / Chrome）
#[tauri::command]
fn detect_browsers() -> Vec<crate::browser::BrowserInfo> {
    management::detect_all_browsers()
}

/// 根据自定义路径检测浏览器配置
#[tauri::command]
fn detect_custom_profiles(
    browser_type: String,
    custom_exe_path: Option<String>,
    user_data_dirs: Vec<String>,
) -> crate::browser::BrowserInfo {
    management::detect_profiles_from(&browser_type, custom_exe_path.as_deref(), &user_data_dirs)
}

/// 诊断用户数据目录（用于排查 Local State 解析问题）
#[tauri::command]
fn diagnose_directory(path: String) -> DirDiagnostic {
    use std::fs;
    use std::path::Path;

    let exists = Path::new(&path).exists();
    let local_state_path = Path::new(&path).join("Local State");
    let local_state_exists = local_state_path.exists();
    let local_state_file_size = if local_state_exists {
        fs::metadata(&local_state_path)
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };

    let (local_state_readable, has_info_cache, profile_count, profile_keys, info_cache_keys) =
        if local_state_exists {
            match fs::read_to_string(&local_state_path) {
                Ok(content) => {
                    let has_cache = content.contains("info_cache");
                    let count = content.matches("\"info_cache\"").count();
                    let (profile_keys, cache_keys) =
                        if let Ok(json) =
                            serde_json::from_str::<serde_json::Value>(&content)
                        {
                            let pkeys: Vec<String> = json
                                .pointer("/profile")
                                .and_then(|v| v.as_object())
                                .map(|obj| obj.keys().cloned().collect())
                                .unwrap_or_default();
                            let ckeys: Vec<String> = json
                                .pointer("/profile/info_cache")
                                .and_then(|v| v.as_object())
                                .map(|obj| obj.keys().cloned().collect())
                                .unwrap_or_default();
                            (pkeys, ckeys)
                        } else {
                            (vec![], vec![])
                        };
                    (true, has_cache, count, profile_keys, cache_keys)
                }
                Err(_) => (false, false, 0, vec![], vec![]),
            }
        } else {
            (false, false, 0, vec![], vec![])
        };

    eprintln!(
        "[diagnose] path={:?} exists={} local_state={} size={} readable={} info_cache={} count={} profile_keys={:?} info_cache_keys={:?}",
        path, exists, local_state_exists, local_state_file_size, local_state_readable, has_info_cache, profile_count, profile_keys, info_cache_keys
    );

    DirDiagnostic {
        path,
        exists,
        local_state_exists,
        local_state_file_size,
        local_state_readable,
        has_info_cache,
        profile_count,
        profile_keys,
        info_cache_keys,
    }
}

/// 生成启动命令信息
#[tauri::command]
fn get_launch_command(
    browser_type: String,
    profile_id: String,
    user_data_dir: String,
    debug_port: u16,
) -> crate::browser::LaunchInfo {
    management::generate_launch_cmd(&browser_type, &profile_id, &user_data_dir, debug_port)
}

/// 启动浏览器指定配置
#[tauri::command]
fn launch_browser_profile(
    browser_type: String,
    profile_id: String,
    user_data_dir: String,
    debug_port: u16,
) -> Result<String, String> {
    management::launch_profile(&browser_type, &profile_id, &user_data_dir, debug_port)
}

/// 创建桌面快捷方式
#[tauri::command]
fn create_desktop_shortcut(
    browser_type: String,
    profile_id: String,
    user_data_dir: String,
    profile_name: String,
    avatar_path: String,
    debug_port: u16,
) -> Result<String, String> {
    management::create_shortcut(
        &browser_type,
        &profile_id,
        &user_data_dir,
        &profile_name,
        &avatar_path,
        debug_port,
    )
}

/// 读取 profile 头像图片路径
#[tauri::command]
fn get_avatar_path(profile_path: String, is_edge: bool) -> Option<String> {
    management::get_profile_avatar_path(&profile_path, is_edge)
}

/// 创建新的用户数据目录并自动初始化
#[tauri::command]
fn create_new_user_data_dir(
    browser_type: String,
    parent_dir: String,
    dir_name: String,
) -> Result<String, String> {
    management::create_new_user_data_dir(&browser_type, &parent_dir, &dir_name)
}

/// 检测并分配调试端口（前端展示用）
#[tauri::command]
fn detect_debug_ports(profiles: Vec<(String, String)>) -> Vec<PortEntry> {
    management::detect_and_assign_ports(&profiles)
}

/// 检测浏览器进程运行状态（不分配端口，仅检测是否运行）
#[tauri::command]
fn detect_browser_running_processes(profiles: Vec<(String, String)>) -> Vec<management::BrowserProcessState> {
    management::detect_browser_running_processes(&profiles)
}

/// 查找可用端口（用于调试启动）
#[tauri::command]
fn find_available_port(start: u16, end: u16) -> Result<u16, String> {
    crate::system::port::find_available_port(start, end)
        .ok_or_else(|| format!("端口范围 {}~{} 内无可用端口", start, end))
}

/// 杀死指定配置的浏览器进程（调试启动前清理已有实例）
#[tauri::command]
fn kill_browser_profile_process(
    browser_type: String,
    profile_id: String,
    user_data_dir: String,
) -> Result<String, String> {
    management::kill_browser_profile_process(&browser_type, &profile_id, &user_data_dir)
}

/// 杀死指定浏览器的所有进程（Edge → msedge.exe, Chrome → chrome.exe）
#[tauri::command]
fn kill_all_browser_processes(browser_type: String) -> Result<String, String> {
    let exe_name = match browser_type.as_str() {
        "edge" => "msedge.exe",
        "chrome" => "chrome.exe",
        _ => return Err(format!("不支持的浏览器类型: {}", browser_type)),
    };
    let count = crate::system::process::kill_processes_by_name(exe_name)
        .map_err(|e| format!("杀死进程失败: {}", e))?;
    Ok(format!("已关闭 {} 个 {} 进程", count, exe_name))
}

// ── 主题与配置 ──

/// 从内存缓存获取全量应用数据（一次 IPC，0 I/O）
#[tauri::command]
async fn get_all_data(
    state: tauri::State<'_, SharedAppData>,
) -> Result<AppData, String> {
    state.read().map(|g| g.clone()).map_err(|e| e.to_string())
}

/// 保存主题配置（写入内存缓存）
#[tauri::command]
async fn set_app_theme(
    state: tauri::State<'_, SharedAppData>,
    theme: ThemeConfig,
) -> Result<(), String> {
    // 更新内存缓存（主题持久化由前端 localStorage 负责）
    state.write().map_err(|e| e.to_string())?.theme = theme;
    Ok(())
}

/// 保存应用配置（写入内存缓存 + 同步刷盘）
#[tauri::command]
async fn set_app_config(
    state: tauri::State<'_, SharedAppData>,
    config: AppConfig,
) -> Result<(), String> {
    state.write().map_err(|e| e.to_string())?.config = config.clone();
    crate::config::store::save_config(&config).map_err(|e| e.to_string())
}

// ── 数据文件管理 ──

#[tauri::command]
fn delete_data_files(files: Vec<String>) -> Result<(), String> {
    let dir = crate::config::store::config_dir();
    let mut errors: Vec<String> = Vec::new();
    for file in &files {
        let path = dir.join(file);
        if path.exists() {
            if let Err(e) = std::fs::remove_file(&path) {
                let msg = format!("{}: {}", file, e);
                eprintln!("[delete_data_files] 跳过文件 {}", msg);
                errors.push(msg);
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("部分文件删除失败: {}", errors.join("; ")))
    }
}

/// 写入本地文件（覆盖写入，自动创建目录）
#[tauri::command]
fn write_local_file(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| format!("写入文件失败: {}", e))
}

/// 批量读取多个本地文件内容（一次 IPC 调用，避免 N 次往返）
/// 返回 Map<文件名 -> 文件内容>，读取失败的文件值为空字符串
#[tauri::command]
fn read_all_local_files(paths: Vec<String>) -> std::collections::HashMap<String, String> {
    let mut results = std::collections::HashMap::new();
    for path in &paths {
        match std::fs::read_to_string(path) {
            Ok(content) => { results.insert(path.clone(), content); }
            Err(_) => { results.insert(path.clone(), String::new()); }
        }
    }
    results
}

/// 列出 app_data_dir 下的所有文件
#[derive(Serialize)]
pub struct DataFileEntry {
    pub name: String,
    pub size: u64,
    pub modified: String,
}

#[tauri::command]
fn list_data_files() -> Result<Vec<DataFileEntry>, String> {
    let dir = crate::config::store::config_dir();
    std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败: {}", e))?;
    let mut entries = Vec::new();
    let read = std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().map_err(|e| format!("读取元数据失败: {}", e))?;
        let size = meta.len();
        let modified = meta.modified()
            .map(|t| {
                let secs = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
                secs.to_string()
            })
            .unwrap_or_default();
        entries.push(DataFileEntry { name, size, modified });
    }
    Ok(entries)
}

/// 列出 app_data_dir 下的所有数据库文件（.db 扩展名）
#[derive(Serialize)]
pub struct DatabaseFileEntry {
    pub name: String,
    /// 相对于 config_dir 的路径（含子目录），可传给 delete_data_files
    pub rel_path: String,
    pub size: u64,
    pub modified: String,
}

#[tauri::command]
fn list_database_files() -> Result<Vec<DatabaseFileEntry>, String> {
    let dir = crate::config::store::config_dir();
    std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败: {}", e))?;
    eprintln!("[list_database_files] scanning dir: {:?}", dir);
    let mut entries = Vec::new();
    let mut walk = vec![dir.to_path_buf()];
    while let Some(current) = walk.pop() {
        let read = std::fs::read_dir(&current).map_err(|e| format!("读取目录失败: {}", e))?;
        for entry in read {
            let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
            let path = entry.path();
            let ft = entry.file_type().map_err(|e| format!("读取文件类型失败: {}", e))?;
            if ft.is_dir() {
                walk.push(path);
            } else if ft.is_file() && path.extension().map(|ext| ext == "db").unwrap_or(false) {
                let name = entry.file_name().to_string_lossy().to_string();
                let rel_path = path.strip_prefix(dir).unwrap_or(&path).to_string_lossy().to_string();
                let meta = entry.metadata().map_err(|e| format!("读取元数据失败: {}", e))?;
                let size = meta.len();
                let modified = meta.modified()
                    .map(|t| {
                        let secs = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
                        secs.to_string()
                    })
                    .unwrap_or_default();
                entries.push(DatabaseFileEntry { name, rel_path, size, modified });
            }
        }
    }
    Ok(entries)
}

// ── 通用工具命令 ──

/// 打开系统目录/文件
#[tauri::command]
fn open_directory(path: String) -> Result<String, String> {
    opener::open(&path).map_err(|e| format!("打开目录失败: {}", e))?;
    Ok(path)
}

/// 检查路径是否存在
#[tauri::command]
fn check_path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// 获取应用版本号
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 保存 Base64 编码的文件到指定路径
#[tauri::command]
fn save_file(path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("Base64解码失败: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("保存文件失败: {}", e))
}

/// 注册所有通用 Tauri 命令
///
/// # 用法
///
/// ```ignore
/// tauri::Builder::default()
///     .plugin(appkit_core::tauri_bridge::init())
///     // ... 其他插件
///     .invoke_handler(tauri::generate_handler![
///         // 项目特有的命令
///     ])
/// ```
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("appkit-core")
        .invoke_handler(tauri::generate_handler![
            detect_browsers,
            detect_custom_profiles,
            diagnose_directory,
            get_launch_command,
            launch_browser_profile,
            create_desktop_shortcut,
            get_avatar_path,
            create_new_user_data_dir,
            detect_debug_ports,
            detect_browser_running_processes,
            find_available_port,
            kill_browser_profile_process,
            kill_all_browser_processes,
            delete_data_files,
            list_data_files,
            write_local_file,
            read_all_local_files,
            list_database_files,
            get_all_data,
            set_app_theme,
            set_app_config,
            open_directory,
            check_path_exists,
            get_app_version,
            save_file,
        ])
        .build()
}
