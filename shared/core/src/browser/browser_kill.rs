//! 浏览器进程终止（按 exe 名 / 默认目录）

use crate::encoding::decode_windows_stdout;
use super::browser_process::{cmd_args, default_instance_exe, extract_cmd_arg};

/// 通过实际的 exe 名称杀死指定配置的浏览器进程。
/// exe_name 如 "chrome.exe"、"msedge.exe"。
pub fn kill_browser_by_exe_name(
    exe_name: &str,
    profile_id: &str,
    user_data_dir: &str,
) -> Result<String, String> {
    kill_browser_process_inner(exe_name, profile_id, user_data_dir)
}

/// 内部实现：通过 exe_name 查询并杀死进程
pub(crate) fn kill_browser_process_inner(
    exe_name: &str,
    profile_id: &str,
    user_data_dir: &str,
) -> Result<String, String> {
    // 默认目录兜底：默认目录为单实例，终止即关闭整个进程树。
    // 主进程可能是用户手动启动（无 --user-data-dir），也可能是本工具「打开」启动
    // （带 --user-data-dir=默认目录），两种都要能匹配到
    if default_instance_exe(user_data_dir) == Some(exe_name) {
        return kill_default_instance_processes(exe_name, user_data_dir);
    }

    let ps_script = format!(
        "Get-CimInstance Win32_Process -Filter \"name='{}'\" \
         | Select-Object ProcessId,CommandLine \
         | ConvertTo-Json -Compress",
        exe_name
    );

    let output = {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &ps_script])
                .creation_flags(0x08000000)
                .output()
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &ps_script])
                .output()
        }
    }
    .map_err(|e| format!("查询进程失败: {}", e))?;

    let stdout = decode_windows_stdout(&output.stdout);
    let processes: Vec<serde_json::Value> = if let Ok(arr) =
        serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim())
    {
        arr
    } else if let Ok(single) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        vec![single]
    } else {
        return Err("未找到匹配的浏览器进程".to_string());
    };

    for proc in &processes {
        let cmd_line = proc
            .get("CommandLine")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let ud = extract_cmd_arg(cmd_line, "--user-data-dir");
        let pf = extract_cmd_arg(cmd_line, "--profile-directory");

        if ud.as_deref() == Some(user_data_dir) && pf.as_deref() == Some(profile_id) {
            let pid = proc
                .get("ProcessId")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| "无法获取进程 PID".to_string())?;

            // 精确杀死该进程
            let kill_output = {
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    std::process::Command::new("taskkill")
                        .args(["/F", "/PID", &pid.to_string(), "/T"])
                        .creation_flags(0x08000000)
                        .output()
                }
                #[cfg(not(windows))]
                {
                    std::process::Command::new("kill")
                        .arg("-9")
                        .arg(pid.to_string())
                        .output()
                }
            }
            .map_err(|e| format!("终止进程失败: {}", e))?;

            if kill_output.status.success() {
                // 等待进程完全退出
                std::thread::sleep(std::time::Duration::from_secs(1));
                return Ok(format!("已终止进程 PID:{}", pid));
            } else {
                let stderr = String::from_utf8_lossy(&kill_output.stderr);
                return Err(format!("终止进程失败: {}", stderr));
            }
        }
    }

    Err("未找到匹配的浏览器进程".to_string())
}

/// 终止默认目录的浏览器实例：查找默认目录的主进程（无 --user-data-dir 的默认实例，
/// 或 --user-data-dir 等于默认目录的实例），taskkill /T 关闭整个进程树。
/// 只按 PID 杀主进程树，不影响使用独立 user-data-dir 运行的其它实例。
fn kill_default_instance_processes(exe_name: &str, default_dir: &str) -> Result<String, String> {
    let ps_script = format!(
        "Get-CimInstance Win32_Process -Filter \"name='{}'\" \
         | Select-Object ProcessId,CommandLine \
         | ConvertTo-Json -Compress",
        exe_name
    );

    let output = {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &ps_script])
                .creation_flags(0x08000000)
                .output()
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &ps_script])
                .output()
        }
    }
    .map_err(|e| format!("查询进程失败: {}", e))?;

    let stdout = decode_windows_stdout(&output.stdout);
    let processes: Vec<serde_json::Value> = if let Ok(arr) =
        serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim())
    {
        arr
    } else if let Ok(single) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        vec![single]
    } else {
        return Err("未找到匹配的浏览器进程".to_string());
    };

    for proc in &processes {
        let cmd_line = proc
            .get("CommandLine")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let args = cmd_args(cmd_line);
        // 子进程（renderer/gpu 等）都有 --type=，主进程没有
        if args.iter().any(|a| a.starts_with("--type=")) {
            continue;
        }
        // 主进程的 user-data-dir：无该参数（默认实例）或等于默认目录才匹配；
        // 使用独立 user-data-dir 运行的实例必须跳过，避免误杀
        let ud = args
            .iter()
            .find_map(|a| a.strip_prefix("--user-data-dir="));
        match ud {
            None => {}
            Some(dir) if dir.eq_ignore_ascii_case(default_dir) => {}
            Some(_) => continue,
        }

        let pid = proc
            .get("ProcessId")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| "无法获取进程 PID".to_string())?;

        let kill_output = {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                std::process::Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string(), "/T"])
                    .creation_flags(0x08000000)
                    .output()
            }
            #[cfg(not(windows))]
            {
                std::process::Command::new("kill")
                    .arg("-9")
                    .arg(pid.to_string())
                    .output()
            }
        }
        .map_err(|e| format!("终止进程失败: {}", e))?;

        if kill_output.status.success() {
            // 等待进程树完全退出
            std::thread::sleep(std::time::Duration::from_secs(1));
            return Ok(format!("已终止默认目录浏览器全部进程 (PID:{})", pid));
        } else {
            let stderr = String::from_utf8_lossy(&kill_output.stderr);
            return Err(format!("终止进程失败: {}", stderr));
        }
    }

    Err("未找到默认浏览器实例进程".to_string())
}

