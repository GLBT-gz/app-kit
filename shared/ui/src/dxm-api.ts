// 店小秘（dianxiaomi.com）平台 API —— 公共层
//
// 平台测试/基础功能命令封装：所有用到店小秘的项目共享同一套前端 API。
// 命令为裸名（tauriInvoke），由各项目 Rust 侧注册（如 010-产品上架已注册 dxm_* 命令）。
// 命令名与使用项目见 components/platform-test/registry.ts（平台测试注册表）。

import { tauriInvoke } from "./tauri-utils";

// ── 店小秘凭证 ──

export interface DxmCredentials {
  username: string;
  password: string;
}

/** 保存店小秘登录凭证（密码 AES 加密存储） */
export function saveDxmCredentials(creds: DxmCredentials) {
  return tauriInvoke("save_dxm_credentials", { creds });
}

/** 加载店小秘登录凭证 */
export function loadDxmCredentials(): Promise<DxmCredentials> {
  return tauriInvoke("load_dxm_credentials");
}

// ── 店小秘基础功能 ──

export interface DxmBrowserOpts {
  exePath: string;
  profileId: string;
  userDataDir: string;
  username?: string;
  password?: string;
}

/** invoke 参数需可索引（Record<string, unknown>），用交叉类型补 index signature */
type InvokeArgs<T> = T & Record<string, unknown>;

/** 启动/连接店小秘浏览器，返回 CDP 调试端口 */
export function ensureBrowserDianxiaomi(opts: InvokeArgs<Omit<DxmBrowserOpts, "username" | "password">>): Promise<number> {
  return tauriInvoke<number>("ensure_browser_dianxiaomi", opts);
}

/** 打开店小秘登录页并自动登录（含图形验证码弹窗） */
export function dxmLogin(opts: InvokeArgs<DxmBrowserOpts>): Promise<string> {
  return tauriInvoke<string>("dxm_login", opts);
}

/** 前往店小秘指定页面（未登录时自动登录）。page: commodity | tiktok_add | shopee_add | warehouse */
export function dxmOpenPage(opts: InvokeArgs<DxmBrowserOpts & { page: string }>): Promise<string> {
  return tauriInvoke<string>("dxm_open_page", opts);
}

/** 提交店小秘图形验证码（空串表示取消） */
export function dxmSubmitVerifyCode(code: string): Promise<void> {
  return tauriInvoke("dxm_submit_verify_code", { code });
}

/** 终止当前店小秘自动化（登录/前往页面，运行中可随时取消） */
export function cancelDxmAutomation(): Promise<string> {
  return tauriInvoke<string>("cancel_dxm_automation");
}

// ── 被控浏览器实时监控 ──

export interface DxmTabInfo {
  id: string;
  title: string;
  url: string;
}

/** 启动/连接被监控的浏览器（浏览器独立运行，返回调试端口） */
export function dxmMonitorStart(opts: Omit<DxmBrowserOpts, "username" | "password">): Promise<number> {
  return tauriInvoke<number>("dxm_monitor_start", opts);
}

/** 查询监控会话状态（返回调试端口；未连接返回 null） */
export function dxmMonitorStatus(): Promise<number | null> {
  return tauriInvoke<number | null>("dxm_monitor_status");
}

/** 仅探测已运行的被监控浏览器并恢复连接（不启动新实例）；未找到返回 null */
export function dxmMonitorReconnect(opts: Omit<DxmBrowserOpts, "username" | "password">): Promise<number | null> {
  return tauriInvoke<number | null>("dxm_monitor_reconnect", opts);
}

/** 获取被监控浏览器的全部标签页（实时反映浏览器中的增删） */
export function dxmListTabs(): Promise<DxmTabInfo[]> {
  return tauriInvoke<DxmTabInfo[]>("dxm_list_tabs");
}

/** 切换到指定标签页（浏览器窗口前台显示该页） */
export function dxmTabActivate(tabId: string): Promise<void> {
  return tauriInvoke("dxm_tab_activate", { tabId });
}

/** 关闭指定标签页 */
export function dxmTabClose(tabId: string): Promise<void> {
  return tauriInvoke("dxm_tab_close", { tabId });
}

/** 打开新标签页 */
export function dxmTabOpen(url: string): Promise<void> {
  return tauriInvoke("dxm_tab_open", { url });
}

/** 重命名指定标签页（修改页面 <title>，浏览器标签页标题同步更新） */
export function dxmTabRename(tabId: string, title: string): Promise<void> {
  return tauriInvoke("dxm_tab_rename", { tabId, title });
}
