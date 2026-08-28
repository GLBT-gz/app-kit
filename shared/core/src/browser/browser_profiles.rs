//! 读取浏览器用户配置（增强版，带进程级缓存）

use crate::browser::ProfileInfo;
use std::fs;
use std::path::Path;
use super::browser_avatar::{ImageData, find_image_data_url, read_avatar_base64, read_avatar_file_by_index, to_avatar_base64};
use super::browser_paths::get_system_download_dir;
use super::browser_process::profile_cache;

// ============ 读取用户配置 ============

/// 读取浏览器用户配置（增强版）
/// 结果缓存于进程级 HashMap 中，同一 (user_data_dir, is_edge) 组合避免重复解析磁盘；
/// 命中前校验 Local State 文件 mtime，文件变化后自动失效重读
pub fn read_profiles(user_data_dir: &str, is_edge: bool) -> Vec<ProfileInfo> {
    let local_state_path = Path::new(user_data_dir).join("Local State");
    // 进程级缓存：同一目录 + 同一 is_edge 参数避免重复解析；
    // 命中前校验 Local State 文件 mtime，文件已变化（改名/改头像等）则视为失效重读
    {
        let cache = profile_cache().lock().unwrap();
        if let Some((mtime, cached)) = cache.get(&(user_data_dir.to_string(), is_edge)) {
            let fresh = fs::metadata(&local_state_path)
                .and_then(|m| m.modified())
                .ok();
            if fresh.is_some() && &fresh == mtime {
                return cached.clone();
            }
        }
    }

    if !local_state_path.exists() {
        // 用户数据目录不存在 → 未安装该浏览器，无需报错
        if !Path::new(user_data_dir).exists() {
            return vec![];
        }
        eprintln!(
            "[read_profiles] 失败: Local State 文件不存在: {}",
            local_state_path.display()
        );
        return vec![];
    }

    let content = match fs::read_to_string(&local_state_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(
                "[read_profiles] 失败: 无法读取 Local State 文件 (可能被浏览器锁定): {} | 错误: {}",
                local_state_path.display(),
                e
            );
            return vec![];
        }
    };

    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            eprintln!(
                "[read_profiles] 失败: Local State JSON 解析错误: {} | 错误: {}",
                local_state_path.display(),
                e
            );
            return vec![];
        }
    };

    let info_cache = match json
        .pointer("/profile/info_cache")
        .and_then(|v| v.as_object())
    {
        Some(c) => c,
        None => {
            // 诊断：列出 /profile 下实际存在的 key
            let available_keys: Vec<&str> = json
                .pointer("/profile")
                .and_then(|v| v.as_object())
                .map(|obj| obj.keys().map(|k| k.as_str()).collect())
                .unwrap_or_default();
            eprintln!(
                "[read_profiles] 失败: Local State 中缺少 /profile/info_cache: {} | /profile 下实际 key: {:?}",
                local_state_path.display(),
                available_keys
            );
            return vec![];
        }
    };

    eprintln!(
        "[read_profiles] 成功: {} 找到 {} 个 profile entry",
        local_state_path.display(),
        info_cache.len()
    );

    let system_download = get_system_download_dir();
    let mut profiles = Vec::new();

    for (profile_id, info) in info_cache {
        let name = info
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(profile_id);

        // 从 info_cache 中获取更多信息
        let user_name = info
            .get("user_name")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let email = info
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let profile_path = Path::new(user_data_dir).join(profile_id);
        let profile_path_str = profile_path.to_string_lossy().to_string();

        // 读取头像（先尝试文件系统，再尝试 info_cache 条目中的 avatar_icon 等字段）
        let mut avatar = read_avatar_base64(&profile_path, is_edge);
        if avatar.base64.is_empty() {
            // 在 info_cache 中递归搜索 data:image/ 开头的值
            if let Some(pic_data) = find_image_data_url(info) {
                avatar = ImageData {
                    base64: pic_data,
                    is_icon: false,
                };
            }
        }
        if avatar.base64.is_empty() {
            // 检查 info_cache 中的 avatar_icon 是否为 HTTP URL
            if let Some(icon_url) = info
                .get("avatar_icon")
                .and_then(|v| v.as_str())
                .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
            {
                avatar = ImageData {
                    base64: icon_url.to_string(),
                    is_icon: false,
                };
            }
        }
        if avatar.base64.is_empty() {
            // 7. 新版 Chrome/Edge（151+）预设头像：Local State info_cache 记录
            //    avatar_icon=chrome://theme/IDR_PROFILE_AVATAR_N，图片按需下载缓存到
            //    {User Data}\Avatars\{文件名}。未登录但手动设置了预设头像的 profile 由此恢复。
            //    avatar_icon 来自已解析的 Local State JSON（info），无需重复读文件。
            if let Some(icon) = info.get("avatar_icon").and_then(|v| v.as_str()) {
                // 先尝试 Chrome 的 {User Data}\Avatars 缓存文件。
                // 注意：缓存目录在 user_data_dir 根层（{User Data}\Avatars），
                // 不在 profile 子目录（{User Data}\Profile N\Avatars）内。
                let mut data = read_avatar_file_by_index(&Path::new(user_data_dir), icon);
                // Edge 没有 Avatars 缓存目录，回退到内嵌预设头像资源表
                if data.is_none() && is_edge {
                    data = super::edge_avatars::read_edge_preset_avatar(icon);
                }
                if let Some(data) = data {
                    avatar = ImageData {
                        base64: to_avatar_base64(&data, "image/png"),
                        is_icon: false,
                    };
                }
            }
        }
        if avatar.base64.is_empty() {
            // 最后检查 Preferences 中的 gaia_info_picture_url
            let prefs_path = profile_path.join("Preferences");
            if let Ok(content) = fs::read_to_string(&prefs_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(url) = json.pointer("/profile/gaia_info_picture_url")
                        .and_then(|v| v.as_str())
                        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
                    {
                        avatar = ImageData {
                            base64: url.to_string(),
                            is_icon: false,
                        };
                    }
                }
            }
        }

        // 从 Preferences 读取下载目录
        let download_dir = super::profile::read_download_dir_from_prefs(&profile_path.join("Preferences"))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| system_download.clone());

        profiles.push(ProfileInfo {
            id: profile_id.clone(),
            name: name.to_string(),
            user_name: user_name.to_string(),
            email: email.to_string(),
            path: profile_path_str,
            user_data_dir: user_data_dir.to_string(),
            download_dir,
            avatar_base64: avatar.base64,
            avatar_has_icon: avatar.is_icon,
        });
    }

    // 按 profile id 排序（Default 排第一）
    profiles.sort_by(|a, b| {
        if a.id == "Default" {
            std::cmp::Ordering::Less
        } else if b.id == "Default" {
            std::cmp::Ordering::Greater
        } else {
            a.id.cmp(&b.id)
        }
    });

    // 写入缓存，后续相同参数的调用直接命中（记录文件 mtime，文件变化后自动失效）
    let mtime = fs::metadata(&local_state_path)
        .ok()
        .and_then(|m| m.modified().ok());
    profile_cache()
        .lock()
        .unwrap()
        .insert((user_data_dir.to_string(), is_edge), (mtime, profiles.clone()));

    profiles
}

