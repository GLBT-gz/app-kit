// ============================================================
// 浏览器进程管理
//
// 汇总文件：仅保留公共 API；具体实现按主题拆分到子模块：
// - browser_register.rs  自定义浏览器检测器注册
// - browser_process.rs   进程扫描 / 运行状态 / 端口分配
// - browser_kill.rs      进程终止
// - browser_avatar.rs    头像读取
// - browser_paths.rs     注册表 / 版本 / 路径 / Edge/Chrome 检测
// - browser_profiles.rs  用户配置读取
//
// 子模块的 pub 项经下方 pub use 重导出，
// 外部路径 appkit_core::browser::management::xxx 保持不变。
// ============================================================

use crate::browser::{BrowserInfo, LaunchInfo};
use std::collections::HashMap;
use std::path::Path;
use super::icons::{CHROME_ICO, EDGE_ICO};

// 内部使用（子模块实现）
use super::browser_register::{CUSTOM_DETECTORS, custom_detector};
use super::browser_kill::kill_browser_process_inner;
use super::browser_paths::{detect_chrome, detect_edge, get_browser_version, get_exe_paths, scan_brand_rpa_dirs, scan_peer_user_data_dirs};
use super::browser_profiles::read_profiles;

// 重导出子模块公开 API（保持外部路径不变）
pub use super::browser_register::{BrowserDetector, register_browser_detector, registered_browser_types, registered_process_name};
pub use super::browser_process::{BrowserProcessState, detect_and_assign_ports, detect_browser_running_processes, is_running_instance_headless, scan_running_browser_instances, scan_running_browser_processes, split_windows_command_line};
pub use super::browser_kill::kill_browser_by_exe_name;
pub use super::browser_avatar::ImageData;


// ============ 公共 API ============

/// 检测所有已安装浏览器（内置 Edge/Chrome + 业务项目注册的自定义浏览器）
pub fn detect_all_browsers() -> Vec<BrowserInfo> {
    let mut browsers = Vec::new();
    browsers.push(detect_edge());
    browsers.push(detect_chrome());
    if let Some(reg) = CUSTOM_DETECTORS.get() {
        for (browser_type, detector) in reg.lock().unwrap().iter() {
            let info = (detector.detect)();
            if info.browser_type.is_empty() {
                eprintln!("[detect_all_browsers] 注册的检测器 {} 返回了空的 browser_type，已跳过", browser_type);
                continue;
            }
            browsers.push(info);
        }
    }
    browsers
}

/// 根据自定义路径检测浏览器配置
pub fn detect_profiles_from(
    browser_type: &str,
    custom_exe_path: Option<&str>,
    user_data_dirs: &[String],
) -> BrowserInfo {
    let icons: HashMap<&str, (&str, &str)> = HashMap::from([
        ("edge", ("Microsoft Edge", EDGE_ICO)),
        ("chrome", ("Google Chrome", CHROME_ICO)),
    ]);

    // 注册类型：名称/图标/端口/children/版本 取自注册的检测器
    let registered = custom_detector(browser_type);
    let (browser_name, icon_b64, default_port, children, base_version) =
        if let Some(det) = &registered {
            let base = (det.detect)();
            (
                base.browser_name,
                base.browser_icon_base64,
                base.default_debug_port,
                base.children,
                base.browser_version,
            )
        } else {
            let (name, icon) = icons
                .get(browser_type)
                .copied()
                .unwrap_or(("浏览器", EDGE_ICO));
            (
                name.to_string(),
                icon.to_string(),
                9222,
                Vec::new(),
                String::new(),
            )
        };

    let exe_paths = if let Some(exe) = custom_exe_path {
        if Path::new(exe).exists() {
            vec![exe.to_string()]
        } else {
            get_exe_paths(browser_type)
        }
    } else {
        get_exe_paths(browser_type)
    };

    let mut all_profiles = Vec::new();
    for udd in user_data_dirs {
        if Path::new(udd).exists() {
            let profiles = read_profiles(udd, browser_type == "edge");
            all_profiles.extend(profiles);
        }
    }

    // 去重：同 id + 同目录才视为重复
    all_profiles.sort_by(|a, b| a.id.cmp(&b.id).then(a.user_data_dir.cmp(&b.user_data_dir)));
    all_profiles.dedup_by(|a, b| a.id == b.id && a.user_data_dir == b.user_data_dir);

    let version = if !base_version.is_empty() {
        base_version
    } else {
        get_browser_version(browser_type)
    };

    // 扫描同级目录作为 suggested（不包含默认目录）
    let default_user_data = user_data_dirs.first().map(|s| s.as_str()).unwrap_or("");
    let mut suggested = scan_peer_user_data_dirs(default_user_data);
    // 对 Edge / Chrome 同时扫描 RPA 变体目录
    if browser_type == "edge" || browser_type == "chrome" {
        let brand = if browser_type == "edge" { "Edge" } else { "Chrome" };
        suggested.extend(scan_brand_rpa_dirs(brand, default_user_data));
    }

    BrowserInfo {
        browser_type: browser_type.to_string(),
        browser_name,
        browser_icon_base64: icon_b64,
        installed: !exe_paths.is_empty(),
        exe_paths,
        user_data_dirs: user_data_dirs.to_vec(),
        default_user_data_dir: user_data_dirs
            .first()
            .cloned()
            .unwrap_or_default(),
        default_debug_port: default_port,
        browser_version: version,
        suggested_user_data_dirs: suggested,
        profiles: all_profiles,
        children,
    }
}

/// 生成启动命令信息
pub fn generate_launch_cmd(
    browser_type: &str,
    profile_id: &str,
    user_data_dir: &str,
    debug_port: u16,
) -> LaunchInfo {
    let exe_paths = get_exe_paths(browser_type);
    let exe_path = exe_paths
        .first()
        .cloned()
        .unwrap_or_else(|| "chrome.exe".to_string());

    let args = vec![
        format!("--profile-directory=\"{}\"", profile_id),
        format!("--user-data-dir=\"{}\"", user_data_dir),
    ];

    let cmd_args: Vec<String> = args
        .iter()
        .map(|a| a.clone())
        .collect();
    let command_line = format!("\"{}\" {}", exe_path, cmd_args.join(" "));

    LaunchInfo {
        exe_path: exe_path.clone(),
        args: cmd_args,
        command_line,
        debug_port,
    }
}

/// 启动浏览器指定配置
pub fn launch_profile(
    browser_type: &str,
    profile_id: &str,
    user_data_dir: &str,
    debug_port: u16,
) -> Result<String, String> {
    let exe_paths = get_exe_paths(browser_type);
    let exe_path = exe_paths
        .first()
        .ok_or_else(|| format!("未找到 {} 浏览器可执行文件", browser_type))?;

    let mut cmd = std::process::Command::new(exe_path);
    cmd.arg(format!("--profile-directory={}", profile_id))
        .arg(format!("--user-data-dir={}", user_data_dir));

    // 仅当明确指定了调试端口时才添加 --remote-debugging-port
    if debug_port > 0 {
        cmd.arg(format!("--remote-debugging-port={}", debug_port));
    }

    let status = cmd.spawn().map_err(|e| format!("启动失败: {}", e))?;

    Ok(format!("PID:{}", status.id()))
}

/// 创建桌面快捷方式
pub fn create_shortcut(browser_type: &str, profile_id: &str, user_data_dir: &str, profile_name: &str, _avatar_path: &str, _debug_port: u16) -> Result<String, String> {
    let exe_paths = get_exe_paths(browser_type);
    let exe_path = exe_paths.first().ok_or_else(|| "未找到浏览器可执行文件".to_string())?;
    let desktop = dirs::desktop_dir().ok_or_else(|| "未找到桌面目录".to_string())?;
    let safe_name = sanitize_filename(profile_name);
    let lnk_path = desktop.join(format!("{}.lnk", safe_name));

    // 检查快捷方式是否已存在
    let is_overwrite = lnk_path.exists();

    // 使用 PowerShell 创建快捷方式
    let ps_script = format!(
        r#"
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut("{}")
$Shortcut.TargetPath = "{}"
$Shortcut.Arguments = '--profile-directory="{}" --user-data-dir="{}"'
$Shortcut.Description = "Browser - {} {}"
$Shortcut.Save()
"#,
        lnk_path.display(),
        exe_path,
        profile_id,
        user_data_dir,
        browser_type,
        profile_name,
    );

    let _ = {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("powershell")
                .arg("-NoProfile")
                .arg("-Command")
                .arg(&ps_script)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .map_err(|e| format!("创建快捷方式失败: {}", e))?
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("powershell")
                .arg("-NoProfile")
                .arg("-Command")
                .arg(&ps_script)
                .output()
                .map_err(|e| format!("创建快捷方式失败: {}", e))?
        }
    };

    if is_overwrite {
        Ok(format!("overwrite:{}", lnk_path.to_string_lossy()))
    } else {
        Ok(lnk_path.to_string_lossy().to_string())
    }
}

fn sanitize_filename(name: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    name.chars()
        .map(|c| if invalid.contains(&c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// 创建新的用户数据目录并自动初始化
/// 1. 创建独立用户数据目录（避免 Profile 1/2/... 编号问题）
/// 2. 静默启动浏览器让浏览器自动生成完整的配置结构
/// 3. 等待初始化完成后关闭浏览器
/// 4. 返回初始化完成的目录路径
pub fn create_new_user_data_dir(
    browser_type: &str,
    parent_dir: &str,
    dir_name: &str,
) -> Result<String, String> {
    let dir_name = sanitize_dir_name(dir_name);
    let new_dir = std::path::Path::new(parent_dir).join(&dir_name);

    if new_dir.exists() {
        return Err(format!("目录已存在: {}", new_dir.display()));
    }

    // 1. 创建空目录
    std::fs::create_dir_all(&new_dir)
        .map_err(|e| format!("创建目录失败: {}", e))?;

    // 2. 获取浏览器可执行文件路径
    let exe_paths = get_exe_paths(browser_type);
    let exe = exe_paths.into_iter().next()
        .ok_or_else(|| "未找到浏览器可执行文件".to_string())?;

    // 3. 启动浏览器进行初始化（最小化窗口，无首次运行向导）
    let mut child = std::process::Command::new(&exe)
        .arg(format!("--user-data-dir={}", new_dir.display()))
        .arg("--no-first-run")
        .arg("--disable-features=HideUserDataDirInUse")
        .arg("--window-size=1,1")
        .arg("--hide-crash-restore-bubble")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动浏览器失败: {}", e))?;

    // 4. 等待浏览器初始化完成（分两阶段）
    let default_dir = new_dir.join("Default");
    let local_state = new_dir.join("Local State");
    let prefs = default_dir.join("Preferences");

    let timeout = std::time::Duration::from_secs(30);
    let poll_interval = std::time::Duration::from_millis(500);
    let start = std::time::Instant::now();

    // 阶段一：等待基本文件（Default/Preferences 和 Local State）生成
    let files_ready = loop {
        if default_dir.exists() && local_state.exists() && prefs.exists() {
            break true;
        }
        if start.elapsed() > timeout {
            break false;
        }
        std::thread::sleep(poll_interval);
    };

    if !files_ready {
        let _ = child.kill();
        let _ = child.wait();
        return Err(
            "浏览器初始化超时(30秒)，请手动启动一次浏览器完成配置。\n\
            目录已创建，打开浏览器后工具会自动识别。".to_string()
        );
    }

    // 阶段二：等待 Local State 中的 profile.info_cache 写入完整数据
    // 浏览器被 kill 前需要把 profile 信息写入 info_cache，否则 read_profiles 读取为空
    let info_cache_ready = loop {
        if let Ok(content) = std::fs::read_to_string(&local_state) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(cache) = json
                    .pointer("/profile/info_cache")
                    .and_then(|v| v.as_object())
                {
                    if !cache.is_empty() {
                        break true;
                    }
                }
            }
        }
        if start.elapsed() > timeout {
            break false;
        }
        std::thread::sleep(poll_interval);
    };

    // 5. 关闭浏览器
    let _ = child.kill();
    let _ = child.wait();

    if !info_cache_ready {
        return Err(
            "浏览器初始化完成但 profile 信息尚未写入，请手动启动一次浏览器完成配置。\n\
            目录已创建，打开浏览器后工具会自动识别。".to_string()
        );
    }

    Ok(new_dir.to_string_lossy().to_string())
}

fn sanitize_dir_name(name: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*', '\n', '\r'];
    name.chars()
        .map(|c| if invalid.contains(&c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// 杀死指定配置的浏览器进程（先通过 WMI 查找 PID，再用 taskkill 精确杀死）
pub fn kill_browser_profile_process(
    browser_type: &str,
    profile_id: &str,
    user_data_dir: &str,
) -> Result<String, String> {
    let exe_name = match browser_type {
        "edge" => "msedge.exe",
        "chrome" => "chrome.exe",
        _ => return Err(format!("不支持的浏览器类型: {}", browser_type)),
    };
    kill_browser_process_inner(exe_name, profile_id, user_data_dir)
}
