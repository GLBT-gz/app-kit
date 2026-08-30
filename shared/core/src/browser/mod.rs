pub mod edge_avatars;
pub mod icons;
pub mod launch;
pub mod management;
// management.rs 拆出的实现子模块（pub 项经 management 重导出）
mod browser_register;
mod browser_process;
mod browser_kill;
mod browser_avatar;
mod browser_paths;
mod browser_profiles;
pub mod profile;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 浏览器类型
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum BrowserType {
    Edge,
    Chrome,
    /// 注册式自定义浏览器类型：类型字符串由业务侧注册/传入，框架保持中性
    Registered(String),
}

impl BrowserType {
    pub fn as_str(&self) -> &str {
        match self {
            BrowserType::Edge => "edge",
            BrowserType::Chrome => "chrome",
            BrowserType::Registered(name) => name,
        }
    }

    pub fn process_name(&self) -> String {
        match self {
            BrowserType::Edge => "msedge.exe".to_string(),
            BrowserType::Chrome => "chrome.exe".to_string(),
            // 注册式浏览器的进程名由业务侧注册（kill 全部进程等场景）
            BrowserType::Registered(name) => {
                browser_register::registered_process_name(name).unwrap_or_default()
            }
        }
    }

    pub fn default_user_data_dir(&self) -> PathBuf {
        let local = dirs::data_local_dir().expect("Failed to get local app data dir");
        match self {
            BrowserType::Edge => local.join("Microsoft").join("Edge").join("User Data"),
            BrowserType::Chrome => local.join("Google").join("Chrome").join("User Data"),
            // 注册式浏览器的主程序/环境目录由业务侧检测器提供，框架不做假设
            BrowserType::Registered(_) => PathBuf::new(),
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
