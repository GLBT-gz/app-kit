use crate::browser::{BrowserType, RunningInstance};
use anyhow::{Context, Result};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tracing::{info, warn};

/// 启动浏览器的参数
#[derive(Debug, Clone)]
pub struct LaunchOptions {
    pub exe_path: PathBuf,
    pub debug_port: u16,
    pub user_data_dir: PathBuf,
    pub profile_id: String,
    pub extra_args: Vec<String>,
    pub headless: bool,
}

impl LaunchOptions {
    pub fn new(
        exe_path: PathBuf,
        debug_port: u16,
        user_data_dir: PathBuf,
        profile_id: String,
    ) -> Self {
        Self {
            exe_path,
            debug_port,
            user_data_dir,
            profile_id,
            extra_args: vec![],
            headless: false,
        }
    }
}

/// 启动浏览器并返回进程句柄
pub fn launch_browser(options: &LaunchOptions) -> Result<Child> {
    ensure_directory_not_locked(&options.user_data_dir)?;

    info!(
        "启动浏览器: {} --remote-debugging-port={} --user-data-dir={} --profile-directory={}",
        options.exe_path.display(),
        options.debug_port,
        options.user_data_dir.display(),
        options.profile_id
    );

    let child = spawn_browser_with_fallback(options)?;

    info!("浏览器已启动, PID: {}", child.id());
    Ok(child)
}

/// 启动浏览器子进程，优先使用 CREATE_BREAKAWAY_FROM_JOB（热更新时进程存活），
/// 失败时自动降级为仅 DETACHED_PROCESS（兼容限制性 Job Object）
fn spawn_browser_with_fallback(options: &LaunchOptions) -> Result<Child> {
    let build_cmd = |flags: u32| {
        let mut cmd = Command::new(&options.exe_path);
        cmd.arg(format!("--remote-debugging-port={}", options.debug_port))
            .arg("--remote-allow-origins=*")
            .arg(format!("--user-data-dir={}", options.user_data_dir.display()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check");
        if !options.profile_id.is_empty() {
            cmd.arg(format!("--profile-directory={}", options.profile_id));
        }
        if options.headless {
            cmd.arg("--headless");
        }
        for arg in &options.extra_args {
            cmd.arg(arg);
        }
        // stderr/stdout 必须设为 null，否则管道缓冲区满会导致浏览器进程阻塞卡死
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(flags);
        }
        cmd
    };

    #[cfg(windows)]
    {
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;

        match build_cmd(DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB).spawn() {
            Ok(child) => return Ok(child),
            Err(e) => {
                warn!("BREAKAWAY 启动失败({})，降级重试", e);
            }
        }
        build_cmd(DETACHED_PROCESS).spawn().context("启动浏览器失败")
    }

    #[cfg(not(windows))]
    {
        build_cmd(0).spawn().context("启动浏览器失败")
    }
}

/// 等待远程调试端口就绪
pub fn wait_for_debug_port(port: u16, timeout: Duration) -> Result<()> {
    use std::net::TcpStream;
    use std::time::Instant;

    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            Duration::from_millis(500),
        )
        .is_ok()
        {
            info!("调试端口 {} 已就绪 (耗时 {:?})", port, start.elapsed());
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(300));
    }

    anyhow::bail!("调试端口 {} 在 {:?} 内未就绪", port, timeout);
}

/// 生成启动命令字符串（用于显示或创建快捷方式）
pub fn generate_launch_command(options: &LaunchOptions) -> String {
    let mut parts = vec![
        format!("\"{}\"", options.exe_path.display()),
        format!("--remote-debugging-port={}", options.debug_port),
        "--remote-allow-origins=*".to_string(),
        format!("--user-data-dir=\"{}\"", options.user_data_dir.display()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
    ];
    if !options.profile_id.is_empty() {
        parts.push(format!("--profile-directory=\"{}\"", options.profile_id));
    }

    for arg in &options.extra_args {
        parts.push(arg.clone());
    }

    parts.join(" ")
}

/// 连接到已运行的浏览器实例（通过 CDP WebSocket）
pub async fn connect_to_running_instance(
    host: &str,
    port: u16,
) -> Result<RunningInstance> {
    let url = format!("http://{}:{}/json/version", host, port);
    let resp = reqwest::get(&url)
        .await
        .with_context(|| format!("连接浏览器调试端口失败: {}", url))?;

    let info: serde_json::Value = resp
        .json()
        .await
        .context("解析浏览器版本信息失败")?;

    let ws_url = info["webSocketDebuggerUrl"]
        .as_str()
        .map(|s| s.to_string());

    Ok(RunningInstance {
        pid: 0, // 需要通过其他方式获取
        port,
        browser_type: BrowserType::Edge, // 需要从 User-Agent 判断
        ws_url,
        profile_id: None,
    })
}

/// 获取浏览器 CDP WebSocket URL
pub fn get_ws_url(host: &str, port: u16) -> Result<String> {
    let url = format!("http://{}:{}/json/version", host, port);
    let resp = reqwest::blocking::get(&url)
        .with_context(|| format!("获取调试信息失败: {}", url))?;

    let info: serde_json::Value = resp.json().context("解析 JSON 失败")?;

    info["webSocketDebuggerUrl"]
        .as_str()
        .map(|s| s.to_string())
        .context("未找到 webSocketDebuggerUrl")
}

/// 检查用户数据目录是否被锁定
fn ensure_directory_not_locked(user_data_dir: &PathBuf) -> Result<()> {
    // 检查是否存在上锁标记文件
    let lock_file = user_data_dir.join("SingletonLock");
    if lock_file.exists() {
        warn!("检测到锁文件: {}, 可能浏览器正在运行", lock_file.display());
        // 不阻止启动，只做警告
    }
    Ok(())
}
