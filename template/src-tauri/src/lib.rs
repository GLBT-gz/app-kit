use tauri::Manager;

#[tauri::command]
fn open_directory(path: String) -> Result<String, String> {
    opener::open(&path).map_err(|e| format!("打开目录失败: {}", e))?;
    Ok(path)
}

#[tauri::command]
fn check_path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn set_window_pin(app: tauri::AppHandle, pin: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_always_on_top(pin)
            .map_err(|e| format!("设置置顶失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn install_version(app: tauri::AppHandle, url: String, save_path: String) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;
    use tauri::Emitter;

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&save_path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("读取数据失败: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": total,
                    "percent": ((downloaded as f64 / total as f64) * 100.0).round() as u32,
                }),
            );
        }
    }

    if total > 0 {
        let _ = app.emit(
            "download-progress",
            serde_json::json!({
                "downloaded": total,
                "total": total,
                "percent": 100,
            }),
        );
    }

    Ok(save_path)
}

#[tauri::command]
fn read_local_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(appkit_core::tauri_bridge::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .build()
        )
        .setup(|app| {
            log::info!("应用启动成功");

            // 初始化配置存储目录（Tauri app_data_dir）
            if let Ok(dir) = app.path().app_data_dir() {
                appkit_core::config::store::set_config_dir(dir);
            }

            // 初始化 Rust 内存缓存：从磁盘加载全量数据到内存
            let app_data = appkit_core::config::store::create_shared_app_data();
            app.manage(app_data);

            // 编译时嵌入 icon.png，运行时解码为 RGBA 并设为窗口图标
            if let Some(window) = app.get_webview_window("main") {
                let png_bytes = include_bytes!("../icons/icon.png");
                match image::load_from_memory(png_bytes) {
                    Ok(img) => {
                        let rgba = img.to_rgba8();
                        let (w, h) = rgba.dimensions();
                        let icon = tauri::image::Image::new_owned(rgba.into_raw(), w, h);
                        if let Err(e) = window.set_icon(icon) {
                            eprintln!("[setup] set_icon error: {:?}", e);
                        }
                    }
                    Err(e) => {
                        eprintln!("[setup] decode icon error: {:?}", e);
                    }
                }

                // 开发模式下窗口标题追加标记，便于区分 dev 和发行版
                #[cfg(debug_assertions)]
                if let Ok(title) = window.title() {
                    let _ = window.set_title(&format!("[模板] {} [开发版]", title));
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_directory,
            check_path_exists,
            get_app_version,
            set_window_pin,
            install_version,
            read_local_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
