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
    /// 当前 page-level session（2026-09-27 新增）
    ///
    /// CDP `Runtime.evaluate` / `Page.navigate` 等 page-specific 命令必须在 page-level
    /// session 才能调——`Target.attachToTarget({ targetId, flatten: true })` 后拿到
    /// sessionId，存到本字段。`send_command` 自动注入到 params.sessionId。
    ///
    /// 不调 `attach_page_target` 直接 `send_command("Runtime.evaluate", ...)` 会报
    /// `'Runtime.evaluate' wasn't found` (code -32601)——browser-level session 不识别
    /// page-only domain。
    page_session_id: Mutex<Option<String>>,
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
            page_session_id: Mutex::new(None),
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
    ///
    /// **2026-09-27 新增**：自动注入 `params.sessionId`（如果有 page session）——
    /// CDP 协议要求 page-specific 命令（Runtime.evaluate / Page.navigate 等）
    /// 在 attachToTarget 后的 sessionId 下调用。
    pub async fn send_command(&self, method: &str, mut params: Value) -> Result<Value> {
        // 自动注入 sessionId（如果之前 attach 过 page target）
        if let Some(ref sid) = *self.page_session_id.lock().await {
            // params 必须是 object（CDP 命令都是 object）
            if let Some(obj) = params.as_object_mut() {
                obj.entry("sessionId".to_string())
                    .or_insert_with(|| Value::String(sid.clone()));
            }
        }

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
    pub async fn send_command_no_wait(&self, method: &str, mut params: Value) -> Result<()> {
        // 自动注入 sessionId（同 send_command 逻辑）
        if let Some(ref sid) = *self.page_session_id.lock().await {
            if let Some(obj) = params.as_object_mut() {
                obj.entry("sessionId".to_string())
                    .or_insert_with(|| Value::String(sid.clone()));
            }
        }

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

    /// 附加到 page target（2026-09-27 新增）
    ///
    /// CDP page-specific 命令（Runtime.evaluate / Page.navigate 等）**必须**
    /// 在 attachToTarget 后的 page-level session 才能调——否则 browser-level
    /// session 返回 `'Runtime.evaluate' wasn't found` (code -32601)。
    ///
    /// 内部步骤：
    /// 1. 调 `Target.attachToTarget({ targetId, flatten: true })` 拿 sessionId
    /// 2. sessionId 存到 `page_session_id` Mutex
    /// 3. 后续 `send_command` 自动注入 `params.sessionId`
    ///
    /// 如果已经 attach 过，再调用会**覆盖** sessionId（不报错——切 page target 用）。
    pub async fn attach_page_target(&self, target_id: &str) -> Result<String> {
        let result = self
            .send_command_without_session(
                "Target.attachToTarget",
                serde_json::json!({
                    "targetId": target_id,
                    "flatten": true,
                }),
            )
            .await?;

        let session_id = result["sessionId"]
            .as_str()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Target.attachToTarget 未返回 sessionId（response: {}）",
                    result
                )
            })?
            .to_string();

        *self.page_session_id.lock().await = Some(session_id.clone());
        info!(
            "✅ 已 attach 到 page target: targetId={}, sessionId={}",
            target_id, session_id
        );
        Ok(session_id)
    }

    /// 列出可用 page targets（辅助 attach）
    ///
    /// 返回所有 type=page 的 target 列表（含 targetId / url / title）——业务侧
    /// 选合适的 target 后调 `attach_page_target(targetId)`。
    pub async fn list_page_targets(&self) -> Result<Vec<Value>> {
        let result = self
            .send_command_without_session(
                "Target.getTargets",
                serde_json::Value::Null,
            )
            .await?;
        let targets = result["targetInfos"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("Target.getTargets 未返回 targetInfos"))?
            .clone();

        // 过滤 type=page
        Ok(targets
            .into_iter()
            .filter(|t| t["type"].as_str() == Some("page"))
            .collect())
    }

    /// 内部：发送 CDP 命令**不**自动注入 sessionId（用于 Target.getTargets /
    /// Target.attachToTarget 等本身是 browser-level 的元命令）
    async fn send_command_without_session(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value> {
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
        {
            let mut writer = self.writer.lock().await;
            writer.send(Message::Text(cmd_str.into())).await?;
        }
        let result = tokio::time::timeout(std::time::Duration::from_secs(90), rx)
            .await
            .map_err(|_| anyhow::anyhow!("CDP 命令超时 ({}): 90秒内无响应", method))?
            .map_err(|_| anyhow::anyhow!("CDP 响应通道关闭"))?;
        if let Some(error) = result.get("error") {
            anyhow::bail!("CDP 命令 {} 失败: {:?}", method, error);
        }
        Ok(result["result"].clone())
    }

    /// 拿当前 page_session_id（用于调试 / 日志）
    pub async fn current_page_session_id(&self) -> Option<String> {
        self.page_session_id.lock().await.clone()
    }
}
