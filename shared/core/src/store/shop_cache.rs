//! 店铺缓存（多平台店铺统一存储）
//!
//! 获取店铺列表后自动缓存到 `shop_cache.json`。
//! 用户可编辑所属人、别名、备注，保存在同一文件中。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 单个缓存店铺
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedShop {
    pub mall_name: String,
    pub mall_id: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub alias: String,
    #[serde(default)]
    pub remark: String,
}

/// 排序规则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortRule {
    /// 排序字段：""（不排序）| "mall_name" | "owner" | "alias"
    #[serde(default)]
    pub field: String,
    /// 排序方向："asc" | "desc"
    #[serde(default)]
    pub order: String,
}

impl Default for SortRule {
    fn default() -> Self {
        Self {
            field: String::new(),
            order: String::from("asc"),
        }
    }
}

/// 店铺缓存（多平台店铺统一结构）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShopCache {
    pub gz_shops: Vec<CachedShop>,
    pub hk_shops: Vec<CachedShop>,
    #[serde(default)]
    pub gz_sort: SortRule,
    #[serde(default)]
    pub hk_sort: SortRule,
}

impl Default for ShopCache {
    fn default() -> Self {
        Self {
            gz_shops: Vec::new(),
            hk_shops: Vec::new(),
            gz_sort: SortRule::default(),
            hk_sort: SortRule::default(),
        }
    }
}

/// 缓存文件路径
fn file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("shop_cache.json")
}

/// 保存店铺缓存
pub fn save(cache: &ShopCache, data_dir: &Path) -> Result<(), String> {
    let path = file_path(data_dir);
    super::json::save(cache, &path)
}

/// 加载店铺缓存，文件不存在时返回默认值
pub fn load(data_dir: &Path) -> ShopCache {
    let path = file_path(data_dir);
    super::json::load(&path)
}
