/** 持久化配置 - 对应 Rust 端 AppConfig */
export interface AppConfig {
  /** 是否显示历史面板 */
  show_history?: boolean;
}

/** 主题配置 */
export interface ThemeConfig {
  dark_mode: boolean;
  accent_hue: number;
  always_on_top: boolean;
  /** 数据时间戳，用于双端同步。保存时可选（Rust 后端自动填充），加载时必有 */
  _ts?: number;
}

/** 全量应用数据（对应 Rust 端的 AppData，通过 get_all_data 一次 IPC 获取） */
export interface AppData {
  theme: ThemeConfig;
  config: AppConfig;
}

// ── 浏览器配置管理 ──

/** 浏览器安装检测结果 */
export interface BrowserInfo {
  browser_type: string;
  browser_name: string;
  browser_icon_base64: string;
  installed: boolean;
  exe_paths: string[];
  user_data_dirs: string[];
  default_user_data_dir: string;
  default_debug_port: number;
  browser_version: string;
  suggested_user_data_dirs: string[];
  profiles: ProfileInfo[];
  children?: ChildBrowserConfig[];
  [key: string]: unknown;
}

/** 浏览器用户配置（增强版） */
export interface ProfileInfo {
  id: string;
  name: string;
  user_name: string;
  email: string;
  path: string;
  user_data_dir: string;
  download_dir: string;
  avatar_base64: string;
  avatar_has_icon: boolean;
  [key: string]: unknown;
}

/** 启动命令信息 */
export interface LaunchInfo {
  exe_path: string;
  args: string[];
  command_line: string;
  debug_port: number;
}

/** 单个浏览器持久化配置 */
export interface BrowserConfig {
  enabled: boolean;
  exe_path: string | null;
  user_data_dirs: string[];
  /** 目录筛选器可见状态：当前展示哪些 user_data_dir 的 Profile */
  visible_dirs?: string[];
  profiles: ProfileEntry[];
  profile_ports?: Record<string, number>;
  children?: ChildBrowserConfig[];
}

/** 子浏览器实例（易得客店铺窗口等特殊浏览器使用） */
export interface ChildBrowserConfig {
  user_data_dir: string;
  name: string;
  proxy_ip: string | null;
  enabled: boolean;
}

/** Profile 条目 */
export interface ProfileEntry {
  id: string;
  name: string;
  user_data_dir: string;
  download_dir: string | null;
}

/** 端口配置条目 */
export interface PortEntry {
  user_data_dir: string;
  profile_id: string;
  port: string;
  /** 是否为真实运行的浏览器进程 */
  is_running: boolean;
}

/** 目录诊断结果 */
export interface DirDiagnostic {
  path: string;
  exists: boolean;
  local_state_exists: boolean;
  local_state_file_size: number;
  local_state_readable: boolean;
  has_info_cache: boolean;
  profile_count: number;
  profile_keys: string[];
  info_cache_keys: string[];
}

/** 浏览器进程运行状态 */
export interface BrowserProcessState {
  user_data_dir: string;
  profile_id: string;
  is_running: boolean;
  debug_port: string | null;
  /** CDP 是否可达（后端 TCP 直连检测，绕过浏览器 CORS 限制） */
  cdp_reachable: boolean;
  /**
   * 运行归属：own = 该配置拥有独立主进程（可按 profile 精确关闭/调试）；
   * shared = 与同目录其它配置共享同一主进程（单实例锁），无独立进程可杀
   */
  running_kind: "own" | "shared";
  /** shared 时共享主进程对应的 profile id（own 时为 null） */
  owner_profile_id: string | null;
  /**
   * 检测可信度（appkit-core 新增）：
   * - "exact"       = 命令行精确命中 / RM 句柄精确命中
   * - "heuristic"   = Local State mtime 兜底命中（Edge 默认目录典型场景）
   * - "unreachable" = 未找到任何运行证据
   * 未提供时视为 "exact"（向后兼容）
   */
  detection_confidence?: "exact" | "heuristic" | "unreachable";
}

/** 浏览器自动化测试参数（000 模板项目专用） */
export interface BrowserTestParams {
  browser_type: string;
  exe_path: string;
  profile_id: string;
  user_data_dir: string;
}

/** 浏览器自动化测试结果 */
export interface BrowserTestResult {
  browser_type: string;
  profile_id: string;
  profile_name: string;
  success: boolean;
  page_content_sample: string;
  error: string;
  debug_port: number;
  reused: boolean;
}
