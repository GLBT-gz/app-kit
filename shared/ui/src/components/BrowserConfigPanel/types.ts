import type { ChildBrowserConfig } from "../../types";

// ════════════════════════════════════════════
//  通用类型定义（兼容各项目的不同数据结构）
// ════════════════════════════════════════════

export interface BCPBrowser {
  browser_type: string;
  browser_name: string;
  browser_icon_base64?: string | null;
  exe_paths: string[];
  /** 000 用 browser_version, 001 用 version */
  version?: string;
  user_data_dirs: string[];
  profiles?: BCPProfile[];
  default_user_data_dir?: string;
  suggested_user_data_dirs?: string[];
  /** 子浏览器实例（易得客店铺窗口等） */
  children?: ChildBrowserConfig[];
}

export interface BCPProfile {
  id: string;
  name: string;
  user_data_dir: string;
  avatar_base64?: string | null;
  email?: string | null;
  download_dir?: string | null;
  user_name?: string;
  path?: string;
}

// ════════════════════════════════════════════
//  Props 接口
// ════════════════════════════════════════════

export interface BrowserConfigPanelProps {
  /** 浏览器列表 */
  browsers: BCPBrowser[];
  /** 当前选中的浏览器类型 */
  activeBrowserType: string | null;
  /** 选中浏览器变更回调 */
  onActiveBrowserTypeChange: (type: string | null) => void;

  /** 每个浏览器的可执行文件路径 */
  exePaths: Record<string, string>;
  onExePathsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;

  /** 每个浏览器的用户数据目录列表 */
  userDataDirs: Record<string, string[]>;
  onUserDataDirsChange: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;

  /** 浏览器的 Profile 可见目录筛选（可选） */
  visibleDirs?: Record<string, string[]>;
  onVisibleDirsChange?: (dirs: Record<string, string[]>) => void;

  /** Profile 检测结果回调（用于父组件持久化 profiles） */
  onProfilesChange?: (browserType: string, profiles: BCPProfile[]) => void;

  /** 可选的侧边栏初始宽度 */
  sidebarWidth?: number;

  // ── 后端操作回调（可选，不提供则相关功能自动隐藏） ──

  /** 路径有效性检查 */
  onCheckPath?: (path: string) => Promise<boolean>;
  /** 在资源管理器中打开目录 */
  onOpenDir?: (path: string) => Promise<string>;
  /** 打开文件选择对话框（返回选中路径） */
  onBrowseFile?: () => Promise<string | string[] | null>;
  /** 打开目录选择对话框（返回选中路径列表） */
  onBrowseDirectory?: () => Promise<string | string[] | null>;
  /** 检测浏览器配置文件 */
  onDetectProfiles?: (browserType: string, exePath: string | null, userDirs: string[]) => Promise<BCPBrowser>;
  /** 是否正在重新检测（全局浏览器检测中，侧边栏图标转圈） */
  refreshing?: boolean;
  /** 手动触发一次全量重新检测（提供时在侧边栏顶部显示「重新检测」按钮） */
  onRefreshAll?: () => void;
  /** 启动浏览器 Profile */
  onLaunchProfile?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<string>;
  /** 获取启动命令 */
  onGetLaunchCommand?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<{
    exe_path: string; args: string[]; command_line: string; debug_port: number;
  }>;
  /** 创建新的浏览器用户数据目录 */
  onCreateUserDataDir?: (browserType: string, parentDir: string, dirName: string) => Promise<string>;
  /** 创建桌面快捷方式 */
  onCreateShortcut?: (browserType: string, profileId: string, userDataDir: string, profileName: string, avatarPath: string, debugPort: number) => Promise<string>;
}

/** 单个浏览器配置项（BrowserConfigItem 的 props） */
export interface BrowserConfigItemProps {
  browser: BCPBrowser;
  isActive: boolean;
  exePath: string;
  onExePathsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  userDirs: string[];
  onUserDataDirsChange: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  onCheckPath?: (path: string) => Promise<boolean>;
  onOpenDir?: (path: string) => Promise<string>;
  onBrowseFile?: () => Promise<string | string[] | null>;
  onBrowseDirectory?: () => Promise<string | string[] | null>;
  onDetectProfiles?: (browserType: string, exePath: string | null, userDirs: string[]) => Promise<BCPBrowser>;
  onLaunchProfile?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<string>;
  onGetLaunchCommand?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<{
    exe_path: string; args: string[]; command_line: string; debug_port: number;
  }>;
  onCreateUserDataDir?: (browserType: string, parentDir: string, dirName: string) => Promise<string>;
  onCreateShortcut?: (browserType: string, profileId: string, userDataDir: string, profileName: string, avatarPath: string, debugPort: number) => Promise<string>;
  onProfilesChange?: (browserType: string, profiles: BCPProfile[]) => void;
}
