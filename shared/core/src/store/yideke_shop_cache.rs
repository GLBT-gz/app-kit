//! 易得客店铺缓存
//!
//! 打开 shops.edecker.cn 工作台后抓取店铺列表，
//! 与 discover_shop_profiles() 扫描的 Profile 按 IP 合并后缓存到 `yideke_shop_cache.json`。
//! 测试3/4 直接从缓存读取店铺列表，无需重复扫描。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 单个易得客缓存的店铺
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YidekeCachedShop {
    /// 店铺名（从工作台 .shop-name 抓取）
    #[serde(default)]
    pub shop_name: String,
    /// IP 地址（匹配 Profile 用）
    #[serde(default)]
    pub ip: String,
    /// Profile 目录名（如 "shop_20260714..._114.55.173.79_..."）
    #[serde(default)]
    pub dir_name: String,
    /// CDP 端口号
    #[serde(default)]
    pub cdp_port: u16,
    /// Profile 路径
    #[serde(default)]
    pub profile_path: String,
}

/// 易得客店铺缓存
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YidekeShopCache {
    pub shops: Vec<YidekeCachedShop>,
}

impl Default for YidekeShopCache {
    fn default() -> Self {
        Self { shops: Vec::new() }
    }
}

/// 缓存文件路径
fn file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("yideke_shop_cache.json")
}

/// 保存易得客店铺缓存
pub fn save(cache: &YidekeShopCache, data_dir: &Path) -> Result<(), String> {
    let path = file_path(data_dir);
    super::json::save(cache, &path)
}

/// 加载易得客店铺缓存，文件不存在时返回默认值
pub fn load(data_dir: &Path) -> YidekeShopCache {
    let path = file_path(data_dir);
    super::json::load(&path)
}
