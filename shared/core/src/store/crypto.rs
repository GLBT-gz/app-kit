//! AES-256-GCM 凭证加密/解密工具
//!
//! 提供密码加密与解密的基础工具函数，供各项目凭证模块复用。
//! 各项目使用各自独立的密钥 secret，密码通过 AES-256-GCM 加密后以 base64 存储。
//! 账号/用户名则以明文存储。
//!
//! ## 使用示例
//!
//! ```ignore
//! use appkit_core::store::crypto;
//!
//! let password_enc = crypto::encrypt_password("mypassword", MY_SECRET)?;
//! let password_dec = crypto::decrypt_password(&password_enc, MY_SECRET)?;
//! ```

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::path::Path;

/// 从 secret 派生 AES-256 密钥（SHA-256 哈希截取 32 字节）
pub(crate) fn derive_key(secret: &[u8]) -> [u8; 32] {
    let hash = Sha256::digest(secret);
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    key
}

/// 加密单个密码为 base64 字符串
pub fn encrypt_password(password: &str, key_secret: &[u8]) -> anyhow::Result<String> {
    let key = derive_key(key_secret);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| anyhow::anyhow!("创建 cipher 失败: {:?}", e))?;

    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .map_err(|e| anyhow::anyhow!("加密失败: {:?}", e))?;

    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&result))
}

/// 解密 base64 密文字符串为密码明文
pub fn decrypt_password(encoded: &str, key_secret: &[u8]) -> anyhow::Result<String> {
    let data = BASE64
        .decode(encoded)
        .map_err(|e| anyhow::anyhow!("base64 解码失败: {}", e))?;

    if data.len() < 12 {
        anyhow::bail!("密文数据太短");
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let key = derive_key(key_secret);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| anyhow::anyhow!("创建 cipher 失败: {:?}", e))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("解密失败: {:?}", e))?;

    String::from_utf8(plaintext).map_err(|e| anyhow::anyhow!("UTF-8 解码失败: {}", e))
}

/// 凭证文件路径（`{data_dir}/{filename}`）
pub fn credentials_file_path(data_dir: &Path, filename: &str) -> std::path::PathBuf {
    data_dir.join(filename)
}
