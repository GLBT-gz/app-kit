pub mod config;
pub mod encoding;
pub mod store;
pub mod system;
pub mod update_server;

/// 浏览器检测/配置/进程管理（仅启用 `cmd-browser` 时编译）
#[cfg(feature = "cmd-browser")]
pub mod browser;

#[cfg(feature = "bridge")]
pub mod tauri_bridge;

pub use config::*;
pub use encoding::*;
pub use store::*;
pub use system::*;

#[cfg(feature = "cmd-browser")]
pub use browser::*;
