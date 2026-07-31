use serde::{Deserialize, Serialize};

pub mod store;

/// 应用配置顶层结构
///
/// 浏览器相关数据由前端 localStorage 管理，不持久化到 config.json。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// 保留非浏览器配置（如主题、界面设置等），用 #[serde(default)] 兼容旧文件
    #[serde(default)]
    pub show_history: Option<bool>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            show_history: None,
        }
    }
}

/// 主题配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeConfig {
    /// 深色模式
    pub dark_mode: bool,
    /// 主题色相 (0-360)
    pub accent_hue: f64,
    /// 窗口置顶
    pub always_on_top: bool,
    /// 数据时间戳 (毫秒)，用于双端同步冲突检测
    #[serde(default)]
    pub _ts: u64,
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            dark_mode: true,
            accent_hue: 210.0,
            always_on_top: false,
            _ts: 0,
        }
    }
}

/// 端口映射条目（前端展示用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortEntry {
    pub user_data_dir: String,
    pub profile_id: String,
    pub port: String,
    /// 是否为真实运行的浏览器进程（true=正在运行，false=仅为预设端口）
    pub is_running: bool,
}

/// 全量应用数据（从 Rust 内存缓存一次性推送）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    pub theme: ThemeConfig,
    pub config: AppConfig,
}
