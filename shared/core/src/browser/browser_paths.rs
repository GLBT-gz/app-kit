//! 浏览器注册表/版本/可执行文件路径检测、Edge/Chrome 检测

use crate::browser::BrowserInfo;
use std::fs;
use std::path::Path;
use super::browser_profiles::read_profiles;
use super::browser_register::custom_detector;
use super::icons::{CHROME_ICO, EDGE_ICO};
use winreg::enums::*;
use winreg::RegKey;


// ============ 注册表检测 ============

fn find_exe_in_registry(key_path: &str, value_name: &str) -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) = hklm.open_subkey_with_flags(key_path, KEY_READ) {
        if let Ok(val) = key.get_value::<String, _>(value_name) {
            if Path::new(&val).exists() {
                return Some(val);
            }
        }
    }
    None
}

fn check_standard_paths(paths: &[&str]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| Path::new(p).exists())
        .map(|p| p.to_string())
        .collect()
}

pub(crate) fn get_system_download_dir() -> String {
    dirs::download_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("C:\\")))
        .to_string_lossy()
        .to_string()
}


// ============ 浏览器版本 ============

/// 从注册表读取浏览器版本（支持多个备选路径）
pub(crate) fn get_browser_version(browser_type: &str) -> String {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // 尝试从指定注册表路径读取版本
    let try_read = |subkey: &str, value: &str| -> Option<String> {
        if let Ok(key) = hklm.open_subkey_with_flags(subkey, KEY_READ | KEY_WOW64_64KEY) {
            if let Ok(ver) = key.get_value::<String, _>(value) {
                if !ver.is_empty() {
                    return Some(ver);
                }
            }
        }
        // 尝试从 32 位注册表读取（WOW6432Node）
        if let Ok(key) = hklm.open_subkey_with_flags(subkey, KEY_READ | KEY_WOW64_32KEY) {
            if let Ok(ver) = key.get_value::<String, _>(value) {
                if !ver.is_empty() {
                    return Some(ver);
                }
            }
        }
        None
    };

    match browser_type {
        "edge" => {
            // 主路径：BLBeacon
            if let Some(ver) = try_read(
                r"SOFTWARE\Microsoft\Edge\BLBeacon",
                "version",
            ) {
                return ver;
            }
            // 备选：Uninstall 注册表
            if let Some(ver) = try_read(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge",
                "DisplayVersion",
            ) {
                return ver;
            }
        }
        "chrome" => {
            // Chrome Stable
            if let Some(ver) = try_read(
                r"SOFTWARE\Google\Update\Clients\{8A69D345-D564-463c-AFF1-A69D9E530F96}",
                "pv",
            ) {
                return ver;
            }
            // 备选：Uninstall 注册表
            if let Some(ver) = try_read(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Google Chrome",
                "DisplayVersion",
            ) {
                return ver;
            }
        }
        _ => {}
    }
    String::new()
}


// ============ 可执行文件路径 ============

pub(crate) fn get_exe_paths(browser_type: &str) -> Vec<String> {
    match browser_type {
        "edge" => {
            let mut paths = Vec::new();
            // 注册表
            if let Some(p) = find_exe_in_registry(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
                "",
            ) {
                paths.push(p);
            }
            if let Some(p) = find_exe_in_registry(
                r"SOFTWARE\Microsoft\Edge\BLBeacon",
                "version",
            ) {
                // 注册表中的 version 值的父键可能有 exe 路径
                let exe = format!(
                    r"{}\msedge.exe",
                    std::path::Path::new(&p)
                        .parent()
                        .map(|d| d.to_string_lossy())
                        .unwrap_or(std::borrow::Cow::Borrowed(""))
                );
                if Path::new(&exe).exists() {
                    paths.push(exe);
                }
            }
            // 标准安装路径
            let standard = check_standard_paths(&[
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                &format!(
                    r"{}\Microsoft\Edge\Application\msedge.exe",
                    dirs::data_local_dir()
                        .map(|d| d.to_string_lossy().to_string())
                        .unwrap_or_default()
                ),
            ]);
            paths.extend(standard);
            paths.sort();
            paths.dedup();
            // 未安装时提供默认路径以便用户自行填写
            if paths.is_empty() {
                paths.push(
                    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
                        .to_string(),
                );
            }
            paths
        }
        "chrome" => {
            let mut paths = Vec::new();
            if let Some(p) = find_exe_in_registry(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                "",
            ) {
                paths.push(p);
            }
            let standard = check_standard_paths(&[
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                &format!(
                    r"{}\Google\Chrome\Application\chrome.exe",
                    dirs::data_local_dir()
                        .map(|d| d.to_string_lossy().to_string())
                        .unwrap_or_default()
                ),
            ]);
            paths.extend(standard);
            paths.sort();
            paths.dedup();
            // 未安装时提供默认路径以便用户自行填写
            if paths.is_empty() {
                paths.push(
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe"
                        .to_string(),
                );
            }
            paths
        }
        _ => {
            // 注册式：自定义浏览器类型的 exe 路径由注册的检测器提供
            if let Some(det) = custom_detector(browser_type) {
                (det.detect)().exe_paths
            } else {
                Vec::new()
            }
        }
    }
}

pub(crate) fn get_user_data_dir(browser_type: &str) -> Option<String> {
    let local_app_data = dirs::data_local_dir()?;
    match browser_type {
        "edge" => Some(
            format!(
                r"{}\Microsoft\Edge\User Data",
                local_app_data.to_string_lossy()
            ),
        ),
        "chrome" => Some(
            format!(
                r"{}\Google\Chrome\User Data",
                local_app_data.to_string_lossy()
            ),
        ),
        _ => {
            // 注册式：自定义浏览器类型的用户数据目录由注册的检测器提供
            if let Some(det) = custom_detector(browser_type) {
                let info = (det.detect)();
                if info.default_user_data_dir.is_empty() {
                    None
                } else {
                    Some(info.default_user_data_dir)
                }
            } else {
                None
            }
        }
    }
}

pub(crate) fn scan_peer_user_data_dirs(default_user_data_dir: &str) -> Vec<String> {
    if default_user_data_dir.is_empty() {
        return vec![];
    }
    let parent = Path::new(default_user_data_dir)
        .parent()
        .map(|p| p.to_path_buf());
    let Some(parent) = parent else { return vec![] };
    if !parent.exists() {
        return vec![];
    }
    let default_name = Path::new(default_user_data_dir)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(&parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name == default_name {
                continue;
            }
            // 检查是否为有效的用户数据目录（含有 Local State）
            let ls = path.join("Local State");
            if ls.exists() {
                result.push(path.to_string_lossy().to_string());
            }
        }
    }
    result
}

/// 扫描品牌目录下的大小写不敏感 RPA 变体目录（如 "Edge Rpa"、"Chrome RPA"）
/// 返回其下所有含 Local State 的子目录
pub(crate) fn scan_brand_rpa_dirs(brand: &str, default_user_data_dir: &str) -> Vec<String> {
    // default_user_data_dir = "...\Microsoft\Edge\User Data"
    // parent = "...\Microsoft\Edge"
    // parent.parent = "...\Microsoft" → 遍历找到 "...\Microsoft\Edge Rpa"
    let parent_parent = match Path::new(default_user_data_dir)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
    {
        Some(p) => p,
        None => return vec![],
    };
    let rpa_target = format!("{} rpa", brand).to_lowercase();
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(&parent_parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            if name != rpa_target {
                continue;
            }
            // 找到了 RPA 目录，扫描其下所有含 Local State 的子目录
            if let Ok(subs) = fs::read_dir(&path) {
                for sub in subs.flatten() {
                    let sub_path = sub.path();
                    if !sub_path.is_dir() {
                        continue;
                    }
                    if sub_path.join("Local State").exists() {
                        result.push(sub_path.to_string_lossy().to_string());
                    }
                }
            }
            break;
        }
    }
    result
}

/// 从可执行文件读取版本号
fn get_file_version(exe_path: &str) -> String {
    if exe_path.is_empty() {
        return String::new();
    }
    #[cfg(windows)]
    if let Ok(output) = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(format!("(Get-Item '{}').VersionInfo.FileVersion", exe_path.replace('\'', "''")))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
    } {
        let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !ver.is_empty() { ver } else { String::new() }
    } else {
        String::new()
    }
}

// ============ 检测 Edge ============

pub(crate) fn detect_edge() -> BrowserInfo {
    let exe_paths = get_exe_paths("edge");
    let installed = !exe_paths.is_empty();
    let default_user_data = get_user_data_dir("edge").unwrap_or_default();
    let user_data_dirs = if !default_user_data.is_empty() {
        vec![default_user_data.clone()]
    } else {
        Vec::new()
    };
    let mut suggested = scan_peer_user_data_dirs(&default_user_data);
    suggested.extend(scan_brand_rpa_dirs("Edge", &default_user_data));
    let version = get_file_version(exe_paths.first().map_or("", |p| p.as_str()));
    let default_dir = default_user_data.clone();
    let profiles = if !default_dir.is_empty() {
        read_profiles(&default_dir, true)
    } else {
        Vec::new()
    };

    BrowserInfo {
        browser_type: "edge".to_string(),
        browser_name: "Microsoft Edge".to_string(),
        browser_icon_base64: EDGE_ICO.to_string(),
        installed,
        exe_paths,
        user_data_dirs,
        default_user_data_dir: default_user_data,
        default_debug_port: 0,
        browser_version: version,
        suggested_user_data_dirs: suggested,
        profiles,
        children: vec![],
    }
}

// ============ 检测 Chrome ============

pub(crate) fn detect_chrome() -> BrowserInfo {
    let exe_paths = get_exe_paths("chrome");
    let installed = !exe_paths.is_empty();
    let default_user_data = get_user_data_dir("chrome").unwrap_or_default();
    let user_data_dirs = if !default_user_data.is_empty() {
        vec![default_user_data.clone()]
    } else {
        Vec::new()
    };
    let mut suggested = scan_peer_user_data_dirs(&default_user_data);
    suggested.extend(scan_brand_rpa_dirs("Chrome", &default_user_data));
    let version = get_file_version(exe_paths.first().map_or("", |p| p.as_str()));
    let default_dir = default_user_data.clone();
    let profiles = if !default_dir.is_empty() {
        read_profiles(&default_dir, false)
    } else {
        Vec::new()
    };

    BrowserInfo {
        browser_type: "chrome".to_string(),
        browser_name: "Google Chrome".to_string(),
        browser_icon_base64: CHROME_ICO.to_string(),
        installed,
        exe_paths,
        user_data_dirs,
        default_user_data_dir: default_user_data,
        default_debug_port: 0,
        browser_version: version,
        suggested_user_data_dirs: suggested,
        profiles,
        children: vec![],
    }
}

