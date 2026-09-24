//! @responsibility
//! GLBT 客户端通过 NAS SMB 直连读取版本元数据与复制安装包；
//! 不再走 HTTP 版本服务器（用户 2026-09-23 决定）。
//!
//! 数据源：公司 NAS SMB UNC 路径，所有同事电脑开箱即用（公司内网全可达）。
//!
//! @接口清单
//! - `nas_base() -> &'static str`           公共常量路径
//! - `read_versions(app_id) -> Result<String, String>`
//!     从 `<nas_base>\<app_id>\versions.json` 读 JSON 字符串（raw bytes 已 utf-8-sig 处理）
//! - `install(smb_path, save_path) -> Result<String, String>`
//!     std::fs::copy 安装包到目标路径
//!
//! @hard-rules
//! - **单一来源**：所有 GLBT 客户端读取同一 SMB 路径；
//!   不写版本服务器代码、不维护 IP、不设 env 变量。
//! - **路径常量**：`nas_base()` 是 const str，编译期嵌入；
//!   路径修改需要重 build（但 GLBT 业务约定 NAS 路径稳定）。

/// GLBT 发行包 NAS 共享路径（公司内网 SMB UNC，所有同事电脑只读访问）。
pub fn nas_base() -> &'static str {
    r"\\Nas2025\Rpa数据\#软件发行"
}

/// 给定 app_id，构造 versions.json 的完整 SMB 路径。
pub fn versions_path(app_id: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(nas_base()).join(app_id).join("versions.json")
}

/// 从 NAS 读取 versions.json 原始字符串（utf-8-sig 处理 BOM）。
/// 失败时 err 包含路径，方便同事看到具体哪个 app/路径读不到。
pub fn read_versions(app_id: &str) -> Result<String, String> {
    let p = versions_path(app_id);
    std::fs::read_to_string(&p).map_err(|e| {
        format!(
            "读取发行包元数据失败: app_id={} path={} err={}",
            app_id,
            p.display(),
            e
        )
    })
}

/// 从 SMB 路径复制安装包到本地目标路径。简单 std::fs::copy（NAS 是内网，千兆带宽瞬时完成，无流式进度需求）。
/// 若以后需大文件 + 进度回调，再换 Read+Seek+emit。
pub fn install(smb_path: &str, save_path: &str) -> Result<String, String> {
    std::fs::copy(smb_path, save_path).map_err(|e| {
        format!(
            "复制安装包失败: smb={} save={} err={}",
            smb_path,
            save_path,
            e
        )
    })?;
    Ok(save_path.to_string())
}