use crate::cdp::connection::CdpConnection;
use crate::cdp::commands;
use anyhow::{Context, Result};
use appkit_core::browser::{BrowserProfile, BrowserType};
use appkit_core::browser::launch::{self, LaunchOptions};
use appkit_core::port;
use std::process::Child;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::sleep;
use tracing::info;

/// 浏览器实例管理器
pub struct BrowserInstance {
    pub browser_type: BrowserType,
    pub child: Option<Child>,
    pub port: u16,
    pub profile: BrowserProfile,
    pub cdp: Option<Arc<CdpConnection>>,
    pub ws_url: String,
}

impl BrowserInstance {
    /// 启动一个新的浏览器进程并连接 CDP。
    /// 总是启动新进程，不检测已有实例。
    /// 需要智能检测时请使用 [`start_or_connect`]。
    pub async fn start(
        browser_type: BrowserType,
        exe_path: &std::path::Path,
        port: u16,
        profile: &BrowserProfile,
        headless: bool,
    ) -> Result<Self> {
        // 1. 启动浏览器进程
        let mut options = LaunchOptions::new(
            exe_path.to_path_buf(),
            port,
            profile.user_data_dir.clone(),
            profile.id.clone(),
        );
        options.headless = headless;
        options.extra_args = profile.extra_args.clone();

        let child = launch::launch_browser(&options)
            .context("启动浏览器失败")?;

        // 2. 等待端口就绪
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        let mut port_ready = false;
        while tokio::time::Instant::now() < deadline {
            if TcpStream::connect(format!("127.0.0.1:{}", port)).await.is_ok() {
                port_ready = true;
                break;
            }
            sleep(Duration::from_millis(300)).await;
        }
        if !port_ready {
            anyhow::bail!("调试端口 {} 在 15 秒内未就绪（浏览器可能启动失败或被防火墙拦截）", port);
        }
        info!("调试端口 {} 已就绪", port);

        // 3. 获取 WebSocket URL（使用 fetch_ws_url 内建的 no_proxy + TCP 直连双通道，避免代理拦截）
        // DevTools HTTP 服务可能在 TCP 就绪后尚未完全初始化，因此加入重试循环
        let ws_url = {
            let url = format!("http://127.0.0.1:{}/json/version", port);
            let max_retries = 10i64;
            let mut result = None;
            for attempt in 1..=max_retries {
                match Self::fetch_ws_url(&url).await {
                    Ok(ws) => {
                        result = Some(ws);
                        break;
                    }
                    Err(e) => {
                        if attempt < max_retries {
                            info!(
                                "获取 WebSocket URL 失败 (第{}/{}次): {}, 500ms 后重试...",
                                attempt, max_retries, e
                            );
                            sleep(Duration::from_millis(500)).await;
                        } else {
                            anyhow::bail!(
                                "获取 WebSocket URL 失败(已重试{}次): {}",
                                max_retries, e
                            );
                        }
                    }
                }
            }
            result.unwrap()
        };

        // 4. 连接 CDP
        let cdp = CdpConnection::connect(&ws_url).await
            .context("CDP 连接失败")?;

        info!(
            "浏览器已启动并连接: {} {} (port: {}, profile: {})",
            browser_type.as_str(),
            exe_path.display(),
            port,
            profile.id
        );

        Ok(Self {
            browser_type,
            child: Some(child),
            port,
            profile: profile.clone(),
            cdp: Some(cdp),
            ws_url,
        })
    }

    /// 智能启动：检测是否有正在运行的浏览器实例，有则直连，无则分配端口启动新进程。
    ///
    /// 检测逻辑（四种情况）：
    /// 1. **同 profile + 调试端口** → 直连（复用已有浏览器，不杀进程）
    /// 2. **同 profile + 无调试端口** → 杀死旧进程，重新启动（带调试端口）
    /// 3. **不同 profile + 同 user_data_dir** → Chrome/Edge 锁定 user_data_dir 无法并发，
    ///    杀死旧的，再为新 profile 启动新进程（等价于切换 profile）
    /// 4. **无实例** → 分配随机端口，启动新进程
    ///
    /// 这是生产场景的推荐入口：
    /// - 自动分配随机可用端口（不再需要调用方传 port）
    /// - 自动检测已有实例（避免重复启动）
    /// - 检测到已有实例时直连，不杀进程
    pub async fn start_or_connect(
        browser_type: BrowserType,
        exe_path: &std::path::Path,
        profile: &BrowserProfile,
        headless: bool,
    ) -> Result<Self> {
        let exe_name = exe_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        // ── 检测已有实例 ──
        let running = appkit_core::browser::management::scan_running_browser_processes(exe_name);
        let target_key = format!(
            "{}\\{}",
            profile.user_data_dir.display(),
            profile.id
        );

        // 诊断日志：输出检测结果
        info!(
            "[start_or_connect] exe_name={}, target_key={}, running_instances={}",
            exe_name,
            target_key,
            serde_json::to_string(&running.keys().collect::<Vec<_>>()).unwrap_or_default()
        );

        // 尝试精确匹配 target_key
        if let Some(port_opt) = running.get(&target_key) {
            match port_opt {
                // ── 情况 1: 已有实例 + 有调试端口 → 检查 headless 模式是否一致 ──
                Some(existing_port) => {
                    // 检查 headless 模式是否匹配（用端口精确识别主进程，避免子进程干扰）
                    let running_headless = appkit_core::browser::management::is_running_instance_headless(
                        exe_name, &target_key, *existing_port,
                    );
                    if running_headless != headless {
                        info!(
                            "检测到运行中的浏览器实例 headless 模式不一致 (已有: {} vs 请求: {}), 杀死旧进程后重新启动",
                            if running_headless { "headless" } else { "有头" },
                            if headless { "headless" } else { "有头" },
                        );
                        appkit_core::browser::management::kill_browser_by_exe_name(
                            exe_name,
                            &profile.id,
                            &profile.user_data_dir.to_string_lossy(),
                        )
                        .map_err(|e| anyhow::anyhow!("杀死旧浏览器进程失败: {}", e))?;
                        // 等待进程退出后，继续往下走到启动逻辑
                    } else {
                        info!(
                            "检测到已运行的浏览器实例: {} (端口: {}, headless: {}), 直接连接",
                            target_key, existing_port,
                            if running_headless { "是" } else { "否" }
                        );
                        return Self::connect("127.0.0.1", *existing_port).await;
                    }
                }
                // ── 情况 2: 已有实例 + 无调试端口 → 杀旧进程 → 重新启动 ──
                None => {
                    info!(
                        "检测到 {} 已运行但无调试端口, 正在杀死旧进程后重新启动...",
                        target_key
                    );
                    appkit_core::browser::management::kill_browser_by_exe_name(
                        exe_name,
                        &profile.id,
                        &profile.user_data_dir.to_string_lossy(),
                    )
                    .map_err(|e| anyhow::anyhow!("杀死旧浏览器进程失败: {}", e))?;
                }
            }
        } else {
            // ── 情况 3/4: 未精确匹配到 target_key ──
            // 先检查 user_data_dir 是否被其他 profile 占用
            let ud_prefix = format!("{}\\", profile.user_data_dir.display());
            let conflict_key = running.keys().find(|k| k.starts_with(&ud_prefix));
            if let Some(ck) = conflict_key {
                info!(
                    "检测到 user_data_dir 已被占用 ({}), 关闭后为新 profile 启动...",
                    ck
                );
                let conflict_profile = ck.split('\\').last().unwrap_or("");
                appkit_core::browser::management::kill_browser_by_exe_name(
                    exe_name,
                    conflict_profile,
                    &profile.user_data_dir.to_string_lossy(),
                )
                .map_err(|e| anyhow::anyhow!("杀死冲突浏览器进程失败: {}", e))?;
            } else {
                // ── 兜底: 检查 SingletonLock 文件 ──
                // 如果 WMI/wmic 都没检测到进程，但锁文件存在，说明确实有浏览器在运行
                let lock_file = profile.user_data_dir.join("SingletonLock");
                if lock_file.exists() {
                    info!(
                        "WARNING: SingletonLock 文件存在但未检测到进程: {:?}, 强制清理锁",
                        lock_file
                    );
                    // 走 kill 逻辑，确保旧进程被清理
                    let _ = appkit_core::browser::management::kill_browser_by_exe_name(
                        exe_name,
                        &profile.id,
                        &profile.user_data_dir.to_string_lossy(),
                    );
                    // 锁文件会在进程退出后自动消失，或我们手动清理
                    let _ = std::fs::remove_file(&lock_file);
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
                info!("未检测到运行中的实例: {}, 将启动新进程", target_key);
            }
        }

        let port = port::allocate_port();
        Self::start(browser_type, exe_path, port, profile, headless).await
    }

    /// 连接到已运行的浏览器
    ///
    /// 注意：浏览器 DevTools HTTP 服务可能在 TCP 端口就绪后尚未完全初始化，
    /// 因此 /json/version 请求会内置重试（最多 10 次，间隔 500ms）以应对竞态。
    pub async fn connect(host: &str, port: u16) -> Result<Self> {
        let version_url = format!("http://{}:{}/json/version", host, port);

        // ── 重试获取 WebSocket URL ──
        // 浏览器进程启动后，TCP 端口先就绪，但 DevTools HTTP 处理程序可能稍后才准备好，
        // 此时 /json/version 可能返回空或非 JSON 内容，导致"解析 JSON 失败"。
        let max_retries = 30;
        let mut ws_url = None;
        for attempt in 1..=max_retries {
            match Self::fetch_ws_url(&version_url).await {
                Ok(url) => {
                    ws_url = Some(url);
                    break;
                }
                Err(e) => {
                    if attempt < max_retries {
                        info!(
                            "连接 DevTools HTTP 服务失败 (第{}/{}次): {}, 1s 后重试...",
                            attempt, max_retries, e
                        );
                        sleep(Duration::from_secs(1)).await;
                    } else {
                        anyhow::bail!(
                            "连接 DevTools HTTP 服务失败(已重试{}次): {}",
                            max_retries,
                            e
                        );
                    }
                }
            }
        }
        let ws_url = ws_url.unwrap();

        let cdp = CdpConnection::connect(&ws_url).await?;

        // 获取浏览器信息
        let result = cdp.send_command("Browser.getVersion", serde_json::Value::Null).await?;
        let user_agent = result["userAgent"].as_str().unwrap_or("");
        let browser_type = if user_agent.contains("Edg") {
            BrowserType::Edge
        } else {
            BrowserType::Chrome
        };

        info!("已连接到运行中的浏览器 ({}:{})", host, port);

        Ok(Self {
            browser_type,
            child: None,
            port,
            profile: BrowserProfile {
                id: "unknown".to_string(),
                name: "外部连接".to_string(),
                user_data_dir: std::path::PathBuf::new(),
                profile_path: std::path::PathBuf::new(),
                download_dir: None,
                avatar_base64: None,
                email: None,
                extra_args: vec![],
            },
            cdp: Some(cdp),
            ws_url,
        })
    }

    /// 内部：请求 /json/version 并解析 WebSocket URL
    ///
    /// 尝试两种方式：
    /// 1. reqwest + no_proxy（绕过系统代理，避免浏览器安全扩展拦截 127.0.0.1 流量）
    /// 2. 原始 TCP 直连（完全绕过任何代理层，最终 fallback）
    async fn fetch_ws_url(version_url: &str) -> Result<String> {
        // ── 方式1：reqwest + no_proxy ──
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .no_proxy()
            .build()
            .context("构建 HTTP 客户端失败")?;
        let resp = client
            .get(version_url)
            .send()
            .await
            .with_context(|| format!("获取调试信息失败: {}", version_url))?;

        let status = resp.status();
        if status.is_success() {
            let info: serde_json::Value = resp.json().await.context("解析 JSON 失败")?;
            if let Some(ws) = info["webSocketDebuggerUrl"].as_str().map(|s| s.to_string()) {
                return Ok(ws);
            }
        }

        // ── 方式2：原始 TCP 直连（绕过所有代理）──
        info!("reqwest/no_proxy 未返回有效 WS URL (status={status}), 尝试 TCP 直连...");

        // 从 version_url 中解析 host:port
        let url_str = version_url.strip_prefix("http://").unwrap_or(version_url);
        let addr = url_str.split('/').next().unwrap_or("127.0.0.1:0");
        let mut stream = tokio::net::TcpStream::connect(addr)
            .await
            .with_context(|| format!("TCP 连接失败: {}", addr))?;

        let request = format!(
            "GET /json/version HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            addr
        );
        use tokio::io::AsyncWriteExt;
        stream.write_all(request.as_bytes()).await
            .with_context(|| "发送 HTTP 请求失败")?;

        // 读取 HTTP 响应，跳过 header（设 5 秒超时防止无限阻塞）
        use tokio::io::AsyncBufReadExt;
        let reader = tokio::io::BufReader::new(stream);
        let mut lines = reader.lines();
        let mut body = String::new();
        let mut in_body = false;
        let read_result = tokio::time::timeout(Duration::from_secs(5), async {
            while let Some(line) = lines.next_line().await? {
                if in_body {
                    body.push_str(&line);
                } else if line.is_empty() {
                    in_body = true;
                }
            }
            Ok::<_, anyhow::Error>(())
        }).await;
        // 处理超时或读取错误
        match read_result {
            Ok(Ok(())) => { /* 正常读取完成 */ }
            Ok(Err(e)) => anyhow::bail!("TCP 读取响应失败: {}", e),
            Err(_) => anyhow::bail!("TCP 读取响应超时（5 秒）"),
        }

        if body.is_empty() {
            anyhow::bail!("TCP 直连未收到响应体 (addr: {})", addr);
        }

        let info: serde_json::Value = serde_json::from_str(&body)
            .with_context(|| format!("TCP 直连解析 JSON 失败 (body: {})", &body[..body.len().min(200)]))?;
        info["webSocketDebuggerUrl"]
            .as_str()
            .map(|s| s.to_string())
            .context("TCP 直连未找到 webSocketDebuggerUrl")
    }

    /// 获取 CDP 连接引用
    pub fn cdp(&self) -> Result<&CdpConnection> {
        self.cdp.as_deref().context("CDP 未连接")
    }

    /// 打开新标签页
    pub async fn open_tab(&self, url: &str) -> Result<Tab> {
        let cdp = self.cdp()?;
        let result = cdp
            .send_command("Target.createTarget", serde_json::json!({"url": "about:blank"}))
            .await?;

        let target_id = result["targetId"]
            .as_str()
            .context("创建标签页失败: 无 targetId")?
            .to_string();

        // 获取新标签页的 CDP 连接
        let new_ws_url = format!(
            "ws://127.0.0.1:{}/devtools/page/{}",
            self.port, target_id
        );

        let new_cdp = CdpConnection::connect(&new_ws_url).await?;
        info!("已打开新标签页: {} (target: {})", url, target_id);

        // 导航到目标 URL
        commands::page_navigate(&new_cdp, url).await?;

        Ok(Tab {
            target_id,
            cdp: new_cdp,
        })
    }

    /// 获取当前标签页列表
    pub async fn list_tabs(&self) -> Result<Vec<TabInfo>> {
        let list_url = format!("http://127.0.0.1:{}/json", self.port);
        let resp = reqwest::get(&list_url).await?;
        let tabs: Vec<TabInfo> = resp.json().await?;
        Ok(tabs)
    }

    /// 关闭浏览器
    pub fn close(&mut self) -> Result<()> {
        if let Some(mut child) = self.child.take() {
            child.kill().ok();
            child.wait().ok();
            info!("浏览器进程已关闭 (PID: {})", child.id());
        }
        self.cdp = None;
        Ok(())
    }

    /// 分离浏览器进程，Drop 时不再自动关闭
    /// 调用后浏览器窗口保持打开，供用户手动操作
    pub fn detach(&mut self) {
        if let Some(child) = self.child.take() {
            // 放弃进程所有权，Drop 时不会 kill 进程
            std::mem::drop(child);
            info!("浏览器进程已分离 (PID)，浏览器窗口保持打开");
        }
    }
}

impl Drop for BrowserInstance {
    fn drop(&mut self) {
        if self.child.is_some() {
            self.close().ok();
        }
    }
}

/// 标签页信息
#[derive(Debug, serde::Deserialize)]
pub struct TabInfo {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub ws_url: Option<String>,
}

/// 标签页操作句柄
pub struct Tab {
    pub target_id: String,
    pub cdp: Arc<CdpConnection>,
}

impl Tab {
    /// 导航到 URL
    pub async fn navigate(&self, url: &str) -> Result<String> {
        commands::page_navigate(&self.cdp, url).await
    }

    /// 获取当前页面标题
    pub async fn title(&self) -> Result<String> {
        let result = commands::runtime_evaluate(&self.cdp, "document.title").await?;
        Ok(result["value"].as_str().unwrap_or("").to_string())
    }

    /// 获取当前页面 URL
    pub async fn current_url(&self) -> Result<String> {
        let result = commands::runtime_evaluate(&self.cdp, "window.location.href").await?;
        Ok(result["value"].as_str().unwrap_or("").to_string())
    }

    /// 关闭标签页
    pub async fn close(self) -> Result<()> {
        // Tab 的 drop 时会自动断开 WebSocket
        Ok(())
    }
}
