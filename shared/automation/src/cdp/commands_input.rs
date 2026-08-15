//! CDP 输入操作（鼠标点击/键盘/滚轮/拖拽）——从 commands.rs 拆出

use super::connection::CdpConnection;
use anyhow::Result;
use serde_json::Value;

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
