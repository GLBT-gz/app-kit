use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use tracing::{debug, info, warn};

/// CDP 连接管理器
pub struct CdpConnection {
    #[allow(dead_code)]
    ws_url: String,
    writer: Mutex<
        futures_util::stream::SplitSink<
            WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
            Message,
        >,
    >,
    reader: Mutex<
        futures_util::stream::SplitStream<
            WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
        >,
    >,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>,
    /// CDP 事件广播通道（非命令响应的消息）
    event_tx: broadcast::Sender<Value>,
}

impl CdpConnection {
    /// 连接到浏览器的 CDP WebSocket 端点
    /// 返回 Arc<Self>，因为内部会 spawn 一个后台任务持续读取 WebSocket 响应
    pub async fn connect(ws_url: &str) -> Result<Arc<Self>> {
        info!("正在连接 CDP: {}", ws_url);

        let (ws_stream, _) = connect_async(ws_url)
            .await
            .with_context(|| format!("CDP WebSocket 连接失败: {}", ws_url))?;

        let (writer, reader) = ws_stream.split();

        // 128 的缓冲区足够保存导航期间的事件
        let (event_tx, _) = broadcast::channel(128);

        let conn = Arc::new(Self {
            ws_url: ws_url.to_string(),
            writer: Mutex::new(writer),
            reader: Mutex::new(reader),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            event_tx,
        });

        // 启动后台消息读取循环
        // 这是关键：不启动消息循环，send_command 永远等不到响应
        let conn_clone = conn.clone();
        tokio::spawn(async move {
            conn_clone.start_message_loop().await;
        });

        info!("CDP 连接成功，消息循环已启动: {}", ws_url);

        Ok(conn)
    }

    /// 发送 CDP 命令并等待响应
    pub async fn send_command(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let command = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let (tx, rx) = tokio::sync::oneshot::channel();

        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, tx);
        }

        let cmd_str = serde_json::to_string(&command)?;
        debug!("CDP 发送: {}", cmd_str);

        {
            let mut writer = self.writer.lock().await;
            writer.send(Message::Text(cmd_str.into())).await?;
        }

        // 等待响应（由 start_message_loop 读取并分发），最长 90 秒超时
        // （010 产品上架同步在页面执行多次弹窗/重建等待，30s 不够）
        let result = tokio::time::timeout(std::time::Duration::from_secs(90), rx)
            .await
            .map_err(|_| {
                anyhow::anyhow!(
                    "CDP 命令超时 ({}): 90秒内无响应。可能浏览器 WebSocket 已断开",
                    method
                )
            })?
            .map_err(|_| anyhow::anyhow!("CDP 响应通道关闭"))?;

        // 检查错误
        if let Some(error) = result.get("error") {
            anyhow::bail!(
                "CDP 命令 {} 失败: {:?}",
                method,
                error
            );
        }

        Ok(result["result"].clone())
    }

    /// 持续读取 CDP 消息（在独立任务中运行）
    pub async fn start_message_loop(&self) {
        loop {
            let mut reader = self.reader.lock().await;
            match reader.next().await {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(msg) = serde_json::from_str::<Value>(&text) {
                        // 检查是否是命令响应（有 id 字段）
                        if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                            let mut pending = self.pending.lock().await;
                            if let Some(tx) = pending.remove(&id) {
                                let _ = tx.send(msg);
                            }
                        } else if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
                            // 事件通知 → 转发到广播通道
                            debug!("CDP 事件: {} ({})", method, crate::page::truncate_at_char_boundary(&text, 120));
                            let _ = self.event_tx.send(msg);
                        }
                    }
                }
                Some(Ok(Message::Close(_))) => {
                    warn!("CDP 连接关闭");
                    break;
                }
                Some(Err(e)) => {
                    warn!("CDP 读取错误: {}", e);
                    break;
                }
                _ => {}
            }
        }
    }

    /// 订阅 CDP 事件（非命令响应的消息，如 Network.requestWillBeSent 等）
    ///
    /// 返回一个 broadcast::Receiver，每次 start_message_loop 收到事件消息时，
    /// 所有活跃的 receiver 都会收到完整的消息 JSON。
    /// 如果 receiver 消费速度跟不上，慢的 receiver 会丢失事件（使用 lagged() 检测）。
    pub fn subscribe_events(&self) -> broadcast::Receiver<Value> {
        self.event_tx.subscribe()
    }

    /// 发送 CDP 命令但不需要等待响应
    pub async fn send_command_no_wait(&self, method: &str, params: Value) -> Result<()> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let command = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let cmd_str = serde_json::to_string(&command)?;
        let mut writer = self.writer.lock().await;
        writer.send(Message::Text(cmd_str.into())).await?;

        Ok(())
    }
}
