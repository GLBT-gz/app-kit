//! 浏览器进程扫描、运行状态检测与端口分配

use crate::browser::ProfileInfo;
use crate::config::PortEntry;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;
use super::browser_paths::get_user_data_dir;
use serde::Serialize;

/// 扫描正在运行的浏览器实例（含调试端口）
pub fn scan_running_browser_instances(exe_name: &str) -> HashMap<String, u16> {
    let mut port_map: HashMap<String, u16> = HashMap::new();

    for (_exe, cmd_line) in scan_running_processes_native(&[exe_name]) {
        let user_data_dir = extract_cmd_arg(&cmd_line, "--user-data-dir");
        let profile = extract_cmd_arg(&cmd_line, "--profile-directory");
        let port_str = extract_cmd_arg(&cmd_line, "--remote-debugging-port");

        if let (Some(ud), Some(pf), Some(ps)) = (user_data_dir, profile, port_str) {
            if let Ok(port) = ps.parse::<u16>() {
                let key = format!("{}\\{}", ud, pf);
                port_map.entry(key).or_insert(port);
            }
        }
    }

    port_map
}

/// Windows 原生进程枚举：一次性快照全系统进程，读取与目标 exe 名匹配的进程命令行。
///
/// 用 CreateToolhelp32Snapshot + NtQueryInformationProcess(ProcessCommandLineInformation)
/// 替代 PowerShell Get-CimInstance / wmic 子进程——旧实现每次冷启动 PowerShell（约 1s+），
/// 且在同步 Tauri 命令里阻塞主线程，导致「当前浏览器配置」tab 滚轮卡顿（详见踩坑记录）。
/// 返回 (exe_name, command_line) 列表；读取失败（受保护进程等）的进程自动跳过。
#[cfg(windows)]
fn scan_running_processes_native(exe_names: &[&str]) -> Vec<(String, String)> {
    use std::ffi::c_void;
    use std::mem::size_of;

    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_VM_READ: u32 = 0x0010;
    // NtQueryInformationProcess 的 ProcessCommandLineInformation 信息类
    const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;
    // 缓冲区不足时返回的 NTSTATUS（按 return_length 扩容重试）
    const STATUS_BUFFER_OVERFLOW: i32 = 0x8000_0005u32 as i32;
    const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC000_0004u32 as i32;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *mut u16,
    }

    unsafe extern "system" {
        fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> isize;
        fn Process32FirstW(h_snapshot: isize, lppe: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(h_snapshot: isize, lppe: *mut ProcessEntry32W) -> i32;
        fn CloseHandle(h_object: isize) -> i32;
        fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> isize;
        fn ReadProcessMemory(
            h_process: isize,
            lp_base_address: *const c_void,
            lp_buffer: *mut c_void,
            n_size: usize,
            lp_number_of_bytes_read: *mut usize,
        ) -> i32;
        fn NtQueryInformationProcess(
            process_handle: isize,
            process_information_class: u32,
            process_information: *mut c_void,
            process_information_length: u32,
            return_length: *mut u32,
        ) -> i32;
    }

    /// 读取进程命令行。NtQueryInformationProcess 返回的 UNICODE_STRING 的 Buffer
    /// 可能指向输出缓冲区内的字符串数据，也可能指向目标进程内存，两者都处理。
    fn read_command_line(handle: isize) -> Option<String> {
        let mut needed: u32 = 0;
        let mut buf: Vec<u8> = vec![0u8; 1024];
        loop {
            let status = unsafe {
                NtQueryInformationProcess(
                    handle,
                    PROCESS_COMMAND_LINE_INFORMATION,
                    buf.as_mut_ptr() as *mut c_void,
                    buf.len() as u32,
                    &mut needed,
                )
            };
            if status == 0 {
                break;
            }
            if status == STATUS_BUFFER_OVERFLOW || status == STATUS_INFO_LENGTH_MISMATCH {
                let next = needed.max(buf.len() as u32 * 2) as usize;
                if next <= buf.len() || next > 1 << 20 {
                    return None;
                }
                buf.resize(next, 0);
                continue;
            }
            return None;
        }

        if buf.len() < size_of::<UnicodeString>() {
            return None;
        }
        let us = unsafe { &*(buf.as_ptr() as *const UnicodeString) };
        let byte_len = us.length as usize;
        if byte_len == 0 || byte_len > 128 * 1024 {
            return None;
        }

        let to_string = |raw: &[u8]| -> String {
            let units: Vec<u16> = raw
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        };

        let base = buf.as_ptr() as usize;
        let ptr = us.buffer as usize;
        // 字符串数据随 UNICODE_STRING 头一起拷入输出缓冲区
        if ptr >= base && ptr + byte_len <= base + buf.len() {
            let start = ptr - base;
            return Some(to_string(&buf[start..start + byte_len]));
        }
        // 否则 Buffer 指向目标进程内存，需 ReadProcessMemory
        let mut raw = vec![0u8; byte_len];
        let mut read = 0usize;
        let ok = unsafe {
            ReadProcessMemory(
                handle,
                ptr as *const c_void,
                raw.as_mut_ptr() as *mut c_void,
                byte_len,
                &mut read,
            )
        };
        if ok == 0 || read == 0 {
            return None;
        }
        Some(to_string(&raw[..read]))
    }

    let mut result: Vec<(String, String)> = Vec::new();
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == -1 {
        return result;
    }

    let mut entry: ProcessEntry32W = unsafe { std::mem::zeroed() };
    entry.dw_size = size_of::<ProcessEntry32W>() as u32;

    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        let exe = String::from_utf16_lossy(&entry.sz_exe_file);
        let exe = exe.split('\0').next().unwrap_or("").to_string();
        if exe_names.iter().any(|t| exe.eq_ignore_ascii_case(t)) {
            let handle = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                    0,
                    entry.th32_process_id,
                )
            };
            if handle != 0 {
                if let Some(cmd) = read_command_line(handle) {
                    result.push((exe, cmd));
                }
                unsafe { CloseHandle(handle) };
            }
        }
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    result
}

/// 非 Windows 环境回退：不启动子进程枚举，直接返回空（本工具面向 Windows 浏览器自动化）。
#[cfg(not(windows))]
fn scan_running_processes_native(_exe_names: &[&str]) -> Vec<(String, String)> {
    Vec::new()
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
/// 返回每个 profile 是否正在运行，以及是否有调试端口。
///
/// 运行归属（running_kind）两档：
/// - own    ：命令行精确命中，该 profile 拥有独立主进程，可按 profile 精确关闭/调试
/// - shared ：与同目录其它 profile 共享同一主进程（单实例锁），无独立进程可杀；
///            用 RestartManager 探测该 profile 目录是否正被浏览器进程持有打开句柄
///            （已加载的 profile 会持续持有 History/Cookies 等 SQLite 句柄，未打开的不会）
pub fn detect_browser_running_processes(profiles: &[(String, String)]) -> Vec<BrowserProcessState> {
    // 收集所有运行中的浏览器进程（不论有无 --remote-debugging-port）
    let mut running_by_key: HashMap<String, Option<u16>> = HashMap::new();
    // 正在运行主进程的 user-data-dir 集合（小写），用于同目录多 profile 的兜底探测
    let mut running_dirs: HashSet<String> = HashSet::new();

    for exe_name in &["msedge.exe", "chrome.exe"] {
        let (instances, dirs) = scan_running_browser_instances_with_dirs(exe_name);
        for (key, port_opt) in instances {
            running_by_key.entry(key).or_insert(port_opt);
        }
        running_dirs.extend(dirs.into_iter().map(|d| d.to_lowercase()));
        // 默认目录实例（无 --user-data-dir 的主进程）存在时，视为默认目录「有浏览器进程在跑」。
        // 注意：这不等同于默认目录的 profile 已启动——是否启动仍由 RestartManager 逐 profile 探测，
        // 避免 Edge 后台进程（--no-startup-window）把默认目录所有 profile 误标为运行。
        if running_by_key.contains_key(&format!("{}#default-instance", exe_name)) {
            let bt = if *exe_name == "msedge.exe" { "edge" } else { "chrome" };
            if let Some(def) = get_user_data_dir(bt) {
                running_dirs.insert(def.to_lowercase());
            }
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
                running_kind: "own".to_string(),
                owner_profile_id: None,
            });
        } else if running_dirs.contains(&user_data_dir.to_lowercase()) {
            // 该目录已有浏览器主进程在运行，但该 profile 未精确命中命令行：
            // 可能是同目录多 profile 共享主进程（单实例锁），也可能是默认目录实例。
            // 用 RestartManager 逐 profile 精确探测其目录是否正被浏览器进程持有打开句柄，
            // 只有真的打开了（持有 SQLite 句柄）才标记为运行，避免目录级误报。
            let profile_path = std::path::Path::new(user_data_dir).join(profile_id);
            let in_use = profile_dir_in_use_by_browser(
                &profile_path.to_string_lossy(),
                &["msedge.exe", "chrome.exe"],
            );
            if in_use {
                // 该 profile 已加载：共享主进程的 owner profile 与调试端口
                let (owner, port) = find_dir_owner_and_port(&running_by_key, user_data_dir);
                let cdp_reachable = port.map_or(false, |p| check_cdp_reachable(p));
                result.push(BrowserProcessState {
                    user_data_dir: user_data_dir.clone(),
                    profile_id: profile_id.clone(),
                    is_running: true,
                    debug_port: port.map(|p| p.to_string()),
                    cdp_reachable,
                    running_kind: "shared".to_string(),
                    owner_profile_id: owner,
                });
            } else {
                result.push(BrowserProcessState {
                    user_data_dir: user_data_dir.clone(),
                    profile_id: profile_id.clone(),
                    is_running: false,
                    debug_port: None,
                    cdp_reachable: false,
                    running_kind: "own".to_string(),
                    owner_profile_id: None,
                });
            }
        } else {
            result.push(BrowserProcessState {
                user_data_dir: user_data_dir.clone(),
                profile_id: profile_id.clone(),
                is_running: false,
                debug_port: None,
                cdp_reachable: false,
                running_kind: "own".to_string(),
                owner_profile_id: None,
            });
        }
    }
    result
}

/// 从运行中的进程映射中找到 user_data_dir 对应的主进程 profile（owner）及其调试端口。
/// owner = 运行主进程命令行中的 --profile-directory（running_by_key 中以 `{dir}\` 开头的
/// key 的 profile 部分）；端口同理取该目录主进程的 --remote-debugging-port。
fn find_dir_owner_and_port(
    running_by_key: &HashMap<String, Option<u16>>,
    user_data_dir: &str,
) -> (Option<String>, Option<u16>) {
    let prefix = format!("{}\\", user_data_dir).to_lowercase();
    let mut owner: Option<String> = None;
    let mut port: Option<u16> = None;
    for (k, p) in running_by_key.iter() {
        if !k.to_lowercase().starts_with(&prefix) {
            continue;
        }
        if owner.is_none() {
            owner = k.rsplit('\\').next().map(|s| s.to_string());
        }
        if port.is_none() {
            port = *p;
        }
        if owner.is_some() && port.is_some() {
            break;
        }
    }
    (owner, port)
}

/// 通过 Windows RestartManager 探测 profile 目录是否正被浏览器进程持有打开句柄。
/// 已加载的 profile 会持续持有其 SQLite 数据库（History/Cookies/Login Data 等）的句柄，
/// 未打开过的 profile 不会有任何句柄被持有 —— 因此可作为同目录多 profile 场景下
/// 「该 profile 的窗口/会话是否真的在跑」的精确信号。
/// 返回 true = 该 profile 已加载（正在运行）。
#[cfg(windows)]
fn profile_dir_in_use_by_browser(profile_dir: &str, exe_names: &[&str]) -> bool {
    use std::ptr;

    const CCH_RM_SESSION_KEY: usize = 256;
    const ERROR_SUCCESS: i32 = 0;
    const ERROR_MORE_DATA: i32 = 234;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct FileTime {
        dw_low_date_time: u32,
        dw_high_date_time: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct RmUniqueProcess {
        dw_process_id: u32,
        process_start_time: FileTime,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct RmProcessInfo {
        process: RmUniqueProcess,
        str_app_name: [u16; 256],
        str_service_short_name: [u16; 64],
        application_type: u32,
        app_status: u32,
        ts_session_id: u32,
        b_restartable: i32,
    }

    unsafe extern "system" {
        fn RmStartSession(
            p_session_handle: *mut u32,
            dw_reserved: i32,
            str_session_key: *mut u16,
        ) -> i32;
        fn RmEndSession(dw_session_handle: u32) -> i32;
        fn RmRegisterResources(
            dw_session_handle: u32,
            n_files: u32,
            rgs_filenames: *const *mut u16,
            n_applications: u32,
            rg_applications: *const RmUniqueProcess,
            n_services: u32,
            rgs_service_names: *const *mut u16,
        ) -> i32;
        fn RmGetList(
            dw_session_handle: u32,
            pn_proc_info_needed: *mut u32,
            pn_proc_info: *mut u32,
            rg_affected_apps: *mut RmProcessInfo,
            lpdw_reboot_reasons: *mut u32,
        ) -> i32;
    }

    // profile 加载期间浏览器持续持有的关键数据库文件（只注册存在的）
    let candidates = [
        "History",
        "Login Data",
        "Web Data",
        "Preferences",
        "Network\\Cookies",
    ];
    let mut files: Vec<String> = Vec::new();
    for name in candidates {
        let p = std::path::Path::new(profile_dir).join(name);
        if p.exists() {
            files.push(p.to_string_lossy().to_string());
        }
    }
    if files.is_empty() {
        return false;
    }

    // session key 缓冲区需为 CCH_RM_SESSION_KEY+1 个字符，由 RestartManager 回填生成
    let mut session_key = vec![0u16; CCH_RM_SESSION_KEY + 1];
    let mut session_handle = 0u32;
    let start_status = unsafe { RmStartSession(&mut session_handle, 0, session_key.as_mut_ptr()) };
    if start_status != ERROR_SUCCESS {
        return false;
    }

    let mut wide_files: Vec<Vec<u16>> = files
        .iter()
        .map(|f| {
            let mut w: Vec<u16> = f.encode_utf16().collect();
            w.push(0);
            w
        })
        .collect();
    let file_ptrs: Vec<*mut u16> = wide_files.iter_mut().map(|w| w.as_mut_ptr()).collect();

    let _ = unsafe {
        RmRegisterResources(
            session_handle,
            file_ptrs.len() as u32,
            file_ptrs.as_ptr(),
            0,
            ptr::null(),
            0,
            ptr::null(),
        )
    };

    let mut needed = 0u32;
    let mut count = 0u32;
    let mut reboot_reasons = 0u32;
    let mut in_use = false;

    let status = unsafe {
        RmGetList(session_handle, &mut needed, &mut count, ptr::null_mut(), &mut reboot_reasons)
    };
    if status == ERROR_MORE_DATA || (status == ERROR_SUCCESS && needed > 0) {
        // 只注册了少量文件，占用进程数有限；仍设上限防御异常返回
        count = needed.min(64);
        let mut infos: Vec<RmProcessInfo> = (0..count as usize)
            .map(|_| unsafe { std::mem::zeroed::<RmProcessInfo>() })
            .collect();
        let status2 = unsafe {
            RmGetList(
                session_handle,
                &mut needed,
                &mut count,
                infos.as_mut_ptr(),
                &mut reboot_reasons,
            )
        };
        if status2 == ERROR_SUCCESS {
            for info in &infos {
                if info.process.dw_process_id == 0 {
                    continue;
                }
                let name = &info.str_app_name;
                let end = name.iter().position(|&c| c == 0).unwrap_or(name.len());
                let app_name = String::from_utf16_lossy(&name[..end]).to_lowercase();
                // RM 的 strAppName 返回的是显示名（如 "microsoft edge"/"google chrome"），
                // 也可能是 exe 路径；按浏览器特征匹配，排除索引器等非浏览器进程
                let is_browser = app_name.contains("microsoft edge")
                    || app_name.contains("google chrome")
                    || exe_names.iter().any(|e| app_name.contains(&e.to_lowercase()));
                if is_browser {
                    in_use = true;
                    break;
                }
            }
        }
    }

    unsafe { RmEndSession(session_handle) };
    in_use
}

#[cfg(not(windows))]
fn profile_dir_in_use_by_browser(_profile_dir: &str, _exe_names: &[&str]) -> bool {
    false
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
    // 本机回环：端口开/拒都是即时返回，超时仅是兜底。1500ms 过大会让
    // 异常端口（如假死进程占用）在同步检测路径上阻塞过久 → 降到 300ms。
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// 扫描正在运行的浏览器进程，返回 (key, Option<debug_port>)
/// 与 scan_running_browser_instances 不同，此函数不要求必须有 --remote-debugging-port
pub fn scan_running_browser_processes(exe_name: &str) -> HashMap<String, Option<u16>> {
    let mut result: HashMap<String, Option<u16>> = HashMap::new();
    for (exe, cmd_line) in scan_running_processes_native(&[exe_name]) {
        extract_instance_from_cmdline(&cmd_line, &exe, &mut result);
    }
    result
}

/// 扫描运行中的浏览器进程，返回 (profile key → port) 与「运行中主进程的 user-data-dir 列表」。
/// 与 scan_running_browser_processes 的区别：额外收集主进程（非 --type= 子进程）使用的
/// user-data-dir，供同目录多 profile 场景做目录级兜底探测。主进程可能不带
/// --profile-directory（此时 extract_instance_from_cmdline 会丢弃），但目录本身在运行。
///
/// 注意：`--no-startup-window` 后台进程（如 Edge 开机自启 / 关闭所有窗口后的驻留进程）
/// 没有可见窗口，不属于「浏览器已启动」，直接跳过，避免把其预加载的 profile 误判为运行。
fn scan_running_browser_instances_with_dirs(
    exe_name: &str,
) -> (HashMap<String, Option<u16>>, Vec<String>) {
    let mut instances: HashMap<String, Option<u16>> = HashMap::new();
    let mut dirs: Vec<String> = Vec::new();
    for (exe, cmd_line) in scan_running_processes_native(&[exe_name]) {
        let args = cmd_args(&cmd_line);
        let is_child = args.iter().any(|a| a.starts_with("--type="));
        if !is_child && args.iter().any(|a| a.starts_with("--no-startup-window")) {
            continue;
        }
        extract_instance_from_cmdline(&cmd_line, &exe, &mut instances);
        if !is_child {
            if let Some(ud) = extract_cmd_arg(&cmd_line, "--user-data-dir") {
                dirs.push(ud);
            }
        }
    }
    (instances, dirs)
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
    // 只检查主浏览器进程：同时包含 --remote-debugging-port=<port>
    // 子进程（GPU、渲染器等）没有 --remote-debugging-port，不会被误匹配
    for (_exe, cmd_line) in scan_running_processes_native(&[exe_name]) {
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


/// 浏览器进程运行状态
#[derive(Debug, Clone, Serialize)]
pub struct BrowserProcessState {
    pub user_data_dir: String,
    pub profile_id: String,
    pub is_running: bool,
    pub debug_port: Option<String>,
    /// CDP 是否可达（后端 TCP 直连检测，绕过浏览器 CORS 限制）
    pub cdp_reachable: bool,
    /// 运行归属：own = 该 profile 拥有独立主进程（可按 profile 精确关闭/调试）；
    /// shared = 与同目录其它 profile 共享同一主进程（单实例锁），无独立进程可杀
    pub running_kind: String,
    /// shared 时共享主进程对应的 profile id（用于按主进程执行关闭/调试启动），own 时为 None
    pub owner_profile_id: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 原生枚举端到端校验：当前测试进程必然在运行，
    /// 快照 + OpenProcess + NtQueryInformationProcess + ReadProcessMemory 全链路必须命中自己。
    #[test]
    #[cfg(windows)]
    fn native_scan_reads_own_command_line() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_string_lossy().to_string();
        let rows = scan_running_processes_native(&[&name]);
        assert!(!rows.is_empty(), "native scan should find running test process: {name}");
        let exe_lower = exe.to_string_lossy().to_lowercase();
        let hit = rows.iter().any(|(_, cmd)| cmd.to_lowercase().contains(&exe_lower));
        assert!(hit, "native scan should read own command line, got {} row(s)", rows.len());
    }
}
