// ============================================================
// 浏览器进程管理
//
// 包含通用的 Chrome/Edge 进程扫描、headless 检测、进程终止、
// 运行状态检测与端口分配逻辑。
//
// 浏览器类型为「注册式」：共享层仅内置通用 Edge/Chrome；
// 公司专用浏览器（如易得客6）由业务项目在启动时调用
// register_browser_detector 注册，其他项目不注册则不受影响。
// ============================================================

use crate::browser::{BrowserInfo, LaunchInfo, ProfileInfo};
use crate::config::PortEntry;
use crate::encoding::decode_windows_stdout;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use super::icons::{CHROME_ICO, EDGE_ICO};
use winreg::enums::*;
use winreg::RegKey;

// ── 自定义浏览器检测器注册表（注册式） ──

/// 自定义浏览器检测器：由业务项目注册（如 003 注册易得客6）
#[derive(Clone)]
pub struct BrowserDetector {
    /// 生成完整浏览器信息（含 exe 路径、用户数据目录、版本、children 等）
    pub detect: Arc<dyn Fn() -> BrowserInfo + Send + Sync>,
    /// 浏览器进程名（用于 kill 全部进程），如 "edecker.exe"
    pub process_name: Arc<dyn Fn() -> String + Send + Sync>,
}

static CUSTOM_DETECTORS: OnceLock<Mutex<HashMap<String, BrowserDetector>>> = OnceLock::new();

/// 注册自定义浏览器检测器（应用启动时调用）
pub fn register_browser_detector(browser_type: &str, detector: BrowserDetector) {
    CUSTOM_DETECTORS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap()
        .insert(browser_type.to_string(), detector);
}

fn custom_detector(browser_type: &str) -> Option<BrowserDetector> {
    CUSTOM_DETECTORS
        .get()?
        .lock()
        .ok()?
        .get(browser_type)
        .cloned()
}

/// 查询注册的进程名（供 kill 全部进程等场景使用）
pub fn registered_process_name(browser_type: &str) -> Option<String> {
    custom_detector(browser_type).map(|d| (d.process_name)())
}

/// 查询注册的自定义类型列表
pub fn registered_browser_types() -> Vec<String> {
    match CUSTOM_DETECTORS.get() {
        Some(reg) => reg.lock().unwrap().keys().cloned().collect(),
        None => Vec::new(),
    }
}

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
fn extract_cmd_arg(cmd_line: &str, flag: &str) -> Option<String> {
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
                parse_process_json(&stdout, &mut result);
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
                parse_wmic_list(&stdout, &mut result);
            }
        }
    }

    result
}

/// 解析 PowerShell Get-CimInstance 输出的 JSON，并入 result
fn parse_process_json(stdout: &str, result: &mut HashMap<String, Option<u16>>) {
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
        extract_instance_from_cmdline(cmd_line, result);
    }
}

/// 解析 wmic /FORMAT:LIST 输出
/// 格式:
///   ProcessId=1234
///   CommandLine="C:\...\chrome.exe" --args...
///
///   空行分隔记录
fn parse_wmic_list(stdout: &str, result: &mut HashMap<String, Option<u16>>) {
    // 按空行分割记录
    let mut current_cmd_line: Option<String> = None;
    let mut has_cmd_line = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            // 空行 = 记录结束
            if has_cmd_line {
                if let Some(cmd) = current_cmd_line.take() {
                    extract_instance_from_cmdline(&cmd, result);
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
            extract_instance_from_cmdline(&cmd, result);
        }
    }
}

/// 从命令行中提取 (user_data_dir, profile_id, port) 并入 result
fn extract_instance_from_cmdline(cmd_line: &str, result: &mut HashMap<String, Option<u16>>) {
    let user_data_dir = extract_cmd_arg(cmd_line, "--user-data-dir");
    let profile = extract_cmd_arg(cmd_line, "--profile-directory");
    let port_str = extract_cmd_arg(cmd_line, "--remote-debugging-port");

    if let (Some(ud), Some(pf)) = (user_data_dir, profile) {
        let key = format!("{}\\{}", ud, pf);
        let port = port_str.and_then(|ps| ps.parse::<u16>().ok());
        result.entry(key).or_insert(port);
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
fn kill_browser_process_inner(
    exe_name: &str,
    profile_id: &str,
    user_data_dir: &str,
) -> Result<String, String> {
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
/// key = (user_data_dir, is_edge), value = read_profiles 返回值
static PROFILE_CACHE: OnceLock<Mutex<HashMap<(String, bool), Vec<ProfileInfo>>>> = OnceLock::new();

fn profile_cache() -> &'static Mutex<HashMap<(String, bool), Vec<ProfileInfo>>> {
    PROFILE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

// ============ 注册表检测 ============

fn find_exe_in_registry(key_path: &str, value_name: &str) -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) = hklm.open_subkey_with_flags(key_path, KEY_READ) {
        if let Ok(val) = key.get_value::<String, _>(value_name) {
            if Path::new(&val).exists() {
                return Some(val);
            }
        }
    }
    None
}

fn check_standard_paths(paths: &[&str]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| Path::new(p).exists())
        .map(|p| p.to_string())
        .collect()
}

fn get_system_download_dir() -> String {
    dirs::download_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("C:\\")))
        .to_string_lossy()
        .to_string()
}

// ============ 头像读取 ============

/// 在 JSON 中递归搜索 data:image/ 开头的字符串（头像 base64 数据）
fn find_image_data_url(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) if s.starts_with("data:image/") && !s.is_empty() => {
            Some(s.clone())
        }
        serde_json::Value::Object(obj) => {
            for val in obj.values() {
                if let Some(found) = find_image_data_url(val) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for val in arr {
                if let Some(found) = find_image_data_url(val) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// 读取的图片数据
#[derive(Debug)]
pub struct ImageData {
    pub base64: String,
    pub is_icon: bool,
}

/// 头像缩略阈值：小于该字节数的图片直接原样 base64（避免小图重编码反而变大）
const AVATAR_THUMB_THRESHOLD: usize = 4096;

/// 将图片字节编码为 base64 data URL。
/// png/jpeg 大图（>= 4KB）压缩为 64x64 PNG，大幅减小 IPC 传输与前端列表渲染开销；
/// 缩略失败或小图时回退原样编码。
fn to_avatar_base64(data: &[u8], mime: &str) -> String {
    let encode_original = |bytes: &[u8]| -> String {
        format!(
            "data:{};base64,{}",
            mime,
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
        )
    };

    if data.len() >= AVATAR_THUMB_THRESHOLD && (mime == "image/png" || mime == "image/jpeg") {
        if let Ok(img) = image::load_from_memory(data) {
            let thumb = img.thumbnail(64, 64);
            let mut out = Vec::new();
            if thumb
                .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
                .is_ok()
            {
                return format!(
                    "data:image/png;base64,{}",
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &out)
                );
            }
        }
    }
    encode_original(data)
}

/// Chrome 内置预设头像资源表（index -> 文件名），来源于 Chromium
/// chrome/browser/profiles/profile_avatar_icon_util.cc 的 GetDefaultAvatarIconResourceInfo()。
/// index 26 为占位符（无图片文件，Chrome 显示默认空图标）。
/// 新版 Chrome（151+）将用户使用的预设头像图片按需下载/缓存到 {User Data}\Avatars\{文件名}。
const AVATAR_INDEX_FILES: [&str; 56] = [
    // Old avatar icons (0-25)
    "avatar_generic.png",
    "avatar_generic_aqua.png",
    "avatar_generic_blue.png",
    "avatar_generic_green.png",
    "avatar_generic_orange.png",
    "avatar_generic_purple.png",
    "avatar_generic_red.png",
    "avatar_generic_yellow.png",
    "avatar_secret_agent.png",
    "avatar_superhero.png",
    "avatar_volley_ball.png",
    "avatar_businessman.png",
    "avatar_ninja.png",
    "avatar_alien.png",
    "avatar_awesome.png",
    "avatar_flower.png",
    "avatar_pizza.png",
    "avatar_soccer.png",
    "avatar_burger.png",
    "avatar_cat.png",
    "avatar_cupcake.png",
    "avatar_dog.png",
    "avatar_horse.png",
    "avatar_margarita.png",
    "avatar_note.png",
    "avatar_sun_cloud.png",
    // Placeholder (26)
    "",
    // Modern avatar icons (27-55)
    "avatar_origami_cat.png",
    "avatar_origami_corgi.png",
    "avatar_origami_dragon.png",
    "avatar_origami_elephant.png",
    "avatar_origami_fox.png",
    "avatar_origami_monkey.png",
    "avatar_origami_panda.png",
    "avatar_origami_penguin.png",
    "avatar_origami_pinkbutterfly.png",
    "avatar_origami_rabbit.png",
    "avatar_origami_unicorn.png",
    "avatar_illustration_basketball.png",
    "avatar_illustration_bike.png",
    "avatar_illustration_bird.png",
    "avatar_illustration_cheese.png",
    "avatar_illustration_football.png",
    "avatar_illustration_ramen.png",
    "avatar_illustration_sunglasses.png",
    "avatar_illustration_sushi.png",
    "avatar_illustration_tamagotchi.png",
    "avatar_illustration_vinyl.png",
    "avatar_abstract_avocado.png",
    "avatar_abstract_cappuccino.png",
    "avatar_abstract_icecream.png",
    "avatar_abstract_icewater.png",
    "avatar_abstract_melon.png",
    "avatar_abstract_onigiri.png",
    "avatar_abstract_pizza.png",
    "avatar_abstract_sandwich.png",
];

/// 新版 Chrome/Edge（151+）预设头像：Local State 的 profile.info_cache 记录
/// avatar_icon=chrome://theme/IDR_PROFILE_AVATAR_N，头像图片按需下载/缓存到
/// {User Data}\Avatars\{文件名}。未登录但手动设置了预设头像的 profile 由此恢复。
/// 找不到（未设置头像、文件未缓存）时返回 None。
/// avatar_icon 由调用方从已解析的 Local State JSON 传入（避免每个 profile 重复读+解析大文件）。
fn read_avatar_file_by_index(user_data: &Path, avatar_icon: &str) -> Option<Vec<u8>> {
    let marker = "IDR_PROFILE_AVATAR_";
    let idx = avatar_icon.rfind(marker)?;
    let n: usize = avatar_icon[idx + marker.len()..].parse().ok()?;
    let fname = AVATAR_INDEX_FILES.get(n)?;
    if fname.is_empty() {
        return None;
    }
    fs::read(user_data.join("Avatars").join(fname)).ok()
}

/// 读取头像图片为 base64
fn read_avatar_base64(profile_path: &std::path::Path, is_edge: bool) -> ImageData {
    // 1. 尝试读取 PNG 头像（从 screenshot 目录获取）
    let screenshot_dir = profile_path.join("Screenshots");
    if screenshot_dir.exists() {
        if let Ok(entries) = fs::read_dir(&screenshot_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ext == "png" || ext == "jpg" || ext == "jpeg" {
                        if let Ok(data) = fs::read(&path) {
                            let mime = if ext == "png" { "image/png" } else { "image/jpeg" };
                            return ImageData {
                                base64: to_avatar_base64(&data, mime),
                                is_icon: false,
                            };
                        }
                    }
                }
            }
        }
    }

    // 2. 尝试读取 Google/Edge Profile Picture.png
    for name in &["Google Profile Picture.png", "Edge Profile Picture.png", "Profile Picture.png", "avatar.jpg", "avatar.png"] {
        let img_path = profile_path.join(name);
        if img_path.exists() {
            if let Ok(data) = fs::read(&img_path) {
                let ext = img_path.extension().and_then(|e| e.to_str()).unwrap_or("png");
                let mime = if ext == "jpg" || ext == "jpeg" { "image/jpeg" } else { "image/png" };
                return ImageData {
                    base64: to_avatar_base64(&data, mime),
                    is_icon: false,
                };
            }
        }
    }

    // 3. 尝试读取 ico 图标
    for name in &["Edge Profile.ico", "Google Profile.ico", "Profile.ico", "avatar.ico"] {
        let ico_path = profile_path.join(name);
        if ico_path.exists() {
            if let Ok(data) = fs::read(&ico_path) {
                return ImageData {
                    base64: to_avatar_base64(&data, "image/x-icon"),
                    is_icon: true,
                };
            }
        }
    }

    // 4. 尝试读取 Avatar 目录下的图片
    let avatar_dir = profile_path.join("Avatar");
    if avatar_dir.exists() {
        if let Ok(entries) = fs::read_dir(&avatar_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "webp" {
                        if let Ok(data) = fs::read(&path) {
                            let mime = match ext.to_str().unwrap_or("png") {
                                "jpg" | "jpeg" => "image/jpeg",
                                "webp" => "image/webp",
                                _ => "image/png",
                            };
                            return ImageData {
                                base64: to_avatar_base64(&data, mime),
                                is_icon: false,
                            };
                        }
                    }
                }
            }
        }
    }

    // 5. 尝试从 Preferences 递归搜索头像数据
    let prefs_path = profile_path.join("Preferences");
    if let Ok(content) = fs::read_to_string(&prefs_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            // 搜索 data:image/ 开头的值
            if let Some(pic_data) = find_image_data_url(&json) {
                return ImageData {
                    base64: pic_data,
                    is_icon: false,
                };
            }
            // 搜索 profile/gaia_info_picture_url
            if let Some(url) = json.pointer("/profile/gaia_info_picture_url")
                .and_then(|v| v.as_str())
                .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
            {
                return ImageData {
                    base64: url.to_string(),
                    is_icon: false,
                };
            }
        }
    }

    // 6. 检查用户数据目录根层的 Avatars 目录（Edge 可能缓存主题头像）
    if is_edge {
        for av_dir_name in &["Avatars", "Profile Avatars", "GAIAPicture"] {
            let av_dir = profile_path.parent().map(|p| p.join(av_dir_name));
            if let Some(av_dir) = av_dir {
                if av_dir.exists() {
                    if let Ok(entries) = fs::read_dir(&av_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if let Some(ext) = path.extension() {
                                if ext == "png" || ext == "jpg" || ext == "webp" || ext == "ico" {
                                    if let Ok(data) = fs::read(&path) {
                                        let mime = match ext.to_str().unwrap_or("png") {
                                            "jpg" | "jpeg" => "image/jpeg",
                                            "webp" => "image/webp",
                                            "ico" => "image/x-icon",
                                            _ => "image/png",
                                        };
                                        return ImageData {
                                            base64: to_avatar_base64(&data, mime),
                                            is_icon: ext == "ico",
                                        };
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 7. 新版 Chrome/Edge（151+）预设头像：由调用方用已解析的 info_cache.avatar_icon
    //    调用 read_avatar_file_by_index 处理（见 read_profiles 内），避免重复解析 Local State。

    ImageData {
        base64: String::new(),
        is_icon: false,
    }
}

// ============ 浏览器版本 ============

/// 从注册表读取浏览器版本（支持多个备选路径）
fn get_browser_version(browser_type: &str) -> String {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // 尝试从指定注册表路径读取版本
    let try_read = |subkey: &str, value: &str| -> Option<String> {
        if let Ok(key) = hklm.open_subkey_with_flags(subkey, KEY_READ | KEY_WOW64_64KEY) {
            if let Ok(ver) = key.get_value::<String, _>(value) {
                if !ver.is_empty() {
                    return Some(ver);
                }
            }
        }
        // 尝试从 32 位注册表读取（WOW6432Node）
        if let Ok(key) = hklm.open_subkey_with_flags(subkey, KEY_READ | KEY_WOW64_32KEY) {
            if let Ok(ver) = key.get_value::<String, _>(value) {
                if !ver.is_empty() {
                    return Some(ver);
                }
            }
        }
        None
    };

    match browser_type {
        "edge" => {
            // 主路径：BLBeacon
            if let Some(ver) = try_read(
                r"SOFTWARE\Microsoft\Edge\BLBeacon",
                "version",
            ) {
                return ver;
            }
            // 备选：Uninstall 注册表
            if let Some(ver) = try_read(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge",
                "DisplayVersion",
            ) {
                return ver;
            }
        }
        "chrome" => {
            // Chrome Stable
            if let Some(ver) = try_read(
                r"SOFTWARE\Google\Update\Clients\{8A69D345-D564-463c-AFF1-A69D9E530F96}",
                "pv",
            ) {
                return ver;
            }
            // 备选：Uninstall 注册表
            if let Some(ver) = try_read(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Google Chrome",
                "DisplayVersion",
            ) {
                return ver;
            }
        }
        _ => {}
    }
    String::new()
}

// ============ 读取用户配置 ============

/// 读取浏览器用户配置（增强版）
/// 结果缓存于进程级 HashMap 中，同一 (user_data_dir, is_edge) 组合仅读取一次磁盘
fn read_profiles(user_data_dir: &str, is_edge: bool) -> Vec<ProfileInfo> {
    // 进程级缓存：同一目录 + 同一 is_edge 参数仅读取一次
    {
        let cache = profile_cache().lock().unwrap();
        if let Some(cached) = cache.get(&(user_data_dir.to_string(), is_edge)) {
            return cached.clone();
        }
    }

    let local_state_path = Path::new(user_data_dir).join("Local State");
    if !local_state_path.exists() {
        // 用户数据目录不存在 → 未安装该浏览器，无需报错
        if !Path::new(user_data_dir).exists() {
            return vec![];
        }
        eprintln!(
            "[read_profiles] 失败: Local State 文件不存在: {}",
            local_state_path.display()
        );
        return vec![];
    }

    let content = match fs::read_to_string(&local_state_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(
                "[read_profiles] 失败: 无法读取 Local State 文件 (可能被浏览器锁定): {} | 错误: {}",
                local_state_path.display(),
                e
            );
            return vec![];
        }
    };

    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            eprintln!(
                "[read_profiles] 失败: Local State JSON 解析错误: {} | 错误: {}",
                local_state_path.display(),
                e
            );
            return vec![];
        }
    };

    let info_cache = match json
        .pointer("/profile/info_cache")
        .and_then(|v| v.as_object())
    {
        Some(c) => c,
        None => {
            // 诊断：列出 /profile 下实际存在的 key
            let available_keys: Vec<&str> = json
                .pointer("/profile")
                .and_then(|v| v.as_object())
                .map(|obj| obj.keys().map(|k| k.as_str()).collect())
                .unwrap_or_default();
            eprintln!(
                "[read_profiles] 失败: Local State 中缺少 /profile/info_cache: {} | /profile 下实际 key: {:?}",
                local_state_path.display(),
                available_keys
            );
            return vec![];
        }
    };

    eprintln!(
        "[read_profiles] 成功: {} 找到 {} 个 profile entry",
        local_state_path.display(),
        info_cache.len()
    );

    let system_download = get_system_download_dir();
    let mut profiles = Vec::new();

    for (profile_id, info) in info_cache {
        let name = info
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(profile_id);

        // 从 info_cache 中获取更多信息
        let user_name = info
            .get("user_name")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let email = info
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let profile_path = Path::new(user_data_dir).join(profile_id);
        let profile_path_str = profile_path.to_string_lossy().to_string();

        // 读取头像（先尝试文件系统，再尝试 info_cache 条目中的 avatar_icon 等字段）
        let mut avatar = read_avatar_base64(&profile_path, is_edge);
        if avatar.base64.is_empty() {
            // 在 info_cache 中递归搜索 data:image/ 开头的值
            if let Some(pic_data) = find_image_data_url(info) {
                avatar = ImageData {
                    base64: pic_data,
                    is_icon: false,
                };
            }
        }
        if avatar.base64.is_empty() {
            // 检查 info_cache 中的 avatar_icon 是否为 HTTP URL
            if let Some(icon_url) = info
                .get("avatar_icon")
                .and_then(|v| v.as_str())
                .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
            {
                avatar = ImageData {
                    base64: icon_url.to_string(),
                    is_icon: false,
                };
            }
        }
        if avatar.base64.is_empty() {
            // 7. 新版 Chrome/Edge（151+）预设头像：Local State info_cache 记录
            //    avatar_icon=chrome://theme/IDR_PROFILE_AVATAR_N，图片按需下载缓存到
            //    {User Data}\Avatars\{文件名}。未登录但手动设置了预设头像的 profile 由此恢复。
            //    avatar_icon 来自已解析的 Local State JSON（info），无需重复读文件。
            if let Some(icon) = info.get("avatar_icon").and_then(|v| v.as_str()) {
                if let Some(data) = read_avatar_file_by_index(&profile_path, icon) {
                    avatar = ImageData {
                        base64: to_avatar_base64(&data, "image/png"),
                        is_icon: false,
                    };
                }
            }
        }
        if avatar.base64.is_empty() {
            // 最后检查 Preferences 中的 gaia_info_picture_url
            let prefs_path = profile_path.join("Preferences");
            if let Ok(content) = fs::read_to_string(&prefs_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(url) = json.pointer("/profile/gaia_info_picture_url")
                        .and_then(|v| v.as_str())
                        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
                    {
                        avatar = ImageData {
                            base64: url.to_string(),
                            is_icon: false,
                        };
                    }
                }
            }
        }

        // 从 Preferences 读取下载目录
        let download_dir = super::profile::read_download_dir_from_prefs(&profile_path.join("Preferences"))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| system_download.clone());

        profiles.push(ProfileInfo {
            id: profile_id.clone(),
            name: name.to_string(),
            user_name: user_name.to_string(),
            email: email.to_string(),
            path: profile_path_str,
            user_data_dir: user_data_dir.to_string(),
            download_dir,
            avatar_base64: avatar.base64,
            avatar_has_icon: avatar.is_icon,
        });
    }

    // 按 profile id 排序（Default 排第一）
    profiles.sort_by(|a, b| {
        if a.id == "Default" {
            std::cmp::Ordering::Less
        } else if b.id == "Default" {
            std::cmp::Ordering::Greater
        } else {
            a.id.cmp(&b.id)
        }
    });

    // 写入缓存，后续相同参数的调用直接命中
    profile_cache()
        .lock()
        .unwrap()
        .insert((user_data_dir.to_string(), is_edge), profiles.clone());

    profiles
}

// ============ 可执行文件路径 ============

fn get_exe_paths(browser_type: &str) -> Vec<String> {
    match browser_type {
        "edge" => {
            let mut paths = Vec::new();
            // 注册表
            if let Some(p) = find_exe_in_registry(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
                "",
            ) {
                paths.push(p);
            }
            if let Some(p) = find_exe_in_registry(
                r"SOFTWARE\Microsoft\Edge\BLBeacon",
                "version",
            ) {
                // 注册表中的 version 值的父键可能有 exe 路径
                let exe = format!(
                    r"{}\msedge.exe",
                    std::path::Path::new(&p)
                        .parent()
                        .map(|d| d.to_string_lossy())
                        .unwrap_or(std::borrow::Cow::Borrowed(""))
                );
                if Path::new(&exe).exists() {
                    paths.push(exe);
                }
            }
            // 标准安装路径
            let standard = check_standard_paths(&[
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                &format!(
                    r"{}\Microsoft\Edge\Application\msedge.exe",
                    dirs::data_local_dir()
                        .map(|d| d.to_string_lossy().to_string())
                        .unwrap_or_default()
                ),
            ]);
            paths.extend(standard);
            paths.sort();
            paths.dedup();
            // 未安装时提供默认路径以便用户自行填写
            if paths.is_empty() {
                paths.push(
                    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
                        .to_string(),
                );
            }
            paths
        }
        "chrome" => {
            let mut paths = Vec::new();
            if let Some(p) = find_exe_in_registry(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                "",
            ) {
                paths.push(p);
            }
            let standard = check_standard_paths(&[
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                &format!(
                    r"{}\Google\Chrome\Application\chrome.exe",
                    dirs::data_local_dir()
                        .map(|d| d.to_string_lossy().to_string())
                        .unwrap_or_default()
                ),
            ]);
            paths.extend(standard);
            paths.sort();
            paths.dedup();
            // 未安装时提供默认路径以便用户自行填写
            if paths.is_empty() {
                paths.push(
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe"
                        .to_string(),
                );
            }
            paths
        }
        _ => {
            // 注册式：自定义浏览器类型的 exe 路径由注册的检测器提供
            if let Some(det) = custom_detector(browser_type) {
                (det.detect)().exe_paths
            } else {
                Vec::new()
            }
        }
    }
}

fn get_user_data_dir(browser_type: &str) -> Option<String> {
    let local_app_data = dirs::data_local_dir()?;
    match browser_type {
        "edge" => Some(
            format!(
                r"{}\Microsoft\Edge\User Data",
                local_app_data.to_string_lossy()
            ),
        ),
        "chrome" => Some(
            format!(
                r"{}\Google\Chrome\User Data",
                local_app_data.to_string_lossy()
            ),
        ),
        _ => {
            // 注册式：自定义浏览器类型的用户数据目录由注册的检测器提供
            if let Some(det) = custom_detector(browser_type) {
                let info = (det.detect)();
                if info.default_user_data_dir.is_empty() {
                    None
                } else {
                    Some(info.default_user_data_dir)
                }
            } else {
                None
            }
        }
    }
}

fn scan_peer_user_data_dirs(default_user_data_dir: &str) -> Vec<String> {
    if default_user_data_dir.is_empty() {
        return vec![];
    }
    let parent = Path::new(default_user_data_dir)
        .parent()
        .map(|p| p.to_path_buf());
    let Some(parent) = parent else { return vec![] };
    if !parent.exists() {
        return vec![];
    }
    let default_name = Path::new(default_user_data_dir)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(&parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name == default_name {
                continue;
            }
            // 检查是否为有效的用户数据目录（含有 Local State）
            let ls = path.join("Local State");
            if ls.exists() {
                result.push(path.to_string_lossy().to_string());
            }
        }
    }
    result
}

/// 扫描品牌目录下的大小写不敏感 RPA 变体目录（如 "Edge Rpa"、"Chrome RPA"）
/// 返回其下所有含 Local State 的子目录
fn scan_brand_rpa_dirs(brand: &str, default_user_data_dir: &str) -> Vec<String> {
    // default_user_data_dir = "...\Microsoft\Edge\User Data"
    // parent = "...\Microsoft\Edge"
    // parent.parent = "...\Microsoft" → 遍历找到 "...\Microsoft\Edge Rpa"
    let parent_parent = match Path::new(default_user_data_dir)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
    {
        Some(p) => p,
        None => return vec![],
    };
    let rpa_target = format!("{} rpa", brand).to_lowercase();
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(&parent_parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            if name != rpa_target {
                continue;
            }
            // 找到了 RPA 目录，扫描其下所有含 Local State 的子目录
            if let Ok(subs) = fs::read_dir(&path) {
                for sub in subs.flatten() {
                    let sub_path = sub.path();
                    if !sub_path.is_dir() {
                        continue;
                    }
                    if sub_path.join("Local State").exists() {
                        result.push(sub_path.to_string_lossy().to_string());
                    }
                }
            }
            break;
        }
    }
    result
}

/// 从可执行文件读取版本号
fn get_file_version(exe_path: &str) -> String {
    if exe_path.is_empty() {
        return String::new();
    }
    #[cfg(windows)]
    if let Ok(output) = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(format!("(Get-Item '{}').VersionInfo.FileVersion", exe_path.replace('\'', "''")))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
    } {
        let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !ver.is_empty() { ver } else { String::new() }
    } else {
        String::new()
    }
}

// ============ 检测 Edge ============

fn detect_edge() -> BrowserInfo {
    let exe_paths = get_exe_paths("edge");
    let installed = !exe_paths.is_empty();
    let default_user_data = get_user_data_dir("edge").unwrap_or_default();
    let user_data_dirs = if !default_user_data.is_empty() {
        vec![default_user_data.clone()]
    } else {
        Vec::new()
    };
    let mut suggested = scan_peer_user_data_dirs(&default_user_data);
    suggested.extend(scan_brand_rpa_dirs("Edge", &default_user_data));
    let version = get_file_version(exe_paths.first().map_or("", |p| p.as_str()));
    let default_dir = default_user_data.clone();
    let profiles = if !default_dir.is_empty() {
        read_profiles(&default_dir, true)
    } else {
        Vec::new()
    };

    BrowserInfo {
        browser_type: "edge".to_string(),
        browser_name: "Microsoft Edge".to_string(),
        browser_icon_base64: EDGE_ICO.to_string(),
        installed,
        exe_paths,
        user_data_dirs,
        default_user_data_dir: default_user_data,
        default_debug_port: 0,
        browser_version: version,
        suggested_user_data_dirs: suggested,
        profiles,
        children: vec![],
    }
}

// ============ 检测 Chrome ============

fn detect_chrome() -> BrowserInfo {
    let exe_paths = get_exe_paths("chrome");
    let installed = !exe_paths.is_empty();
    let default_user_data = get_user_data_dir("chrome").unwrap_or_default();
    let user_data_dirs = if !default_user_data.is_empty() {
        vec![default_user_data.clone()]
    } else {
        Vec::new()
    };
    let mut suggested = scan_peer_user_data_dirs(&default_user_data);
    suggested.extend(scan_brand_rpa_dirs("Chrome", &default_user_data));
    let version = get_file_version(exe_paths.first().map_or("", |p| p.as_str()));
    let default_dir = default_user_data.clone();
    let profiles = if !default_dir.is_empty() {
        read_profiles(&default_dir, false)
    } else {
        Vec::new()
    };

    BrowserInfo {
        browser_type: "chrome".to_string(),
        browser_name: "Google Chrome".to_string(),
        browser_icon_base64: CHROME_ICO.to_string(),
        installed,
        exe_paths,
        user_data_dirs,
        default_user_data_dir: default_user_data,
        default_debug_port: 0,
        browser_version: version,
        suggested_user_data_dirs: suggested,
        profiles,
        children: vec![],
    }
}

// ============ 公共 API ============

/// 检测所有已安装浏览器（内置 Edge/Chrome + 业务项目注册的自定义浏览器）
pub fn detect_all_browsers() -> Vec<BrowserInfo> {
    let mut browsers = Vec::new();
    browsers.push(detect_edge());
    browsers.push(detect_chrome());
    if let Some(reg) = CUSTOM_DETECTORS.get() {
        for (browser_type, detector) in reg.lock().unwrap().iter() {
            let info = (detector.detect)();
            if info.browser_type.is_empty() {
                eprintln!("[detect_all_browsers] 注册的检测器 {} 返回了空的 browser_type，已跳过", browser_type);
                continue;
            }
            browsers.push(info);
        }
    }
    browsers
}

/// 根据自定义路径检测浏览器配置
pub fn detect_profiles_from(
    browser_type: &str,
    custom_exe_path: Option<&str>,
    user_data_dirs: &[String],
) -> BrowserInfo {
    let icons: HashMap<&str, (&str, &str)> = HashMap::from([
        ("edge", ("Microsoft Edge", EDGE_ICO)),
        ("chrome", ("Google Chrome", CHROME_ICO)),
    ]);

    // 注册类型：名称/图标/端口/children/版本 取自注册的检测器
    let registered = custom_detector(browser_type);
    let (browser_name, icon_b64, default_port, children, base_version) =
        if let Some(det) = &registered {
            let base = (det.detect)();
            (
                base.browser_name,
                base.browser_icon_base64,
                base.default_debug_port,
                base.children,
                base.browser_version,
            )
        } else {
            let (name, icon) = icons
                .get(browser_type)
                .copied()
                .unwrap_or(("浏览器", EDGE_ICO));
            (
                name.to_string(),
                icon.to_string(),
                9222,
                Vec::new(),
                String::new(),
            )
        };

    let exe_paths = if let Some(exe) = custom_exe_path {
        if Path::new(exe).exists() {
            vec![exe.to_string()]
        } else {
            get_exe_paths(browser_type)
        }
    } else {
        get_exe_paths(browser_type)
    };

    let mut all_profiles = Vec::new();
    for udd in user_data_dirs {
        if Path::new(udd).exists() {
            let profiles = read_profiles(udd, browser_type == "edge");
            all_profiles.extend(profiles);
        }
    }

    // 去重：同 id + 同目录才视为重复
    all_profiles.sort_by(|a, b| a.id.cmp(&b.id).then(a.user_data_dir.cmp(&b.user_data_dir)));
    all_profiles.dedup_by(|a, b| a.id == b.id && a.user_data_dir == b.user_data_dir);

    let version = if !base_version.is_empty() {
        base_version
    } else {
        get_browser_version(browser_type)
    };

    // 扫描同级目录作为 suggested（不包含默认目录）
    let default_user_data = user_data_dirs.first().map(|s| s.as_str()).unwrap_or("");
    let mut suggested = scan_peer_user_data_dirs(default_user_data);
    // 对 Edge / Chrome 同时扫描 RPA 变体目录
    if browser_type == "edge" || browser_type == "chrome" {
        let brand = if browser_type == "edge" { "Edge" } else { "Chrome" };
        suggested.extend(scan_brand_rpa_dirs(brand, default_user_data));
    }

    BrowserInfo {
        browser_type: browser_type.to_string(),
        browser_name,
        browser_icon_base64: icon_b64,
        installed: !exe_paths.is_empty(),
        exe_paths,
        user_data_dirs: user_data_dirs.to_vec(),
        default_user_data_dir: user_data_dirs
            .first()
            .cloned()
            .unwrap_or_default(),
        default_debug_port: default_port,
        browser_version: version,
        suggested_user_data_dirs: suggested,
        profiles: all_profiles,
        children,
    }
}

/// 生成启动命令信息
pub fn generate_launch_cmd(
    browser_type: &str,
    profile_id: &str,
    user_data_dir: &str,
    debug_port: u16,
) -> LaunchInfo {
    let exe_paths = get_exe_paths(browser_type);
    let exe_path = exe_paths
        .first()
        .cloned()
        .unwrap_or_else(|| "chrome.exe".to_string());

    let args = vec![
        format!("--profile-directory=\"{}\"", profile_id),
        format!("--user-data-dir=\"{}\"", user_data_dir),
    ];

    let cmd_args: Vec<String> = args
        .iter()
        .map(|a| a.clone())
        .collect();
    let command_line = format!("\"{}\" {}", exe_path, cmd_args.join(" "));

    LaunchInfo {
        exe_path: exe_path.clone(),
        args: cmd_args,
        command_line,
        debug_port,
    }
}

/// 启动浏览器指定配置
pub fn launch_profile(
    browser_type: &str,
    profile_id: &str,
    user_data_dir: &str,
    debug_port: u16,
) -> Result<String, String> {
    let exe_paths = get_exe_paths(browser_type);
    let exe_path = exe_paths
        .first()
        .ok_or_else(|| format!("未找到 {} 浏览器可执行文件", browser_type))?;

    let mut cmd = std::process::Command::new(exe_path);
    cmd.arg(format!("--profile-directory={}", profile_id))
        .arg(format!("--user-data-dir={}", user_data_dir));

    // 仅当明确指定了调试端口时才添加 --remote-debugging-port
    if debug_port > 0 {
        cmd.arg(format!("--remote-debugging-port={}", debug_port));
    }

    let status = cmd.spawn().map_err(|e| format!("启动失败: {}", e))?;

    Ok(format!("PID:{}", status.id()))
}

/// 创建桌面快捷方式
pub fn create_shortcut(browser_type: &str, profile_id: &str, user_data_dir: &str, profile_name: &str, _avatar_path: &str, _debug_port: u16) -> Result<String, String> {
    let exe_paths = get_exe_paths(browser_type);
    let exe_path = exe_paths.first().ok_or_else(|| "未找到浏览器可执行文件".to_string())?;
    let desktop = dirs::desktop_dir().ok_or_else(|| "未找到桌面目录".to_string())?;
    let safe_name = sanitize_filename(profile_name);
    let lnk_path = desktop.join(format!("{}.lnk", safe_name));

    // 检查快捷方式是否已存在
    let is_overwrite = lnk_path.exists();

    // 使用 PowerShell 创建快捷方式
    let ps_script = format!(
        r#"
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut("{}")
$Shortcut.TargetPath = "{}"
$Shortcut.Arguments = '--profile-directory="{}" --user-data-dir="{}"'
$Shortcut.Description = "Browser - {} {}"
$Shortcut.Save()
"#,
        lnk_path.display(),
        exe_path,
        profile_id,
        user_data_dir,
        browser_type,
        profile_name,
    );

    let _ = {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("powershell")
                .arg("-NoProfile")
                .arg("-Command")
                .arg(&ps_script)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .map_err(|e| format!("创建快捷方式失败: {}", e))?
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("powershell")
                .arg("-NoProfile")
                .arg("-Command")
                .arg(&ps_script)
                .output()
                .map_err(|e| format!("创建快捷方式失败: {}", e))?
        }
    };

    if is_overwrite {
        Ok(format!("overwrite:{}", lnk_path.to_string_lossy()))
    } else {
        Ok(lnk_path.to_string_lossy().to_string())
    }
}

fn sanitize_filename(name: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    name.chars()
        .map(|c| if invalid.contains(&c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// 创建新的用户数据目录并自动初始化
/// 1. 创建独立用户数据目录（避免 Profile 1/2/... 编号问题）
/// 2. 静默启动浏览器让浏览器自动生成完整的配置结构
/// 3. 等待初始化完成后关闭浏览器
/// 4. 返回初始化完成的目录路径
pub fn create_new_user_data_dir(
    browser_type: &str,
    parent_dir: &str,
    dir_name: &str,
) -> Result<String, String> {
    let dir_name = sanitize_dir_name(dir_name);
    let new_dir = std::path::Path::new(parent_dir).join(&dir_name);

    if new_dir.exists() {
        return Err(format!("目录已存在: {}", new_dir.display()));
    }

    // 1. 创建空目录
    std::fs::create_dir_all(&new_dir)
        .map_err(|e| format!("创建目录失败: {}", e))?;

    // 2. 获取浏览器可执行文件路径
    let exe_paths = get_exe_paths(browser_type);
    let exe = exe_paths.into_iter().next()
        .ok_or_else(|| "未找到浏览器可执行文件".to_string())?;

    // 3. 启动浏览器进行初始化（最小化窗口，无首次运行向导）
    let mut child = std::process::Command::new(&exe)
        .arg(format!("--user-data-dir={}", new_dir.display()))
        .arg("--no-first-run")
        .arg("--disable-features=HideUserDataDirInUse")
        .arg("--window-size=1,1")
        .arg("--hide-crash-restore-bubble")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动浏览器失败: {}", e))?;

    // 4. 等待浏览器初始化完成（分两阶段）
    let default_dir = new_dir.join("Default");
    let local_state = new_dir.join("Local State");
    let prefs = default_dir.join("Preferences");

    let timeout = std::time::Duration::from_secs(30);
    let poll_interval = std::time::Duration::from_millis(500);
    let start = std::time::Instant::now();

    // 阶段一：等待基本文件（Default/Preferences 和 Local State）生成
    let files_ready = loop {
        if default_dir.exists() && local_state.exists() && prefs.exists() {
            break true;
        }
        if start.elapsed() > timeout {
            break false;
        }
        std::thread::sleep(poll_interval);
    };

    if !files_ready {
        let _ = child.kill();
        let _ = child.wait();
        return Err(
            "浏览器初始化超时(30秒)，请手动启动一次浏览器完成配置。\n\
            目录已创建，打开浏览器后工具会自动识别。".to_string()
        );
    }

    // 阶段二：等待 Local State 中的 profile.info_cache 写入完整数据
    // 浏览器被 kill 前需要把 profile 信息写入 info_cache，否则 read_profiles 读取为空
    let info_cache_ready = loop {
        if let Ok(content) = std::fs::read_to_string(&local_state) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(cache) = json
                    .pointer("/profile/info_cache")
                    .and_then(|v| v.as_object())
                {
                    if !cache.is_empty() {
                        break true;
                    }
                }
            }
        }
        if start.elapsed() > timeout {
            break false;
        }
        std::thread::sleep(poll_interval);
    };

    // 5. 关闭浏览器
    let _ = child.kill();
    let _ = child.wait();

    if !info_cache_ready {
        return Err(
            "浏览器初始化完成但 profile 信息尚未写入，请手动启动一次浏览器完成配置。\n\
            目录已创建，打开浏览器后工具会自动识别。".to_string()
        );
    }

    Ok(new_dir.to_string_lossy().to_string())
}

fn sanitize_dir_name(name: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*', '\n', '\r'];
    name.chars()
        .map(|c| if invalid.contains(&c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// 杀死指定配置的浏览器进程（先通过 WMI 查找 PID，再用 taskkill 精确杀死）
pub fn kill_browser_profile_process(
    browser_type: &str,
    profile_id: &str,
    user_data_dir: &str,
) -> Result<String, String> {
    let exe_name = match browser_type {
        "edge" => "msedge.exe",
        "chrome" => "chrome.exe",
        _ => return Err(format!("不支持的浏览器类型: {}", browser_type)),
    };
    kill_browser_process_inner(exe_name, profile_id, user_data_dir)
}
