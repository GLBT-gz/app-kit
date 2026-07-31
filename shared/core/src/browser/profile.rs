use crate::browser::{BrowserProfile, BrowserType};
use anyhow::{Context, Result};
use base64::Engine;
use std::path::{Path, PathBuf};
use tracing::info;

/// 从用户数据目录中读取所有浏览器Profile
pub fn read_profiles(browser_type: BrowserType, user_data_dir: &PathBuf) -> Result<Vec<BrowserProfile>> {
    let local_state_path = user_data_dir.join("Local State");
    if !local_state_path.exists() {
        anyhow::bail!("Local State 文件不存在: {}", local_state_path.display());
    }

    let content = std::fs::read_to_string(&local_state_path)
        .with_context(|| format!("读取 Local State 失败: {}", local_state_path.display()))?;

    let local_state: serde_json::Value = serde_json::from_str(&content)
        .with_context(|| "解析 Local State JSON 失败")?;

    let info_cache = local_state["profile"]["info_cache"]
        .as_object()
        .context("Local State 中缺少 profile.info_cache")?;

    let mut profiles = Vec::new();

    for (profile_id, info) in info_cache {
        let name = info["name"].as_str().unwrap_or(profile_id).to_string();
        let profile_path = user_data_dir.join(profile_id);

        // 读取下载目录
        let download_dir = if browser_type == BrowserType::Edge {
            read_edge_preferences(&profile_path)
        } else {
            read_chrome_preferences(&profile_path)
        };

        // 读取头像
        let avatar = read_avatar(&profile_path, info);

        // 读取邮箱
        let email = info["gaia_name"].as_str().map(|s| s.to_string())
            .or_else(|| info["user_name"].as_str().map(|s| s.to_string()));

        profiles.push(BrowserProfile {
            id: profile_id.clone(),
            name,
            user_data_dir: user_data_dir.clone(),
            profile_path,
            download_dir,
            avatar_base64: avatar,
            email,
            extra_args: vec![],
        });
    }

    // Default 排第一
    profiles.sort_by(|a, b| {
        if a.id == "Default" {
            std::cmp::Ordering::Less
        } else if b.id == "Default" {
            std::cmp::Ordering::Greater
        } else {
            a.id.cmp(&b.id)
        }
    });

    info!("从 {} 读取到 {} 个Profile", user_data_dir.display(), profiles.len());
    Ok(profiles)
}

/// 从用户数据目录中检测 Profile（不依赖 Local State）
pub fn read_profiles_from_dir(browser_type: BrowserType, user_data_dir: &PathBuf) -> Result<Vec<BrowserProfile>> {
    if !user_data_dir.exists() {
        anyhow::bail!("用户数据目录不存在: {}", user_data_dir.display());
    }

    // 先尝试通过 Local State 读取
    let local_state_path = user_data_dir.join("Local State");
    if local_state_path.exists() {
        return read_profiles(browser_type, user_data_dir);
    }

    // 回退：扫描目录下的 Profile 目录
    let mut profiles = Vec::new();
    for entry in std::fs::read_dir(user_data_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = entry.file_name();
        let dir_name_str = dir_name.to_string_lossy();

        // 只匹配 "Default" 或 "Profile N"
        if dir_name_str != "Default" && !dir_name_str.starts_with("Profile ") {
            continue;
        }

        let prefs_path = path.join("Preferences");
        let download_dir = if prefs_path.exists() {
            read_download_dir_from_prefs(&prefs_path)
        } else {
            None
        };

        profiles.push(BrowserProfile {
            id: dir_name_str.to_string(),
            name: dir_name_str.to_string(),
            user_data_dir: user_data_dir.clone(),
            profile_path: path,
            download_dir,
            avatar_base64: None,
            email: None,
            extra_args: vec![],
        });
    }

    profiles.sort_by(|a, b| {
        if a.id == "Default" {
            std::cmp::Ordering::Less
        } else if b.id == "Default" {
            std::cmp::Ordering::Greater
        } else {
            a.id.cmp(&b.id)
        }
    });

    Ok(profiles)
}

/// 读取 Edge 配置中的下载目录
fn read_edge_preferences(profile_path: &PathBuf) -> Option<PathBuf> {
    let prefs_path = profile_path.join("Preferences");
    read_download_dir_from_prefs(&prefs_path)
}

/// 读取 Chrome 配置中的下载目录
fn read_chrome_preferences(profile_path: &PathBuf) -> Option<PathBuf> {
    let prefs_path = profile_path.join("Preferences");
    read_download_dir_from_prefs(&prefs_path)
}

/// 从 Preferences JSON 中解析下载目录
/// 从 Preferences JSON 读取下载目录（供 management 模块复用）
pub fn read_download_dir_from_prefs(prefs_path: &Path) -> Option<PathBuf> {
    if !prefs_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(prefs_path).ok()?;
    let prefs: serde_json::Value = serde_json::from_str(&content).ok()?;

    let download_path = prefs["download"]["default_directory"]
        .as_str()?;

    Some(PathBuf::from(download_path))
}

/// 读取 Profile 头像
fn read_avatar(profile_path: &PathBuf, info: &serde_json::Value) -> Option<String> {
    // 策略1: 从文件系统读取 PNG/JPG 头像
    use base64::engine::general_purpose::STANDARD as BASE64;
    let avatar_patterns = [
        "Avatar Image.png",
        "Avatar Image.jpg",
        "Avatar Image.jpeg",
        "Google Profile Picture.png",
    ];

    for pattern in &avatar_patterns {
        let avatar_path = profile_path.join(pattern);
        if avatar_path.exists() {
            if let Ok(bytes) = std::fs::read(&avatar_path) {
                let mime = if bytes.len() > 8 && bytes[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
                    "image/png"
                } else if bytes.len() > 2 && bytes[0] == 0xFF && bytes[1] == 0xD8 {
                    "image/jpeg"
                } else {
                    continue;
                };
                let b64 = BASE64.encode(&bytes);
                return Some(format!("data:{};base64,{}", mime, b64));
            }
        }
    }

    // 策略2: 从 Preferences 中的 data:// URL 提取
    let prefs_path = profile_path.join("Preferences");
    if let Ok(content) = std::fs::read_to_string(&prefs_path) {
        if let Ok(prefs) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(avatar_url) = prefs["extensions"]["theme"]["gaia_info_picture_url"].as_str() {
                if avatar_url.starts_with("data:image") {
                    if let Some(comma_pos) = avatar_url.find(',') {
                        let b64 = avatar_url[comma_pos + 1..].to_string();
                        return Some(b64);
                    }
                }
            }
        }
    }

    // 策略3: 从 Local State 的 gaia_info_picture_url
    if let Some(url) = info["gaia_info_picture_url"].as_str() {
        if url.starts_with("data:image") {
            if let Some(comma_pos) = url.find(',') {
                return Some(url[comma_pos + 1..].to_string());
            }
        }
    }

    None
}



/// 验证 Profile 是否存在
pub fn validate_profile(_browser_type: &BrowserType, profile_id: &str, user_data_dir: &PathBuf) -> bool {
    let profile_path = user_data_dir.join(profile_id);
    if !profile_path.exists() || !profile_path.is_dir() {
        return false;
    }
    true
}
