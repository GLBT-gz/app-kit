//! 通用数据持久化模块
//!
//! 提供共享的数据存储能力：
//! - `crypto` — AES-256-GCM 加密/解密工具（各项目可复用）
//! - `credentials` — 凭证 Map 原子读写
//! - `encrypted` — AES-256-GCM 加密存储
//! - `json` — 原子写入的 JSON 文件存储
//! - `shop_cache` — 店铺缓存类型与 JSON 存储

pub mod credentials;
pub mod crypto;
pub mod encrypted;
pub mod json;
pub mod shop_cache;
