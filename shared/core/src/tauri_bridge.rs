//! Tauri 插件桥接层
//!
//! 将 `shared/core` 中的通用能力打包为 Tauri 插件，
//! 项目只需 `.plugin(appkit_core::tauri_bridge::init())` 即可注册所需通用命令。
//!
//! 命令按 feature 分组门控（未启用的命令不参与编译）：
//! - `cmd-browser`（浏览器检测/配置/进程，11 个）：
//!   detect_browsers, detect_custom_profiles,
//!   get_launch_command, launch_browser_profile, create_desktop_shortcut,
//!   create_new_user_data_dir, detect_debug_ports,
//!   detect_browser_running_processes, find_available_port,
//!   kill_browser_profile_process, kill_all_browser_processes
//! - `cmd-files`（数据文件管理，4 个）：
//!   delete_data_files, list_data_files,
//!   read_all_local_files, list_database_files
//! - `cmd-utils`（通用工具，5 个）：
//!   open_directory, check_path_exists, get_data_directory, get_install_directory, save_file
//! - `cmd-db`（数据库表管理，2 个）：
//!   get_db_tables, clear_db_table

#[cfg(feature = "cmd-browser")]
use crate::browser::management;
#[cfg(feature = "cmd-browser")]
use crate::config::PortEntry;
#[cfg(any(feature = "cmd-files", feature = "cmd-db"))]
use serde::Serialize;

// ── 浏览器检测与配置（cmd-browser）──

/// 检测所有已安装浏览器（内置 Edge/Chrome + 注册的自定义浏览器）
/// async：检测涉及注册表扫描 + 文件系统遍历 + 头像图片处理，若在主线程
/// 执行会阻塞 UI（卡到全部头像返回后才恢复）；放后台线程保持界面响应。
#[cfg(feature = "cmd-browser")]
#[tauri::command]
async fn detect_browsers() -> Vec<crate::browser::BrowserInfo> {
    management::detect_all_browsers()
}

/// 返回当前支持的（已注册）浏览器类型：内置 edge/chrome + 业务项目注册的类型（如 edecker）
#[cfg(feature = "cmd-browser")]
#[tauri::command]
fn detect_browser_types() -> Vec<String> {
    let mut registered = vec!["edge".to_string(), "chrome".to_string()];
    registered.extend(management::registered_browser_types());
    registered
}

/// 根据自定义路径检测浏览器配置
/// async：每个目录都要读取 Local State / Preferences 并处理头像，主线程
/// 串行执行多个这类命令会阻塞 UI；放后台线程并行执行保持界面响应。
#[cfg(feature = "cmd-browser")]
#[tauri::command]
async fn detect_custom_profiles(
    browser_type: String,
    custom_exe_path: Option<String>,
    user_data_dirs: Vec<String>,
) -> crate::browser::BrowserInfo {
    management::detect_profiles_from(&browser_type, custom_exe_path.as_deref(), &user_data_dirs)
}

/// 生成启动命令信息
#[cfg(feature = "cmd-browser")]
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
#[cfg(feature = "cmd-browser")]
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
#[cfg(feature = "cmd-browser")]
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

/// 创建新的用户数据目录并自动初始化
#[cfg(feature = "cmd-browser")]
#[tauri::command]
fn create_new_user_data_dir(
    browser_type: String,
    parent_dir: String,
    dir_name: String,
) -> Result<String, String> {
    management::create_new_user_data_dir(&browser_type, &parent_dir, &dir_name)
}

/// 检测并分配调试端口（前端展示用）
#[cfg(feature = "cmd-browser")]
#[tauri::command]
fn detect_debug_ports(profiles: Vec<(String, String)>) -> Vec<PortEntry> {
    management::detect_and_assign_ports(&profiles)
}

/// 检测浏览器进程运行状态（不分配端口，仅检测是否运行）
#[cfg(feature = "cmd-browser")]
#[tauri::command]
fn detect_browser_running_processes(profiles: Vec<(String, String)>) -> Vec<management::BrowserProcessState> {
    management::detect_browser_running_processes(&profiles)
}

/// 查找可用端口（用于调试启动）
#[cfg(feature = "cmd-browser")]
#[tauri::command]
fn find_available_port(start: u16, end: u16) -> Result<u16, String> {
    crate::system::port::find_available_port(start, end)
        .ok_or_else(|| format!("端口范围 {}~{} 内无可用端口", start, end))
}

/// 杀死指定配置的浏览器进程（调试启动前清理已有实例）
#[cfg(feature = "cmd-browser")]
#[tauri::command]
fn kill_browser_profile_process(
    browser_type: String,
    profile_id: String,
    user_data_dir: String,
) -> Result<String, String> {
    management::kill_browser_profile_process(&browser_type, &profile_id, &user_data_dir)
}

/// 杀死指定浏览器的所有进程（Edge → msedge.exe, Chrome → chrome.exe, 自定义 → 注册的进程名）
#[cfg(feature = "cmd-browser")]
#[tauri::command]
fn kill_all_browser_processes(browser_type: String) -> Result<String, String> {
    let exe_name = match browser_type.as_str() {
        "edge" => "msedge.exe".to_string(),
        "chrome" => "chrome.exe".to_string(),
        // 注册式：自定义浏览器类型的进程名由业务项目注册（如 003 的易得客 → edecker.exe）
        _ => {
            if let Some(name) = management::registered_process_name(&browser_type) {
                name
            } else {
                return Err(format!("不支持的浏览器类型: {}", browser_type));
            }
        }
    };
    let count = crate::system::process::kill_processes_by_name(&exe_name)
        .map_err(|e| format!("杀死进程失败: {}", e))?;
    Ok(format!("已关闭 {} 个 {} 进程", count, exe_name))
}

// ── 数据文件管理（cmd-files）──

/// 删除 app_data_dir 下的指定文件
#[cfg(feature = "cmd-files")]
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

/// 批量读取多个本地文件内容（一次 IPC 调用，避免 N 次往返）
/// 返回 Map<文件名 -> 文件内容>，读取失败的文件值为空字符串
#[cfg(feature = "cmd-files")]
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
#[cfg(feature = "cmd-files")]
#[derive(Serialize)]
pub struct DataFileEntry {
    pub name: String,
    pub size: u64,
    pub modified: String,
}

#[cfg(feature = "cmd-files")]
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
#[cfg(feature = "cmd-files")]
#[derive(Serialize)]
pub struct DatabaseFileEntry {
    pub name: String,
    /// 相对于 config_dir 的路径（含子目录），可传给 delete_data_files
    pub rel_path: String,
    pub size: u64,
    pub modified: String,
}

#[cfg(feature = "cmd-files")]
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

// ── 通用工具命令（cmd-utils）──

/// 打开系统目录/文件
#[cfg(feature = "cmd-utils")]
#[tauri::command]
fn open_directory(path: String) -> Result<String, String> {
    opener::open(&path).map_err(|e| format!("打开目录失败: {}", e))?;
    Ok(path)
}

/// 检查路径是否存在
#[cfg(feature = "cmd-utils")]
#[tauri::command]
fn check_path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// 获取应用数据目录路径（Windows 下与安装目录统一盘符为大写）
#[cfg(feature = "cmd-utils")]
#[tauri::command]
fn get_data_directory<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> String {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|p| crate::system::path::normalize_drive_letter(&p.to_string_lossy()))
        .unwrap_or_else(|_| "unknown".to_string())
}

/// 获取安装目录（当前可执行文件所在目录，Windows 下盘符归一化为大写）
#[cfg(feature = "cmd-utils")]
#[tauri::command]
fn get_install_directory() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| {
            p.parent()
                .map(|d| crate::system::path::normalize_drive_letter(&d.to_string_lossy()))
        })
        .unwrap_or_else(|| "unknown".to_string())
}

/// 保存 Base64 编码的文件到指定路径
#[cfg(feature = "cmd-utils")]
#[tauri::command]
fn save_file(path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("Base64解码失败: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("保存文件失败: {}", e))
}

// ── 数据库表管理（cmd-db）──

/// SQLite 数据库表信息
#[cfg(feature = "cmd-db")]
#[derive(Serialize)]
pub struct DbTableInfo {
    pub name: String,
    pub row_count: u32,
}

/// 读取 config_dir 下数据库文件的表列表及行数
/// （db_rel_path 为相对 config_dir 的路径，与 list_database_files 返回的 rel_path 一致）
#[cfg(feature = "cmd-db")]
#[tauri::command]
fn get_db_tables(db_rel_path: String) -> Result<Vec<DbTableInfo>, String> {
    let dir = crate::config::store::config_dir();
    let db_path = dir.join(&db_rel_path);
    if !db_path.exists() {
        return Ok(vec![]);
    }
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("打开数据库失败: {}", e))?;
    // 项目自身常驻连接（无 busy_timeout），并发读写可能短暂撞锁（SQLITE_BUSY），
    // 这里等待锁释放而不是立即失败
    conn.busy_timeout(std::time::Duration::from_millis(3000))
        .map_err(|e| format!("设置 busy_timeout 失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| format!("查询表名失败: {}", e))?;
    let table_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("查询表名失败: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    let mut tables = Vec::new();
    for name in table_names {
        let count: u32 = conn
            .query_row(&format!("SELECT COUNT(*) FROM \"{}\"", name), [], |row| row.get(0))
            .map_err(|e| format!("查询 {} 行数失败: {}", name, e))?;
        tables.push(DbTableInfo { name, row_count: count });
    }
    Ok(tables)
}

/// 清空 config_dir 下数据库文件中指定表的数据
#[cfg(feature = "cmd-db")]
#[tauri::command]
fn clear_db_table(db_rel_path: String, table_name: String) -> Result<(), String> {
    let dir = crate::config::store::config_dir();
    let db_path = dir.join(&db_rel_path);
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("打开数据库失败: {}", e))?;
    // 与 get_db_tables 同理：等待锁释放
    conn.busy_timeout(std::time::Duration::from_millis(3000))
        .map_err(|e| format!("设置 busy_timeout 失败: {}", e))?;
    conn.execute(&format!("DELETE FROM \"{}\"", table_name), [])
        .map_err(|e| format!("清空表 {} 失败: {}", table_name, e))?;
    Ok(())
}

/// 注册通用 Tauri 命令（按 feature 门控）
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
    // 注意：plugin Builder 的 invoke_handler 是"替换"而非"追加"，
    // 因此必须在一次 generate_handler! 中注册全部启用命令，
    // 未启用命令通过每条前的 #[cfg] 属性在编译期裁剪。
    tauri::plugin::Builder::<R>::new("appkit-core")
        .invoke_handler(tauri::generate_handler![
            // ── 浏览器检测/配置/进程（cmd-browser）──
            #[cfg(feature = "cmd-browser")]
            detect_browsers,
            #[cfg(feature = "cmd-browser")]
            detect_browser_types,
            #[cfg(feature = "cmd-browser")]
            detect_custom_profiles,
            #[cfg(feature = "cmd-browser")]
            get_launch_command,
            #[cfg(feature = "cmd-browser")]
            launch_browser_profile,
            #[cfg(feature = "cmd-browser")]
            create_desktop_shortcut,
            #[cfg(feature = "cmd-browser")]
            create_new_user_data_dir,
            #[cfg(feature = "cmd-browser")]
            detect_debug_ports,
            #[cfg(feature = "cmd-browser")]
            detect_browser_running_processes,
            #[cfg(feature = "cmd-browser")]
            find_available_port,
            #[cfg(feature = "cmd-browser")]
            kill_browser_profile_process,
            #[cfg(feature = "cmd-browser")]
            kill_all_browser_processes,
            // ── 数据文件管理（cmd-files）──
            #[cfg(feature = "cmd-files")]
            delete_data_files,
            #[cfg(feature = "cmd-files")]
            list_data_files,
            #[cfg(feature = "cmd-files")]
            read_all_local_files,
            #[cfg(feature = "cmd-files")]
            list_database_files,
            // ── 通用工具（cmd-utils）──
            #[cfg(feature = "cmd-utils")]
            open_directory,
            #[cfg(feature = "cmd-utils")]
            check_path_exists,
            #[cfg(feature = "cmd-utils")]
            get_data_directory,
            #[cfg(feature = "cmd-utils")]
            get_install_directory,
            #[cfg(feature = "cmd-utils")]
            save_file,
            // ── 数据库表管理（cmd-db）──
            #[cfg(feature = "cmd-db")]
            get_db_tables,
            #[cfg(feature = "cmd-db")]
            clear_db_table,
        ])
        .build()
}
