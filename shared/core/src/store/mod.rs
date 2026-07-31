//! 通用数据持久化模块
//!
//! 提供共享的数据存储能力：
//! - `crypto` — AES-256-GCM 加密/解密工具（各项目可复用）
//! - `encrypted` — AES-256-GCM 加密存储
//! - `json` — 原子写入的 JSON 文件存储

pub mod crypto;
pub mod encrypted;
pub mod json;
