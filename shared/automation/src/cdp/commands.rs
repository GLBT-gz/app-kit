//! CDP 命令封装（按域拆分：本文件保留导航/DOM/JS 执行）
//!
//! - `commands_input.rs` 输入操作（鼠标/键盘/滚轮/拖拽）
//! - `commands_net.rs`   网络域（Cookie/网络控制/存储/Fetch）
//! - `commands_page.rs`  页面域（截图/对话框/页面控制/设备模拟/Frame/Accessibility）
//! 各子模块 pub 函数经下方 pub use 重导出，外部路径 `cdp::commands::xxx` 不变。

use super::connection::CdpConnection;
use anyhow::{Context, Result};
use serde_json::Value;
use tracing::info;

// 重导出子模块公开 API（保持外部路径 cdp::commands::xxx 不变）
pub use super::commands_input::{
    input_click, input_dispatch_drag_event, input_dispatch_key_event, input_dispatch_key_event_raw,
    input_dispatch_mouse_event, input_dispatch_mouse_wheel, input_insert_text,
};
pub use super::commands_net::{
    fetch_continue_request, fetch_disable, fetch_enable, fetch_fail_request, fetch_fulfill_request,
    network_delete_cookies, network_enable, network_get_cookies, network_get_response_body,
    network_set_blocked_urls, network_set_cookie, network_set_cookies_batch, network_wait_idle,
    storage_clear_data_for_origin,
};
pub use super::commands_page::{
    accessibility_enable, accessibility_get_full_ax_tree, browser_set_download_behavior,
    console_enable, dom_set_file_input_files, emulation_clear_device_metrics_override,
    emulation_set_device_metrics_override, page_bring_to_front, page_capture_screenshot,
    page_create_isolated_world, page_get_frame_tree, page_get_navigation_history,
    page_handle_java_script_dialog, page_print_to_pdf, page_set_download_behavior,
    runtime_evaluate_in_context,
};

// ==================== 页面导航 ====================

/// 导航到指定 URL
pub async fn page_navigate(conn: &CdpConnection, url: &str) -> Result<String> {
    let result = conn
        .send_command("Page.navigate", serde_json::json!({"url": url}))
        .await?;

    let frame_id = result["frameId"].as_str().unwrap_or("").to_string();
    info!("Page.navigate -> {} (frame: {})", url, frame_id);
    Ok(frame_id)
}

/// 等待页面加载完成（默认 20 秒超时）
///
/// 轮询 `document.readyState` 直到 `complete`。相比订阅 `Page.loadEventFired`
/// 事件（事件可能在订阅前已触发而错过），轮询无时序竞争，快页面立即返回，
/// 慢页面最多等满超时后报错，避免调用方被无限挂起。
pub async fn page_load_event(conn: &CdpConnection) -> Result<()> {
    page_load_event_with_timeout(conn, std::time::Duration::from_secs(20)).await
}

/// 等待页面加载完成（自定义超时）
///
/// 每次探测也设 5 秒超时：若 CDP 连接异常，单次 `Runtime.evaluate` 默认等
/// 全局 90 秒超时会让调用方长时间占锁，这里用更短超时及时失败。
pub async fn page_load_event_with_timeout(conn: &CdpConnection, timeout: std::time::Duration) -> Result<()> {
    conn.send_command("Page.enable", Value::Null).await?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if std::time::Instant::now() >= deadline {
            anyhow::bail!("等待页面加载超时 ({} 秒)", timeout.as_secs());
        }
        let state = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            runtime_evaluate(conn, "document.readyState"),
        )
        .await
        .ok()
        .and_then(|r| r.ok())
        .and_then(|v| v.get("value").and_then(|s| s.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();
        if state == "complete" {
            info!("页面加载完成 (readyState=complete)");
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
}

// ==================== DOM 操作 ====================

/// 获取 document node
pub async fn dom_get_document(conn: &CdpConnection) -> Result<i64> {
    let result = conn
        .send_command("DOM.getDocument", serde_json::json!({"depth": 0}))
        .await?;

    let node_id = result["root"]["nodeId"].as_i64().context("缺少 nodeId")?;
    Ok(node_id)
}

/// 通过 CSS 选择器查找元素
pub async fn dom_query_selector(
    conn: &CdpConnection,
    node_id: i64,
    selector: &str,
) -> Result<Option<i64>> {
    let result = conn
        .send_command(
            "DOM.querySelector",
            serde_json::json!({
                "nodeId": node_id,
                "selector": selector,
            }),
        )
        .await?;

    let id = result["nodeId"].as_i64();
    Ok(id)
}

/// 通过 XPath 查找元素
pub async fn dom_query_selector_all(
    conn: &CdpConnection,
    node_id: i64,
    selector: &str,
) -> Result<Vec<i64>> {
    let result = conn
        .send_command(
            "DOM.querySelectorAll",
            serde_json::json!({
                "nodeId": node_id,
                "selector": selector,
            }),
        )
        .await?;

    let node_ids: Vec<i64> = result["nodeIds"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
        .unwrap_or_default();

    Ok(node_ids)
}

/// 获取元素的属性值
pub async fn dom_get_attribute(
    conn: &CdpConnection,
    node_id: i64,
    name: &str,
) -> Result<Option<String>> {
    let result = conn
        .send_command(
            "DOM.getAttribute",
            serde_json::json!({
                "nodeId": node_id,
                "name": name,
            }),
        )
        .await?;

    Ok(result["value"].as_str().map(|s| s.to_string()))
}

/// 获取元素的外框信息（位置、大小）
pub async fn dom_get_box_model(conn: &CdpConnection, node_id: i64) -> Result<Option<BoxModel>> {
    let result = conn
        .send_command("DOM.getBoxModel", serde_json::json!({"nodeId": node_id}))
        .await;

    match result {
        Ok(r) => {
            let model = r["model"].clone();
            let content = parse_quad(&model["content"])?;
            let border = parse_quad(&model["border"])?;
            let padding = parse_quad(&model["padding"])?;
            let width = model["width"].as_f64().unwrap_or(0.0);
            let height = model["height"].as_f64().unwrap_or(0.0);

            Ok(Some(BoxModel {
                content,
                border,
                padding,
                width,
                height,
            }))
        }
        Err(_) => Ok(None), // 某些不可见元素会报错
    }
}

fn parse_quad(quad: &Value) -> Result<[Point; 4]> {
    let arr = quad.as_array().context("quad 不是数组")?;
    Ok([
        Point {
            x: arr[0].as_f64().unwrap_or(0.0),
            y: arr[1].as_f64().unwrap_or(0.0),
        },
        Point {
            x: arr[2].as_f64().unwrap_or(0.0),
            y: arr[3].as_f64().unwrap_or(0.0),
        },
        Point {
            x: arr[4].as_f64().unwrap_or(0.0),
            y: arr[5].as_f64().unwrap_or(0.0),
        },
        Point {
            x: arr[6].as_f64().unwrap_or(0.0),
            y: arr[7].as_f64().unwrap_or(0.0),
        },
    ])
}

#[derive(Debug, Clone)]
pub struct BoxModel {
    pub content: [Point; 4],
    pub border: [Point; 4],
    pub padding: [Point; 4],
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// 获取元素的文本内容
pub async fn runtime_get_text(conn: &CdpConnection, node_id: i64) -> Result<String> {
    let result = conn
        .send_command(
            "DOM.getOuterHTML",
            serde_json::json!({"nodeId": node_id}),
        )
        .await?;

    Ok(result["outerHTML"].as_str().unwrap_or("").to_string())
}


// ==================== JavaScript 执行 ====================

/// 执行 JavaScript
/// 返回提取后的执行结果（caller 可直接通过 ["value"] 访问）
pub async fn runtime_evaluate(conn: &CdpConnection, expression: &str) -> Result<Value> {
    let result = conn
        .send_command(
            "Runtime.evaluate",
            serde_json::json!({
                "expression": expression,
                "returnByValue": true,
                "awaitContext": true,
                "userGesture": true,
            }),
        )
        .await?;

    // send_command 返回 CDP 响应的 result 字段
    // Runtime.evaluate 的响应结构为：
    // {"result": <实际计算结果>, "exceptionDetails": ...}
    // 提取内层 result 使 caller 可以直接访问 result["value"]
    Ok(result.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

/// 执行 JavaScript（带超时兜底）
///
/// CDP 的 `Runtime.evaluate` **没有短超时**（默认等全局 90s）——页面仍在导航/
/// SPA 加载时 evaluate 会长时间挂起。本函数用 `tokio::time::timeout` 包裹，
/// 超时返回 anyhow 错误，调用方可以 `.ok()` 兜底（参考 `page_load_event_with_timeout`
/// 同样的模式：探测 + 单次短超时 + 失败重试）。
///
/// 调用方应在页面加载完成（`Tab::wait_ready`）后再 evaluate；若必须在加载期
/// 探测，推荐配合 5s 单次超时 + 失败时重试。
pub async fn runtime_evaluate_with_timeout(
    conn: &CdpConnection,
    expression: &str,
    timeout: std::time::Duration,
) -> Result<Value> {
    match tokio::time::timeout(timeout, runtime_evaluate(conn, expression)).await {
        Ok(r) => r,
        Err(_) => anyhow::bail!("Runtime.evaluate 超时（{}ms）", timeout.as_millis()),
    }
}

/// 执行 JavaScript（支持 async/await）
/// 与 runtime_evaluate 的区别在于使用 awaitPromise: true 等待 Promise 完成
pub async fn runtime_evaluate_async(conn: &CdpConnection, expression: &str) -> Result<Value> {
    let result = conn
        .send_command(
            "Runtime.evaluate",
            serde_json::json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": true,
            }),
        )
        .await?;

    Ok(result.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

/// 获取元素的属性（通过 JS）
pub async fn runtime_get_element_attr(
    conn: &CdpConnection,
    css_selector: &str,
    attr: &str,
) -> Result<Option<String>> {
    let expr = format!(
        r#"document.querySelector('{}')?.getAttribute('{}')"#,
        css_selector.replace('\'', "\\'"),
        attr,
    );

    let result = runtime_evaluate(conn, &expr).await?;

    Ok(result["value"].as_str().map(|s| s.to_string()))
}

/// 判断元素是否存在
pub async fn runtime_element_exists(conn: &CdpConnection, css_selector: &str) -> Result<bool> {
    let expr = format!(
        "document.querySelector('{}') !== null",
        css_selector.replace('\'', "\\'"),
    );

    let result = runtime_evaluate(conn, &expr).await?;
    Ok(result["value"].as_bool().unwrap_or(false))
}

