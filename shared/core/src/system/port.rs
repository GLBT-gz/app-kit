use anyhow::Result;
use std::net::TcpStream;
use std::time::Duration;
use tracing::info;

/// 分配一个随机可用端口（系统自动分配，避免端口冲突）
/// 使用 TcpListener::bind(0) 让 OS 分配一个空闲的临时端口
pub fn allocate_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("分配端口失败: 无法绑定临时端口");
    listener.local_addr().unwrap().port()
}

/// 检查端口是否可用
pub fn is_port_available(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(300),
    )
    .is_err()
}

/// 等待端口就绪
pub fn wait_for_port(port: u16, timeout: Duration) -> Result<()> {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            Duration::from_millis(300),
        )
        .is_ok()
        {
            info!("端口 {} 已就绪 (耗时 {:?})", port, start.elapsed());
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    anyhow::bail!("端口 {} 在 {:?} 内未就绪", port, timeout);
}

/// 查找可用端口（在指定范围内）
pub fn find_available_port(start: u16, end: u16) -> Option<u16> {
    for port in start..=end {
        if is_port_available(port) {
            return Some(port);
        }
    }
    None
}

/// 扫描正在运行的浏览器实例（通过远程调试端口）
pub fn scan_browser_instances(port_range: std::ops::Range<u16>) -> Vec<ScannedInstance> {
    let mut instances = Vec::new();

    for port in port_range {
        if !is_port_available(port) {
            // 尝试通过 HTTP 获取浏览器信息
            if let Some(info) = query_browser_info(port) {
                instances.push(info);
            }
        }
    }

    instances
}

/// 查询端口的浏览器信息
fn query_browser_info(port: u16) -> Option<ScannedInstance> {
    let url = format!("http://127.0.0.1:{}/json/version", port);

    let resp = reqwest::blocking::get(&url).ok()?;
    let info: serde_json::Value = resp.json().ok()?;

    let ws_url = info["webSocketDebuggerUrl"].as_str()?.to_string();
    let user_agent = info["User-Agent"].as_str().unwrap_or("");
    let browser_type = if user_agent.contains("Edg") {
        "edge"
    } else if user_agent.contains("Chrome") && !user_agent.contains("Edg") {
        "chrome"
    } else {
        "unknown"
    };

    Some(ScannedInstance {
        port,
        browser_type: browser_type.to_string(),
        ws_url,
        version: info["Browser"].as_str().map(|s| s.to_string()),
    })
}

/// 扫描到的浏览器实例
#[derive(Debug, Clone)]
pub struct ScannedInstance {
    pub port: u16,
    pub browser_type: String,
    pub ws_url: String,
    pub version: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_available() {
        let port = find_available_port(9222, 9230);
        println!("可用端口: {:?}", port);
    }
}
