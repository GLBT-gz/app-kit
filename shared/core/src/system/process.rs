use anyhow::Result;
use std::time::Duration;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tracing::{info, warn};

/// 根据进程名查找所有匹配的进程 PID
pub fn find_processes_by_name(name: &str) -> Vec<u32> {
    let mut pids = Vec::new();

    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/FO", "CSV", "/NH"]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().ok();

    if let Some(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.to_lowercase().contains(&name.to_lowercase()) {
                // CSV 格式: "msedge.exe","1234","Console","1","xxx KB"
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let pid_str = parts[1].trim_matches('"');
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        pids.push(pid);
                    }
                }
            }
        }
    }

    pids
}

/// 杀死指定名称的所有进程
pub fn kill_processes_by_name(name: &str) -> Result<u32> {
    let pids = find_processes_by_name(name);
    let count = pids.len() as u32;

    if count == 0 {
        return Ok(0);
    }

    info!("正在关闭 {} 个 {} 进程", count, name);

    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/F", "/IM", name, "/T"]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().ok();

    if let Some(output) = output {
        if output.status.success() {
            info!("已关闭所有 {} 进程", name);
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("taskkill 输出: {}", stderr);
        }
    }

    // 等待进程实际退出
    std::thread::sleep(Duration::from_secs(2));
    Ok(count)
}

/// 等待指定名称的所有进程退出
pub fn wait_processes_exit(name: &str, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        let pids = find_processes_by_name(name);
        if pids.is_empty() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

/// 检查进程是否正在运行
pub fn is_process_running(pid: u32) -> bool {
    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/FI", &format!("PID eq {}", pid), "/NH"]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().ok();

    if let Some(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        return stdout.contains(&pid.to_string());
    }
    false
}

/// 获取进程的可执行文件路径
pub fn get_process_path(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        let output = std::process::Command::new("wmic")
            .args([
                "process",
                "where",
                &format!("ProcessId={}", pid),
                "get",
                "ExecutablePath",
                "/format:value",
            ])
            .creation_flags(0x08000000)
            .output()
            .ok()?;

        let stdout = crate::encoding::decode_windows_stdout(&output.stdout);
        for line in stdout.lines() {
            if let Some(value) = line.strip_prefix("ExecutablePath=") {
                let path = value.trim();
                if !path.is_empty() {
                    return Some(path.to_string());
                }
            }
        }
        None
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_edge() {
        let pids = find_processes_by_name("msedge.exe");
        println!("Edge PIDs: {:?}", pids);
    }
}
