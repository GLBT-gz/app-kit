//! 通用 AES-256-GCM 加密存储
//!
//! 提供基于 AES-256-GCM 的加密持久化能力，密钥由调用方提供 secret 通过 SHA-256 派生。
//! 适用于任意 `Serialize + DeserializeOwned + Default` 类型。

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

/// 从固定 secret 派生出 AES-256 密钥
fn derive_key(secret: &[u8]) -> [u8; 32] {
    let hash = Sha256::digest(secret);
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    key
}

/// 加密任意可序列化数据为 base64 字符串
fn encrypt<T: Serialize>(data: &T, key_secret: &[u8]) -> Result<String> {
    let json = serde_json::to_string(data)?;
    let key = derive_key(key_secret);
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| anyhow::anyhow!("创建 cipher 失败: {:?}", e))?;

    // 生成随机 nonce (12 bytes)
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, json.as_bytes())
        .map_err(|e| anyhow::anyhow!("加密失败: {:?}", e))?;

    // 拼装: nonce(12) + ciphertext
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&result))
}

/// 解密 base64 密文为指定类型
fn decrypt<T: DeserializeOwned>(encoded: &str, key_secret: &[u8]) -> Result<T> {
    let data = BASE64.decode(encoded).context("base64 解码失败")?;

    if data.len() < 12 {
        anyhow::bail!("密文数据太短");
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let key = derive_key(key_secret);
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| anyhow::anyhow!("创建 cipher 失败: {:?}", e))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("解密失败: {:?}", e))?;

    let result: T = serde_json::from_slice(&plaintext)?;
    Ok(result)
}

/// 加密保存数据到文件
///
/// * `data` - 要保存的数据
/// * `path` - 输出文件路径
/// * `key_secret` - 用于派生加密密钥的 secret
pub fn save<T: Serialize>(data: &T, path: &Path, key_secret: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("创建目录失败")?;
    }

    let encrypted = encrypt(data, key_secret)?;
    let content = serde_json::json!({ "data": encrypted });
    let json = serde_json::to_string_pretty(&content)?;

    // 原子写入
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json)
        .with_context(|| format!("写入临时文件失败: {}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, path)
        .with_context(|| format!("重命名文件失败: {} -> {}", tmp_path.display(), path.display()))?;

    Ok(())
}

/// 从加密文件加载数据，文件不存在时返回默认值
///
/// * `path` - 文件路径
/// * `key_secret` - 用于派生解密密钥的 secret
pub fn load<T: DeserializeOwned + Default>(path: &Path, key_secret: &[u8]) -> Result<T> {
    if !path.exists() {
        return Ok(T::default());
    }

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("读取文件失败: {}", path.display()))?;

    let parsed: serde_json::Value =
        serde_json::from_str(&content).context("解析文件失败")?;

    let encrypted = parsed["data"]
        .as_str()
        .context("文件格式错误: 缺少 data 字段")?;

    decrypt(encrypted, key_secret)
}

/// 公开解密函数：从 base64 密文字符串直接解密为指定类型（不涉及文件 I/O）
///
/// 用于 credentials 旧格式迁移等需要读取已解析 JSON 后再解密的场景。
pub fn decrypt_value<T: DeserializeOwned>(encoded: &str, key_secret: &[u8]) -> Result<T> {
    decrypt(encoded, key_secret)
}
