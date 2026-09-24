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

/// 历史短名（Rust 端 `const APP_ID`） → NAS 目录名（`000-template` / `016-auto-withdraw` 等）。
/// 17 fork 项目的 `const APP_ID` 都是历史短名（"template" / "withdraw" 等），本表把它们映射到 NAS 实际目录。
/// fallback：app_id 若不在表中，原样返回（假设调用方已传完整目录名）。
const APP_ID_MAP: &[(&str, &str)] = &[
    ("template", "000-template"),
    ("dxm-purchase", "001-dxm-purchase"),
    ("temu-ops", "002-temu-ops"),
    ("reorder-stock", "003-reorder-stock"),
    ("dxm-cost", "004-dxm-cost"),
    ("profit-calc", "005-profit-calc"),
    ("excel-ops", "005-excel-ops"),
    ("overseas-stock-sync", "006-overseas-stock-sync"),
    ("product-listing", "010-product-listing"),
    ("inventory-turnover", "007-inventory-turnover"),
    ("ziniao-ops", "008-ziniao-ops"),
    ("withdraw", "016-auto-withdraw"),
    ("software-manager", "900-software-manager"),
    ("agent", "999-agent"),
];

/// 历史短名 → NAS 目录名（未命中时原样返回）。
pub fn app_id_to_dir(app_id: &str) -> &str {
    APP_ID_MAP
        .iter()
        .find(|(k, _)| *k == app_id)
        .map(|(_, v)| *v)
        .unwrap_or(app_id)
}

/// 给定 app_id（历史短名或完整目录名），构造 versions.json 的完整 SMB 路径。
/// 自动经 APP_ID_MAP 映射 → 与 NAS 实际目录一致。
pub fn versions_path(app_id: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(nas_base())
        .join(app_id_to_dir(app_id))
        .join("versions.json")
}

/// 从 NAS 读取 versions.json 原始字符串（**strip UTF-8 BOM**）。
/// 失败时 err 包含路径，方便同事看到具体哪个 app/路径读不到。
/// BOM 处理：versions.json 文件以 UTF-8 with BOM 保存（之前 glbt-releases 仓的版本习惯）；
/// std::fs::read_to_string 用 utf-8 解码会**保留 BOM** (U+FEFF)，客户端 JS JSON.parse 看到 BOM 直接抛错。
/// 改为先读 bytes + strip prefix BOM 后再 to_string。
pub fn read_versions(app_id: &str) -> Result<String, String> {
    let p = versions_path(app_id);
    let bytes = std::fs::read(&p).map_err(|e| {
        format!(
            "读取发行包元数据失败: app_id={} path={} err={}",
            app_id,
            p.display(),
            e
        )
    })?;
    let text = std::str::from_utf8(&bytes).map_err(|e| {
        format!(
            "解码 versions.json UTF-8 失败: app_id={} path={} err={}",
            app_id,
            p.display(),
            e
        )
    })?;
    // strip leading UTF-8 BOM (U+FEFF) if present
    Ok(text.strip_prefix('\u{FEFF}').unwrap_or(text).to_string())
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