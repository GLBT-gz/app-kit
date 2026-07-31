use super::connection::CdpConnection;
use anyhow::Result;
use serde_json::Value;
use tracing::info;

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

/// 等待页面加载完成
pub async fn page_load_event(conn: &CdpConnection) -> Result<()> {
    conn.send_command("Page.enable", Value::Null).await?;
    // Page.loadEventFired 会在页面加载完成后触发
    conn.send_command("Page.loadEventFired", Value::Null).await?;
    info!("页面加载完成");
    Ok(())
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

// ==================== 输入操作 ====================

/// 点击元素（通过 CDP Input.dispatchMouseEvent）
pub async fn input_click(conn: &CdpConnection, x: f64, y: f64) -> Result<()> {
    conn.send_command(
        "Input.dispatchMouseEvent",
        serde_json::json!({
            "type": "mousePressed",
            "x": x,
            "y": y,
            "button": "left",
            "clickCount": 1,
        }),
    )
    .await?;

    conn.send_command(
        "Input.dispatchMouseEvent",
        serde_json::json!({
            "type": "mouseReleased",
            "x": x,
            "y": y,
            "button": "left",
            "clickCount": 1,
        }),
    )
    .await?;

    Ok(())
}

/// 输入文本
pub async fn input_insert_text(conn: &CdpConnection, text: &str) -> Result<()> {
    conn.send_command(
        "Input.insertText",
        serde_json::json!({"text": text}),
    )
    .await?;

    Ok(())
}

/// 键盘输入
pub async fn input_dispatch_key_event(conn: &CdpConnection, text: &str) -> Result<()> {
    for ch in text.chars() {
        let key = ch.to_string();
        conn.send_command(
            "Input.dispatchKeyEvent",
            serde_json::json!({
                "type": "keyDown",
                "text": key,
            }),
        )
        .await?;

        conn.send_command(
            "Input.dispatchKeyEvent",
            serde_json::json!({
                "type": "keyUp",
                "text": key,
            }),
        )
        .await?;
    }
    Ok(())
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

// ==================== Cookie ====================

/// 启用网络监控（获取 Cookie 前需调用）
pub async fn network_enable(conn: &CdpConnection) -> Result<()> {
    conn.send_command("Network.enable", Value::Null).await?;
    Ok(())
}

/// 等待网络空闲
pub async fn network_wait_idle(_conn: &CdpConnection, timeout_secs: u64) -> Result<()> {
    // 简单方案：等待一段时间无网络活动
    // 更完善的方案需要监听 Network.event 事件
    tokio::time::sleep(tokio::time::Duration::from_secs(timeout_secs)).await;
    Ok(())
}

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

// ==================== Cookie ====================

/// 获取所有 Cookie
pub async fn network_get_cookies(conn: &CdpConnection) -> Result<Vec<serde_json::Value>> {
    let result = conn.send_command("Network.getAllCookies", Value::Null).await?;

    let cookies = result["cookies"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    Ok(cookies)
}

/// 设置 Cookie
pub async fn network_set_cookie(
    conn: &CdpConnection,
    name: &str,
    value: &str,
    domain: &str,
) -> Result<()> {
    conn.send_command(
        "Network.setCookie",
        serde_json::json!({
            "name": name,
            "value": value,
            "domain": domain,
        }),
    )
    .await?;

    Ok(())
}

// ==================== 键盘操作增强 ====================

/// 发送原始键盘事件（支持特殊键码，如 Enter、Tab、Escape、ArrowUp 等）
pub async fn input_dispatch_key_event_raw(
    conn: &CdpConnection,
    key: &str,
    code: &str,
    windows_key_code: i32,
    modifiers: i32,
    event_type: &str, // "keyDown" | "keyUp" | "rawKeyDown" | "rawKeyUp"
    text: Option<&str>,
) -> Result<()> {
    let mut params = serde_json::json!({
        "type": event_type,
        "key": key,
        "code": code,
        "windowsVirtualKeyCode": windows_key_code,
        "modifiers": modifiers,
    });
    if let Some(t) = text {
        params["text"] = serde_json::json!(t);
    }
    conn.send_command("Input.dispatchKeyEvent", params).await?;
    Ok(())
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

// ==================== 鼠标滚轮 ====================

/// 鼠标滚轮滚动
pub async fn input_dispatch_mouse_wheel(
    conn: &CdpConnection,
    x: f64,
    y: f64,
    delta_x: f64,
    delta_y: f64,
) -> Result<()> {
    conn.send_command(
        "Input.dispatchMouseEvent",
        serde_json::json!({
            "type": "mouseWheel",
            "x": x,
            "y": y,
            "deltaX": delta_x,
            "deltaY": delta_y,
        }),
    ).await?;
    Ok(())
}

// ==================== Cookie 管理增强 ====================

/// 删除指定域名的 Cookie
pub async fn network_delete_cookies(conn: &CdpConnection, name: &str, url: &str) -> Result<()> {
    conn.send_command(
        "Network.deleteCookies",
        serde_json::json!({
            "name": name,
            "url": url,
        }),
    ).await?;
    Ok(())
}

// ==================== 存储管理 ====================

/// 清除指定来源的浏览器存储（localStorage/cookies/cache 等）
pub async fn storage_clear_data_for_origin(
    conn: &CdpConnection,
    origin: &str,
    storage_types: &str,
) -> Result<()> {
    conn.send_command(
        "Storage.clearDataForOrigin",
        serde_json::json!({
            "origin": origin,
            "storageTypes": storage_types,
        }),
    ).await?;
    Ok(())
}

// ==================== 输入事件增强 ====================

/// 模拟鼠标事件（支持左键/右键/中键/双击）
pub async fn input_dispatch_mouse_event(
    conn: &CdpConnection,
    type_: &str, // mousePressed / mouseReleased / mouseMoved
    x: f64,
    y: f64,
    button: &str, // left / right / middle / none
    click_count: i32,
) -> Result<()> {
    conn.send_command(
        "Input.dispatchMouseEvent",
        serde_json::json!({
            "type": type_,
            "x": x,
            "y": y,
            "button": button,
            "clickCount": click_count,
        }),
    ).await?;
    Ok(())
}

/// 拖放操作
pub async fn input_dispatch_drag_event(
    conn: &CdpConnection,
    type_: &str, // dragStart / drag / dragEnd / dragEnter / dragOver / drop
    x: f64,
    y: f64,
    data: &Value,
) -> Result<()> {
    conn.send_command(
        "Input.dispatchDragEvent",
        serde_json::json!({
            "type": type_,
            "x": x,
            "y": y,
            "data": data,
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

/// 屏蔽指定 URL 模式
pub async fn network_set_blocked_urls(conn: &CdpConnection, urls: &[String]) -> Result<()> {
    conn.send_command(
        "Network.setBlockedURLs",
        serde_json::json!({
            "urls": urls,
        }),
    ).await?;
    Ok(())
}

/// 批量设置 Cookie（Network.setCookies）
pub async fn network_set_cookies_batch(conn: &CdpConnection, cookies: &[serde_json::Value]) -> Result<()> {
    conn.send_command(
        "Network.setCookies",
        serde_json::json!({ "cookies": cookies }),
    ).await?;
    Ok(())
}

/// 获取请求响应体（Network.getResponseBody）
///
/// 返回 `{ body, base64_encoded }`，body 可能为 base64 编码（如图片等二进制资源）。
pub async fn network_get_response_body(conn: &CdpConnection, request_id: &str) -> Result<Value> {
    let result = conn.send_command(
        "Network.getResponseBody",
        serde_json::json!({ "requestId": request_id }),
    ).await?;
    let body = result["body"].as_str().unwrap_or("").to_string();
    let base64_encoded = result["base64Encoded"].as_bool().unwrap_or(false);
    Ok(serde_json::json!({ "body": body, "base64_encoded": base64_encoded }))
}

// ==================== 网络拦截（Fetch 域） ====================

/// 启用请求拦截（Fetch.enable）
///
/// 不传 patterns 时拦截所有请求；调用后所有请求都会暂停（requestPaused 事件），
/// 必须由事件循环调用 `fetch_continue_request` 放行，否则页面会卡死。
pub async fn fetch_enable(conn: &CdpConnection, patterns: Option<&[serde_json::Value]>) -> Result<()> {
    let mut params = serde_json::json!({});
    if let Some(p) = patterns {
        params["patterns"] = serde_json::Value::Array(p.to_vec());
    }
    conn.send_command("Fetch.enable", params).await?;
    Ok(())
}

/// 放行拦截的请求（Fetch.continueRequest）
pub async fn fetch_continue_request(conn: &CdpConnection, request_id: &str) -> Result<()> {
    conn.send_command(
        "Fetch.continueRequest",
        serde_json::json!({ "requestId": request_id }),
    ).await?;
    Ok(())
}

/// 伪造响应（Fetch.fulfillRequest），用于返回自定义内容/状态码/响应头
pub async fn fetch_fulfill_request(
    conn: &CdpConnection,
    request_id: &str,
    status: i64,
    headers: Option<&[serde_json::Value]>,
    body_b64: Option<&str>,
) -> Result<()> {
    let mut params = serde_json::json!({
        "requestId": request_id,
        "responseCode": status,
    });
    if let Some(h) = headers {
        params["responseHeaders"] = serde_json::Value::Array(h.to_vec());
    }
    if let Some(b) = body_b64 {
        params["body"] = serde_json::Value::String(b.to_string());
    }
    conn.send_command("Fetch.fulfillRequest", params).await?;
    Ok(())
}

/// 中止请求（Fetch.failRequest）
pub async fn fetch_fail_request(conn: &CdpConnection, request_id: &str, reason: &str) -> Result<()> {
    conn.send_command(
        "Fetch.failRequest",
        serde_json::json!({
            "requestId": request_id,
            "errorReason": reason,
        }),
    ).await?;
    Ok(())
}

/// 关闭请求拦截（Fetch.disable）
pub async fn fetch_disable(conn: &CdpConnection) -> Result<()> {
    conn.send_command("Fetch.disable", serde_json::json!({})).await?;
    Ok(())
}

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

use anyhow::Context;
