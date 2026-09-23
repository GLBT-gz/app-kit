//! @responsibility
//! 读取"版本服务器基础 URL"，按优先级：
//!   1. 运行时进程环境变量 `GLBT_UPDATE_BASE_URL`（dev/prod 切换、最高优先级）
//!   2. 编译时 OS env（build.rs 注入，release 二进制固化）
//!
//! @hard-rules
//! - 本模块是「公司版本服务器 IP 192.168.3.51」字面值的**唯一替换入口**。
//! - 严禁加入 fallback 到 127.0.0.1 / localhost / 调用者 IP 的设计。
//! - 同事电脑运行 release 二进制时，应当使用 release 嵌入的 URL，
//!   不能把"自己电脑"当成版本服务器（参见 frame-update-2026-09-23）。
//!
//! @接口清单
//! - `update_base_url() -> String`
//! - `update_server_versions_url(app_id: &str) -> String`   拼 `/api/versions/<id>`
//! - `update_server_update_url(app_id: &str) -> String`     拼 `/api/update/<id>`

use std::env;

/// 读取版本服务器基础 URL。
///
/// 优先级：
/// 1. 运行时 OS env `GLBT_UPDATE_BASE_URL`（最强，dev/prod 切换用）
/// 2. 编译时 OS env `GLBT_UPDATE_BASE_URL`（build.rs 注入；缺失时此处 panic）
pub fn update_base_url() -> String {
    // 1) 运行时 OS env 优先
    if let Ok(v) = env::var("GLBT_UPDATE_BASE_URL") {
        if !v.is_empty() {
            return v;
        }
    }
    // 2) 编译期常量（build.rs 注入；缺失时此处编译期 panic——刻意设计，不留 fallback）
    env!("GLBT_UPDATE_BASE_URL").to_string()
}

/// 拼接 `/api/versions/<app_id>` 形式的版本历史 URL
pub fn update_server_versions_url(app_id: &str) -> String {
    let base = update_base_url().trim_end_matches('/').to_string();
    format!("{}/api/versions/{}", base, app_id)
}

/// 拼接 `/api/update/<app_id>` 形式的 Tauri updater 检查 URL
pub fn update_server_update_url(app_id: &str) -> String {
    let base = update_base_url().trim_end_matches('/').to_string();
    format!("{}/api/update/{}", base, app_id)
}
