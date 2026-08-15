//! 浏览器进程扫描、运行状态检测与端口分配

use crate::browser::ProfileInfo;
use crate::config::PortEntry;
use crate::encoding::decode_windows_stdout;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;
use super::browser_paths::get_user_data_dir;
use serde::Serialize;

/// 扫描正在运行的浏览器实例（含调试端口）
pub fn scan_running_browser_instances(exe_name: &str) -> HashMap<String, u16> {
    let mut port_map: HashMap<String, u16> = HashMap::new();

    let ps_script = format!(
        "Get-CimInstance Win32_Process -Filter \"name='{}'\" \
         | Select-Object ProcessId,CommandLine \
         | ConvertTo-Json -Compress",
        exe_name
    );

    let output = match {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &ps_script])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &ps_script])
                .output()
        }
    } {
        Ok(o) => o,
        Err(_) => return port_map,
    };

    let stdout = decode_windows_stdout(&output.stdout);
    // PowerShell 可能返回单个对象或数组
    let processes: Vec<serde_json::Value> = if let Ok(arr) =
        serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim())
    {
        arr
    } else if let Ok(single) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        vec![single]
    } else {
        return port_map;
    };

    for proc in &processes {
        let cmd_line = proc
            .get("CommandLine")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let user_data_dir = extract_cmd_arg(cmd_line, "--user-data-dir");
        let profile = extract_cmd_arg(cmd_line, "--profile-directory");
        let port_str = extract_cmd_arg(cmd_line, "--remote-debugging-port");

        if let (Some(ud), Some(pf), Some(ps)) = (user_data_dir, profile, port_str) {
            if let Ok(port) = ps.parse::<u16>() {
                let key = format!("{}\\{}", ud, pf);
                port_map.entry(key).or_insert(port);
            }
        }
    }

    port_map
}

/// 使用 Windows CommandLineToArgvW API 正确分割命令行（处理所有引号/空格/转义规则）
#[cfg(windows)]
pub fn split_windows_command_line(cmd_line: &str) -> Vec<String> {
    extern "system" {
        fn CommandLineToArgvW(
            lpCmdLine: *const u16,
            pNumArgs: *mut i32,
        ) -> *mut *mut u16;
        fn LocalFree(hMem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }

    let wide: Vec<u16> = cmd_line.encode_utf16().chain(std::iter::once(0)).collect();
    let mut num_args = 0i32;
    let argv = unsafe { CommandLineToArgvW(wide.as_ptr(), &mut num_args) };
    if argv.is_null() {
        return Vec::new();
    }

    let mut result = Vec::with_capacity(num_args as usize);
    for i in 0..num_args {
        let ptr = unsafe { *argv.offset(i as isize) };
        if !ptr.is_null() {
            let len = (0..).take_while(|&j| unsafe { *ptr.offset(j) } != 0).count();
            let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
            result.push(String::from_utf16_lossy(slice));
        }
    }

    unsafe { LocalFree(argv as *mut std::ffi::c_void) };
    result
}

/// 从命令行中提取指定 flag 的值（全部格式由 Windows API 解析，无需手动处理引号/空格）
pub(crate) fn extract_cmd_arg(cmd_line: &str, flag: &str) -> Option<String> {
    let prefix = format!("{}=", flag);
    #[cfg(windows)]
    let args = split_windows_command_line(cmd_line);
    #[cfg(not(windows))]
    let args: Vec<String> = cmd_line.split(' ').map(|s| s.to_string()).collect();

    for arg in &args {
        if let Some(value) = arg.strip_prefix(&prefix) {
            return Some(value.to_string());
        }
    }
    None
}

/// 扫描正在运行的浏览器端口，并与目标 profiles 匹配
fn scan_running_browser_ports_and_used(
    profiles: &[(String, String)],
    used_set: &mut std::collections::HashSet<u16>,
) -> HashMap<String, u16> {
    let mut port_map: HashMap<String, u16> = HashMap::new();

    for exe_name in &["msedge.exe", "chrome.exe"] {
        let instances = scan_running_browser_instances(exe_name);
        for (key, port) in instances {
            // 检查是否匹配目标 profiles
            for (ud_dir, prof_id) in profiles {
                let target_key = format!("{}\\{}", ud_dir, prof_id);
                if key.eq_ignore_ascii_case(&target_key) {
                    port_map.insert(target_key, port);
                    used_set.insert(port);
                    break;
                }
            }
        }
    }

    port_map
}

/// 检测浏览器进程运行状态（不分配端口，仅做检测）
/// 返回每个 profile 是否正在运行，以及是否有调试端口
pub fn detect_browser_running_processes(profiles: &[(String, String)]) -> Vec<BrowserProcessState> {
    // 收集所有运行中的浏览器进程（不论有无 --remote-debugging-port）
    let mut running_by_key: HashMap<String, Option<u16>> = HashMap::new();

    for exe_name in &["msedge.exe", "chrome.exe"] {
        let instances = scan_running_browser_processes(exe_name);
        for (key, port_opt) in instances {
            running_by_key.entry(key).or_insert(port_opt);
        }
    }

    let mut result = Vec::new();
    for (user_data_dir, profile_id) in profiles {
        let key = format!("{}\\{}", user_data_dir, profile_id);
        let key_lower = key.to_lowercase();

        let matched = running_by_key.iter().find(|(k, _)| k.eq_ignore_ascii_case(&key_lower));
        if let Some((_, port_opt)) = matched {
            let cdp_reachable = port_opt.map_or(false, |port| check_cdp_reachable(port));
            result.push(BrowserProcessState {
                user_data_dir: user_data_dir.clone(),
                profile_id: profile_id.clone(),
                is_running: true,
                debug_port: port_opt.map(|p| p.to_string()),
                cdp_reachable,
            });
        } else if let Some(exe_name) = default_instance_exe(user_data_dir) {
            // 默认目录兜底（目录级识别）：用户手动启动的浏览器进程命令行无 --user-data-dir，
            // 无法精确匹配到 profile；检测到该浏览器存在「无 user-data-dir 的主进程」即视为默认目录在运行
            let default_key = format!("{}#default-instance", exe_name);
            if running_by_key.contains_key(&default_key) {
                result.push(BrowserProcessState {
                    user_data_dir: user_data_dir.clone(),
                    profile_id: profile_id.clone(),
                    is_running: true,
                    debug_port: None,
                    cdp_reachable: false,
                });
                continue;
            }
            result.push(BrowserProcessState {
                user_data_dir: user_data_dir.clone(),
                profile_id: profile_id.clone(),
                is_running: false,
                debug_port: None,
                cdp_reachable: false,
            });
        } else {
            result.push(BrowserProcessState {
                user_data_dir: user_data_dir.clone(),
                profile_id: profile_id.clone(),
                is_running: false,
                debug_port: None,
                cdp_reachable: false,
            });
        }
    }
    result
}

/// 判断 user_data_dir 是否为内置浏览器的默认用户数据目录，返回对应 exe 名
pub(crate) fn default_instance_exe(user_data_dir: &str) -> Option<&'static str> {
    for (bt, exe_name) in [("edge", "msedge.exe"), ("chrome", "chrome.exe")] {
        if let Some(def_dir) = get_user_data_dir(bt) {
            if user_data_dir.eq_ignore_ascii_case(&def_dir) {
                return Some(exe_name);
            }
        }
    }
    None
}

/// 通过 TCP 连接检测 CDP 端口是否可达（绕过浏览器 CORS 限制）
fn check_cdp_reachable(port: u16) -> bool {
    use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
    use std::time::Duration;

    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
    TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok()
}

/// 扫描正在运行的浏览器进程，返回 (key, Option<debug_port>)
/// 与 scan_running_browser_instances 不同，此函数不要求必须有 --remote-debugging-port
/// 先后尝试: 1) PowerShell Get-CimInstance, 2) wmic (回退)
pub fn scan_running_browser_processes(exe_name: &str) -> HashMap<String, Option<u16>> {
    let mut result: HashMap<String, Option<u16>> = HashMap::new();

    // ── 方法 1: PowerShell Get-CimInstance ──
    let ps_script = format!(
        "Get-CimInstance Win32_Process -Filter \"name='{}'\" \
         | Select-Object ProcessId,CommandLine \
         | ConvertTo-Json -Compress",
        exe_name
    );

    match {
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
    } {
        Ok(o) => {
            if !o.stdout.is_empty() {
                let stdout = decode_windows_stdout(&o.stdout);
                parse_process_json(&stdout, exe_name, &mut result);
            }
        }
        Err(_) => {}
    }

    // ── 方法 1 成功找到进程，直接返回 ──
    if !result.is_empty() {
        return result;
    }

    // ── 方法 2: wmic 回退（Get-CimInstance 可能因 PowerShell 策略/权限失败） ──
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let wmic_script = format!(
            "wmic process where \"name='{}'\" get ProcessId,CommandLine /FORMAT:LIST",
            exe_name
        );
        if let Ok(wmic_output) = std::process::Command::new("cmd")
            .args(["/C", &wmic_script])
            .creation_flags(0x08000000)
            .output()
        {
            if !wmic_output.stdout.is_empty() {
                let stdout = decode_windows_stdout(&wmic_output.stdout);
                parse_wmic_list(&stdout, exe_name, &mut result);
            }
        }
    }

    result
}

/// 解析 PowerShell Get-CimInstance 输出的 JSON，并入 result
fn parse_process_json(stdout: &str, exe_name: &str, result: &mut HashMap<String, Option<u16>>) {
    let processes: Vec<serde_json::Value> = if let Ok(arr) =
        serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim())
    {
        arr
    } else if let Ok(single) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        vec![single]
    } else {
        return;
    };

    for proc in &processes {
        let cmd_line = proc
            .get("CommandLine")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        extract_instance_from_cmdline(cmd_line, exe_name, result);
    }
}

/// 解析 wmic /FORMAT:LIST 输出
/// 格式:
///   ProcessId=1234
///   CommandLine="C:\...\chrome.exe" --args...
///
///   空行分隔记录
fn parse_wmic_list(stdout: &str, exe_name: &str, result: &mut HashMap<String, Option<u16>>) {
    // 按空行分割记录
    let mut current_cmd_line: Option<String> = None;
    let mut has_cmd_line = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            // 空行 = 记录结束
            if has_cmd_line {
                if let Some(cmd) = current_cmd_line.take() {
                    extract_instance_from_cmdline(&cmd, exe_name, result);
                }
                has_cmd_line = false;
            }
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("CommandLine=") {
            has_cmd_line = true;
            // wmic 输出的 CommandLine 可能被引号包裹
            let cmd = if value.starts_with('"') && value.ends_with('"') {
                // 去掉外层引号 + 反转义内部双引号
                let inner = &value[1..value.len() - 1];
                inner.replace("\"\"", "\"")
            } else {
                value.to_string()
            };
            current_cmd_line = Some(cmd);
        }
    }
    // 最后一条记录可能没有尾随空行
    if has_cmd_line {
        if let Some(cmd) = current_cmd_line.take() {
            extract_instance_from_cmdline(&cmd, exe_name, result);
        }
    }
}

/// 从命令行中提取 (user_data_dir, profile_id, port) 并入 result
/// 额外识别「默认目录实例」：默认用户数据目录的主进程（无 --type=，子进程才有）
/// 可能带 --profile-directory，也可能是极简命令行（如仅 --no-startup-window），
/// 但只要无 --user-data-dir 即视为默认目录实例（省略该参数时浏览器自动用默认目录），
/// 以 `{exe}#default-instance` 为 key 标记，供 detect_browser_running_processes 目录级兜底匹配
fn extract_instance_from_cmdline(
    cmd_line: &str,
    exe_name: &str,
    result: &mut HashMap<String, Option<u16>>,
) {
    let args = cmd_args(cmd_line);
    let get_arg = |flag: &str| {
        let prefix = format!("{}=", flag);
        args.iter()
            .find_map(|a| a.strip_prefix(&prefix))
            .map(|s| s.to_string())
    };
    let user_data_dir = get_arg("--user-data-dir");
    let profile = get_arg("--profile-directory");
    let port_str = get_arg("--remote-debugging-port");
    // 子进程（crashpad/gpu/utility/renderer 等）都带 --type=，主进程没有
    let is_child = args.iter().any(|a| a.starts_with("--type="));

    match (user_data_dir, profile) {
        (Some(ud), Some(pf)) => {
            let key = format!("{}\\{}", ud, pf);
            let port = port_str.and_then(|ps| ps.parse::<u16>().ok());
            result.entry(key).or_insert(port);
        }
        (None, _) if !is_child => {
            let key = format!("{}#default-instance", exe_name);
            let port = port_str.and_then(|ps| ps.parse::<u16>().ok());
            result.entry(key).or_insert(port);
        }
        _ => {}
    }
}

/// 拆分命令行参数（Windows 用 CommandLineToArgvW 处理引号/转义，其它平台按空格分割）
pub(crate) fn cmd_args(cmd_line: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        split_windows_command_line(cmd_line)
    }
    #[cfg(not(windows))]
    {
        cmd_line.split(' ').map(|s| s.to_string()).collect()
    }
}

/// 检查指定 profile 的正在运行的浏览器实例是否为 headless 模式。
/// `port` 为主进程的 `--remote-debugging-port`，用于精确识别主浏览器进程，
/// 避免被 GPU/渲染器等无 `--headless` 的子进程干扰。
/// 返回 `true` 表示命令行中包含 `--headless`，`false` 表示未检测到或无 headless。
pub fn is_running_instance_headless(exe_name: &str, _target_key: &str, port: u16) -> bool {
    let port_flag = format!("--remote-debugging-port={}", port);
    // 使用 PowerShell 查询进程命令行
    let ps_script = format!(
        "Get-CimInstance Win32_Process -Filter \"name='{}'\" \
         | Select-Object CommandLine \
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
    };

    match output {
        Ok(o) if !o.stdout.is_empty() => {
            let stdout = decode_windows_stdout(&o.stdout);
            // 解析 JSON
            let processes: Vec<serde_json::Value> = if let Ok(arr) =
                serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim())
            {
                arr
            } else if let Ok(single) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                vec![single]
            } else {
                return false;
            };

            // 只检查主浏览器进程：同时包含 target_key 和 --remote-debugging-port=<port>
            // 子进程（GPU、渲染器等）没有 --remote-debugging-port，不会被误匹配
            for proc in &processes {
                let cmd_line = proc
                    .get("CommandLine")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                // 只检查带有调试端口的主进程
                if !cmd_line.contains(port_flag.as_str()) {
                    continue;
                }
                if cmd_line.contains("--headless") {
                    return true;
                }
                // 主进程已找到但没有 --headless
                return false;
            }
            false
        }
        _ => false,
    }
}


/// 浏览器进程运行状态
#[derive(Debug, Clone, Serialize)]
pub struct BrowserProcessState {
    pub user_data_dir: String,
    pub profile_id: String,
    pub is_running: bool,
    pub debug_port: Option<String>,
    /// CDP 是否可达（后端 TCP 直连检测，绕过浏览器 CORS 限制）
    pub cdp_reachable: bool,
}

// ═══════════════════════════════════════════════════════
// 端口检测与分配（用于启动浏览器时选择端口）
// ═══════════════════════════════════════════════════════

/// 检测并分配端口（用于前端展示）。
/// 运行中的 profile 保留其端口；未运行的 profile 分配随机端口（仅在内存中记录，启动时以实际分配为准）。
pub fn detect_and_assign_ports(profiles: &[(String, String)]) -> Vec<PortEntry> {
    let mut assigned_ports: std::collections::HashSet<u16> = std::collections::HashSet::new();
    let mut entries = Vec::new();

    // 首先扫描运行中的浏览器端口
    let running_ports = scan_running_browser_ports_and_used(profiles, &mut assigned_ports);

    for (user_data_dir, profile_id) in profiles {
        let key = format!("{}\\{}", user_data_dir, profile_id);

        // 如果该 profile 已经在运行，保留其端口
        if let Some(&port) = running_ports.get(&key) {
            entries.push(PortEntry {
                user_data_dir: user_data_dir.clone(),
                profile_id: profile_id.clone(),
                port: port.to_string(),
                is_running: true,
            });
            continue;
        }

        // 未运行的 profile 分配一个随机可用端口（OS 分配，避免冲突）
        // 注意：此处仅为前端展示占位，实际启动时 start_or_connect 会重新分配
        let port = crate::system::port::allocate_port();
        assigned_ports.insert(port);
        entries.push(PortEntry {
            user_data_dir: user_data_dir.clone(),
            profile_id: profile_id.clone(),
            port: port.to_string(),
            is_running: false,
        });
    }
    entries
}

// ═══════════════════════════════════════════════════════
// 浏览器配置管理（检测 / 配置 / 启动 / 快捷方式）
// ═══════════════════════════════════════════════════════

/// read_profiles 进程级缓存：避免同一 Local State 文件被重复读取/解析
/// key = (user_data_dir, is_edge), value = (缓存时文件 mtime, read_profiles 返回值)
/// 命中前校验 mtime，文件变化（如浏览器内改名/改头像）后自动失效重读
static PROFILE_CACHE: OnceLock<Mutex<HashMap<(String, bool), (Option<SystemTime>, Vec<ProfileInfo>)>>> =
    OnceLock::new();

pub(crate) fn profile_cache() -> &'static Mutex<HashMap<(String, bool), (Option<SystemTime>, Vec<ProfileInfo>)>> {
    PROFILE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}
