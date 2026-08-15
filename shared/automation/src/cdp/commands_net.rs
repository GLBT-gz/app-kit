//! CDP 网络域命令（Cookie/网络控制/存储/Fetch 拦截）——从 commands.rs 拆出

use super::connection::CdpConnection;
use anyhow::Result;
use serde_json::Value;

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
