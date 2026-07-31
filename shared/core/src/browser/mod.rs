pub mod icons;
pub mod launch;
pub mod management;
pub mod profile;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 浏览器类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum BrowserType {
    Edge,
    Chrome,
}

impl BrowserType {
    pub fn as_str(&self) -> &'static str {
        match self {
            BrowserType::Edge => "edge",
            BrowserType::Chrome => "chrome",
        }
    }

    pub fn process_name(&self) -> &'static str {
        match self {
            BrowserType::Edge => "msedge.exe",
            BrowserType::Chrome => "chrome.exe",
        }
    }

    pub fn default_user_data_dir(&self) -> PathBuf {
        let local = dirs::data_local_dir().expect("Failed to get local app data dir");
        match self {
            BrowserType::Edge => local.join("Microsoft").join("Edge").join("User Data"),
            BrowserType::Chrome => local.join("Google").join("Chrome").join("User Data"),
        }
    }
}

/// 浏览器检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserInfo {
    pub browser_type: String,
    pub browser_name: String,
    pub browser_icon_base64: String,
    pub installed: bool,
    pub exe_paths: Vec<String>,
    pub user_data_dirs: Vec<String>,
    pub default_user_data_dir: String,
    pub default_debug_port: u16,
    pub browser_version: String,
    pub suggested_user_data_dirs: Vec<String>,
    pub profiles: Vec<ProfileInfo>,
    pub children: Vec<ChildBrowserConfig>,
}

/// 用户配置信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileInfo {
    pub id: String,
    pub name: String,
    pub user_name: String,
    pub email: String,
    pub path: String,
    pub user_data_dir: String,
    pub download_dir: String,
    pub avatar_base64: String,
    pub avatar_has_icon: bool,
}

/// 子浏览器配置（店铺窗口等特殊浏览器使用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChildBrowserConfig {
    pub user_data_dir: PathBuf,
    pub name: String,
    pub proxy_ip: Option<String>,
    pub enabled: bool,
}

/// 启动命令
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchInfo {
    pub exe_path: String,
    pub args: Vec<String>,
    pub command_line: String,
    pub debug_port: u16,
}

/// 浏览器用户Profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserProfile {
    pub id: String,                    // "Default", "Profile 1"...
    pub name: String,                  // 用户名称
    pub user_data_dir: PathBuf,        // 用户数据目录
    pub profile_path: PathBuf,         // 完整路径 = user_data_dir / id
    pub download_dir: Option<PathBuf>, // 下载目录
    pub avatar_base64: Option<String>, // 头像(base64)
    pub email: Option<String>,         // 邮箱
    pub extra_args: Vec<String>,       // 额外启动参数
}

impl BrowserProfile {
    pub fn full_profile_path(&self) -> PathBuf {
        self.user_data_dir.join(&self.id)
    }
}

/// 浏览器运行实例
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningInstance {
    pub pid: u32,
    pub port: u16,
    pub browser_type: BrowserType,
    pub ws_url: Option<String>, // CDP WebSocket URL
    pub profile_id: Option<String>,
}
