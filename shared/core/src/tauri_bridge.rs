//! Tauri 插件桥接层
//!
//! 将 `shared/core` 中的通用能力打包为 Tauri 插件，
//! 项目只需 `.plugin(appkit_core::tauri_bridge::init())` 即可注册所有通用命令。
//!
//! 包含的命令（均为中性通用能力）：
//! - get_all_data, set_app_theme, set_app_config（主题/配置）
//! - delete_data_files, write_local_file, read_all_local_files
//! - list_data_files, list_database_files（数据文件管理）
//! - open_directory, check_path_exists, get_app_version, save_file（通用工具）

use crate::config::{AppConfig, AppData, ThemeConfig};
use crate::config::store::SharedAppData;
use serde::Serialize;

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
