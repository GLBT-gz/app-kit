//! CDP 页面域命令（截图/对话框/页面控制/设备模拟/Frame/控制台/Accessibility）——从 commands.rs 拆出

use super::connection::CdpConnection;
use anyhow::{Context, Result};
use serde_json::Value;

// ==================== 截图 ====================

/// 截取页面截图
pub async fn page_capture_screenshot(conn: &CdpConnection, format: &str) -> Result<Vec<u8>> {
    let result = conn
        .send_command(
            "Page.captureScreenshot",
            serde_json::json!({"format": format}),
        )
        .await?;

    let data = result["data"]
        .as_str()
        .context("截图返回数据为空")?;

    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data,
    )?;

    Ok(bytes)
}

// ==================== 导航历史 ====================

/// 获取标签页导航历史（后退/前进列表）
pub async fn page_get_navigation_history(conn: &CdpConnection) -> Result<Value> {
    let result = conn
        .send_command("Page.getNavigationHistory", Value::Null)
        .await?;
    Ok(result)
}

// ==================== 对话框处理 ====================

/// 处理 JavaScript 对话框（alert/confirm/prompt）
pub async fn page_handle_java_script_dialog(
    conn: &CdpConnection,
    accept: bool,
    prompt_text: Option<&str>,
) -> Result<()> {
    let mut params = serde_json::json!({
        "accept": accept,
    });
    if let Some(t) = prompt_text {
        params["promptText"] = serde_json::json!(t);
    }
    conn.send_command("Page.handleJavaScriptDialog", params).await?;
    Ok(())
}

// ==================== 文件上传 ====================

/// 设置文件输入元素的值
pub async fn dom_set_file_input_files(
    conn: &CdpConnection,
    node_id: i64,
    files: &[String],
) -> Result<()> {
    conn.send_command(
        "DOM.setFileInputFiles",
        serde_json::json!({
            "nodeId": node_id,
            "files": files,
        }),
    ).await?;
    Ok(())
}

// ==================== 页面控制 ====================

/// 将标签页提到前台
pub async fn page_bring_to_front(conn: &CdpConnection) -> Result<()> {
    conn.send_command("Page.bringToFront", serde_json::json!({})).await?;
    Ok(())
}

/// 设置下载行为
pub async fn page_set_download_behavior(conn: &CdpConnection, behavior: &str, download_path: Option<&str>) -> Result<()> {
    let mut params = serde_json::json!({ "behavior": behavior });
    if let Some(path) = download_path {
        params["downloadPath"] = serde_json::Value::String(path.to_string());
    }
    conn.send_command("Page.setDownloadBehavior", params).await?;
    Ok(())
}

/// 设置浏览器级下载行为（通过浏览器级连接发送）
///
/// `behavior` 支持 "deny"/"allow"/"allowAndName"/"default"。
/// 使用 "allowAndName" 时，Chrome 会先将文件以 GUID 为名保存到下载目录，
/// 之后可监听 `Browser.downloadWillBegin` 拿到 GUID 并重命名为目标文件名。
/// 需通过浏览器级 CDP 连接（/json/version 的 webSocketDebuggerUrl）发送。
pub async fn browser_set_download_behavior(conn: &CdpConnection, behavior: &str, download_path: Option<&str>) -> Result<()> {
    let mut params = serde_json::json!({ "behavior": behavior });
    if let Some(path) = download_path {
        params["downloadPath"] = serde_json::Value::String(path.to_string());
    }
    conn.send_command("Browser.setDownloadBehavior", params).await?;
    Ok(())
}

/// 页面导出 PDF
pub async fn page_print_to_pdf(conn: &CdpConnection, landscape: Option<bool>, print_background: Option<bool>, paper_width: Option<f64>, paper_height: Option<f64>, margin_top: Option<f64>, margin_bottom: Option<f64>, margin_left: Option<f64>, margin_right: Option<f64>, prefer_css_page_size: Option<bool>) -> Result<Value> {
    let mut params = serde_json::json!({});
    if let Some(v) = landscape { params["landscape"] = serde_json::Value::Bool(v); }
    if let Some(v) = print_background { params["printBackground"] = serde_json::Value::Bool(v); }
    if let Some(v) = paper_width { params["paperWidth"] = serde_json::json!(v); }
    if let Some(v) = paper_height { params["paperHeight"] = serde_json::json!(v); }
    if let Some(v) = margin_top { params["marginTop"] = serde_json::json!(v); }
    if let Some(v) = margin_bottom { params["marginBottom"] = serde_json::json!(v); }
    if let Some(v) = margin_left { params["marginLeft"] = serde_json::json!(v); }
    if let Some(v) = margin_right { params["marginRight"] = serde_json::json!(v); }
    if let Some(v) = prefer_css_page_size { params["preferCSSPageSize"] = serde_json::Value::Bool(v); }
    conn.send_command("Page.printToPDF", params).await
}

// ==================== 设备模拟 ====================

/// 设置视口尺寸/设备模拟
pub async fn emulation_set_device_metrics_override(
    conn: &CdpConnection,
    width: i32,
    height: i32,
    device_scale_factor: f64,
    mobile: bool,
) -> Result<()> {
    conn.send_command(
        "Emulation.setDeviceMetricsOverride",
        serde_json::json!({
            "width": width,
            "height": height,
            "deviceScaleFactor": device_scale_factor,
            "mobile": mobile,
        }),
    ).await?;
    Ok(())
}

/// 重置设备模拟
pub async fn emulation_clear_device_metrics_override(conn: &CdpConnection) -> Result<()> {
    conn.send_command("Emulation.clearDeviceMetricsOverride", serde_json::json!({})).await?;
    Ok(())
}

// ==================== 网络控制 ====================

// ==================== Frame ====================

/// 获取页面 Frame 树（Page.getFrameTree）
pub async fn page_get_frame_tree(conn: &CdpConnection) -> Result<Value> {
    conn.send_command("Page.getFrameTree", serde_json::json!({})).await
}

/// 在指定 frame 中创建隔离世界，返回 executionContextId
///
/// 后续 `Runtime.evaluate` 传 `context_id` 即可在 frame 内执行 JS。
pub async fn page_create_isolated_world(conn: &CdpConnection, frame_id: &str, world_name: &str) -> Result<i64> {
    let result = conn.send_command(
        "Page.createIsolatedWorld",
        serde_json::json!({
            "frameId": frame_id,
            "worldName": world_name,
            "grantUniversalAccess": true,
        }),
    ).await?;
    result["executionContextId"].as_i64()
        .ok_or_else(|| anyhow::anyhow!("createIsolatedWorld 未返回 executionContextId"))
}

/// 在指定执行上下文中执行 JS（Runtime.evaluate）
pub async fn runtime_evaluate_in_context(conn: &CdpConnection, expression: &str, context_id: i64, await_promise: bool) -> Result<Value> {
    let result = conn.send_command(
        "Runtime.evaluate",
        serde_json::json!({
            "expression": expression,
            "contextId": context_id,
            "returnByValue": true,
            "awaitPromise": await_promise,
            "userGesture": true,
        }),
    ).await?;
    Ok(result)
}

// ==================== 控制台 ====================

/// 启用控制台日志收集
pub async fn console_enable(conn: &CdpConnection) -> Result<()> {
    conn.send_command("Console.enable", serde_json::json!({})).await?;
    Ok(())
}

// ==================== 可访问性树 (Accessibility) ====================

/// 启用 Accessibility 域（获取 AX 树前必须先调用）
pub async fn accessibility_enable(conn: &CdpConnection) -> Result<()> {
    conn.send_command("Accessibility.enable", serde_json::json!({})).await?;
    Ok(())
}

/// 获取完整的可访问性树（返回原始 JSON，由调用方解析）
pub async fn accessibility_get_full_ax_tree(conn: &CdpConnection) -> Result<Value> {
    conn.send_command("Accessibility.getFullAXTree", serde_json::json!({})).await
}

// ==================== 工具函数 ====================
