//! 凭证文件读写通用工具
//!
//! 提供 JSON Map 级别的原子读写，各项目自行管理结构体序列化/反序列化。
//! 密码加密/解密请使用 `crypto` 模块。
//!
//! ## 规范
//!
//! - 密码字段值必须先用 `crypto::encrypt_password` 加密后再写入，
//!   读取后用 `crypto::decrypt_password` 解密。
//! - 文件路径: `{data_dir}/credentials.json`
//! - 旧格式 `{ "data": "<encrypted_blob>" }` 在加载时自动清空。
//!
//! ## 项目使用示例
//!
//! ```ignore
//! use appkit_core::store::{credentials, crypto};
//!
//! // 保存
//! let mut map = serde_json::Map::new();
//! map.insert("my_user".into(), serde_json::json!("admin"));
//! map.insert("my_pwd".into(), serde_json::json!(crypto::encrypt_password("secret", KEY)?));
//! credentials::save_map(&map, &data_dir)?;
//!
//! // 加载
//! let map = credentials::load_map(&data_dir)?;
//! let user = map["my_user"].as_str().unwrap_or("");
//! let pwd = crypto::decrypt_password(map["my_pwd"].as_str().unwrap_or(""), KEY).unwrap_or_default();
//! ```

use crate::store::crypto;
use std::path::Path;

/// 凭证文件路径
fn file_path(data_dir: &Path) -> std::path::PathBuf {
    crypto::credentials_file_path(data_dir, "credentials.json")
}

/// 将字段 Map（密码需已加密）原子写入凭证文件
pub fn save_map(
    fields: &serde_json::Map<String, serde_json::Value>,
    data_dir: &Path,
) -> anyhow::Result<()> {
    let path = file_path(data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let json = serde_json::to_string_pretty(fields)?;

    // 原子写入
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json)?;
    std::fs::rename(&tmp_path, &path)?;

    Ok(())
}

/// 从凭证文件加载原始字段 Map（密码仍为加密状态）
///
/// 文件不存在时返回空 Map。检测到旧格式 `{ "data": "..." }` 时自动删除。
pub fn load_map(
    data_dir: &Path,
) -> anyhow::Result<serde_json::Map<String, serde_json::Value>> {
    let path = file_path(data_dir);
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }

    let content = std::fs::read_to_string(&path)?;
    let parsed: serde_json::Value = serde_json::from_str(&content)?;

    // 检测旧格式 { "data": "..." } → 直接清空
    if parsed["data"].is_string() {
        eprintln!("[credentials] 检测到旧格式文件，已删除，请重新输入凭证");
        let _ = std::fs::remove_file(&path);
        return Ok(serde_json::Map::new());
    }

    Ok(parsed.as_object().cloned().unwrap_or_default())
}
