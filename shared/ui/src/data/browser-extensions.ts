// ============================================================
//  浏览器类型 UI 扩展注册表
//
//  app-kit 保持中性：不内置任何具体浏览器平台的知识。
//  由外部主程序托管的浏览器类型（其 profile/环境由主程序管理、需要额外配置卡片、
//  支持已开窗口快速激活等），由业务侧注册扩展后，框架按类型查表渲染与调度。
//
//  与 data/browser-ops.ts 的分工：
//    - browser-ops     负责「启停/调试启动」的行为适配
//    - 本文件           负责「UI 呈现与交互能力」的扩展
//
//  使用方式（业务侧应用入口调用一次）：
//    registerBrowserUIExtension({ browserType: "xxx", ... })
// ============================================================

import type { ReactNode } from "react";

/** 浏览器类型 UI 扩展定义 */
export interface BrowserUIExtension {
  /** 浏览器类型标识（对应 BCPBrowser.browser_type） */
  browserType: string;

  /**
   * profile/环境由主程序管理。
   * true 时：跳过「显示目录」筛选（环境目录直接作为 profile 一卡展示）、
   * 不提供手动新增用户目录与目录管理入口。
   */
  managesOwnProfiles?: boolean;

  /** 禁止手动新增 profile 时的提示文案 */
  addProfileDisabledHint?: string;

  /**
   * 已打开环境的快速激活（CDP Page.bringToFront，毫秒级）。
   * 返回 true 表示已成功激活、调用方无需再走完整启动链；
   * 返回 false 或抛错则回退完整启动。
   */
  quickActivate?: (port: number) => Promise<boolean>;

  /**
   * 主程序运行状态。进程扫描抓不到主程序时（如由服务探测）提供此项。
   * 需为 React Hook 语义（在组件渲染期调用）。
   */
  useMainStatus?: () => { running: boolean };

  /** 该 profile 是否为「主程序入口」卡片（锁定不可勾选，状态取 useMainStatus） */
  isMainEntry?: (profileId: string) => boolean;

  /**
   * 配置面板附加卡片（如补丁状态、登录绑定入口）。
   * 在浏览器配置面板底部渲染；需为 React Hook 语义。
   */
  useConfigPanelExtras?: (ctx: BrowserUIExtensionCtx) => ReactNode;

  /**
   * 配置面板操作区附加按钮（渲染在「新增用户」等按钮之前）。
   * 需为 React Hook 语义。
   */
  useConfigPanelActions?: (ctx: BrowserUIExtensionCtx) => ReactNode;

  /** 平台选择器排序权重（内置 edge/chrome 固定为 0/1；未注册类型排最后） */
  sortOrder?: number;

  /**
   * 子窗口（店铺/环境窗口）列表展示文案。
   * 提供后框架才会在浏览器配置面板渲染子窗口列表区。
   */
  childWindows?: {
    /** 区块标题（渲染时自动拼接数量） */
    title: string;
    /** 卡片角标文案 */
    badge: string;
    /** 头像占位字符 */
    avatarChar: string;
  };

  /** 配置面板是否展示「配置目录（店铺/环境 Profiles 路径）」只读块 */
  showProfilesDir?: boolean;
}

/** 附加卡片可用的宿主上下文 */
export interface BrowserUIExtensionCtx {
  /** 宿主提供的 toast */
  showToast: (msg: string, level?: "info" | "warning" | "success" | "error") => void;
  /** 触发宿主重新检测浏览器/profile 列表 */
  refresh: () => void | Promise<void>;
}

const extensions = new Map<string, BrowserUIExtension>();

/** 注册浏览器类型 UI 扩展（同类型重复注册以后者为准） */
export function registerBrowserUIExtension(ext: BrowserUIExtension): void {
  extensions.set(ext.browserType, ext);
}

/** 取某浏览器类型的 UI 扩展（未注册返回 undefined） */
export function getBrowserUIExtension(browserType: string): BrowserUIExtension | undefined {
  return extensions.get(browserType);
}

/** 该浏览器类型的 profile 是否由主程序管理 */
export function managesOwnProfiles(browserType: string): boolean {
  return extensions.get(browserType)?.managesOwnProfiles === true;
}

/**
 * 所有已注册扩展的主程序运行状态（key = browserType）。
 *
 * Hook 调用顺序稳定性：扩展注册在应用入口一次性完成（首次渲染前），
 * 此后 Map 不再增删，故按插入顺序遍历调用 useMainStatus 满足 Hook 规则。
 */
export function useBrowserMainStatuses(): Record<string, { running: boolean }> {
  const result: Record<string, { running: boolean }> = {};
  for (const ext of extensions.values()) {
    if (ext.useMainStatus) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      result[ext.browserType] = ext.useMainStatus();
    }
  }
  return result;
}
