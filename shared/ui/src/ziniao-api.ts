// 紫鸟自动化 API（v10.8/v10.9 patch 依赖）
//
// 与通用 api.ts 分离：紫鸟是具体业务平台，其命令封装独立成模块，
// 保持 app-kit 的 api.ts 为「中性框架层」。index.ts 统一 re-export。

import { isTauriRuntime, tauriRuntimeError, tauriInvoke } from "./tauri-utils";

// ── 紫鸟 app.asar patch（自动化集成配置） ──

/** 检测紫鸟 app.asar 补丁状态（v10.8 端口兜底 + v10.9 agent_mode 自动开启） */
export async function ziniaoPatchStatus(): Promise<{
  installed: boolean;
  asar_path: string;
  patched: boolean;
  v109: boolean;
  main_index_len: number;
  detail: string;
}> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_patch_status");
  return tauriInvoke("ziniao_patch_status");
}

/** 一键打补丁（重打包 + 提权覆盖，会弹 UAC；未打或 v10.8 → 升级 v10.9） */
export async function ziniaoPatchApply(): Promise<string> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_patch_apply");
  return tauriInvoke("ziniao_patch_apply");
}

// ── 紫鸟 CDP 批量管理（需 v10.8 patch，多环境独立端口） ──

/** 紫鸟标签页 */
export interface ZiniaoTab {
  id: string;
  title: string;
  url: string;
}

/** 紫鸟环境实时状态 */
export interface ZiniaoEnvStatus {
  container_id: string;
  port: number;
  user_data_dir: string;
  pid: number;
  browser: string;
  tabs: ZiniaoTab[];
}

/** 批量执行 JS 的单条结果 */
export interface ZiniaoEvalResult {
  port: number;
  container_id: string;
  value: unknown;
}

/** 列出所有运行中紫鸟环境（含标签页） */
export async function ziniaoListEnvs(): Promise<ZiniaoEnvStatus[]> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_list_envs");
  return tauriInvoke("ziniao_list_envs");
}

/** 列出指定端口环境的标签页 */
export async function ziniaoListTabs(port: number): Promise<ZiniaoTab[]> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_list_tabs");
  return tauriInvoke("ziniao_list_tabs", { port });
}

/** 在指定环境新建标签页并导航 */
export async function ziniaoOpenTab(port: number, url: string): Promise<string> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_open_tab");
  return tauriInvoke("ziniao_open_tab", { port, url });
}

/** 指定环境第一个页面标签页导航 */
export async function ziniaoNavigate(port: number, url: string): Promise<void> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_navigate");
  return tauriInvoke("ziniao_navigate", { port, url });
}

/** 激活指定环境页面（窗口置前，Page.bringToFront） */
export async function ziniaoActivate(port: number): Promise<void> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_activate");
  return tauriInvoke("ziniao_activate", { port });
}

/** 指定环境执行 JS */
export async function ziniaoEval(port: number, js: string): Promise<unknown> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_eval");
  return tauriInvoke("ziniao_eval", { port, js });
}

/** 所有运行中环境批量执行 JS */
export async function ziniaoEvalAll(js: string): Promise<ZiniaoEvalResult[]> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_eval_all");
  return tauriInvoke("ziniao_eval_all", { js });
}

/** 指定环境截图，返回 PNG base64 */
export async function ziniaoScreenshot(port: number): Promise<string> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_screenshot");
  return tauriInvoke("ziniao_screenshot", { port });
}

// ── 紫鸟 agent_mode 直控（v10.9 patch，登录后自动开 HTTP 服务） ──

/** agent_mode 店铺信息 */
export interface ZiniaoAgentBrowser {
  browserOauth: string;
  browserId: number;
  browserName: string;
  browserIp: string;
  siteId: number;
  isExpired: boolean;
  proxyType: number;
  isDynamic: boolean;
  store_username: string;
  tags: unknown[];
  platform_id: number;
  platform_name: string;
}

/** agent_mode 主程序状态 */
export interface ZiniaoAgentStatus {
  running: boolean;
  port: number | null;
  pid: number | null;
}

/** 自动打开紫鸟主程序（未运行则启动） */
export async function ziniaoAgentLaunch(): Promise<{ launched: boolean; pid: number | null }> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_launch");
  return tauriInvoke("ziniao_agent_launch");
}

/** 主程序状态 + 动态发现的 agent_mode 端口（等待约 40s） */
export async function ziniaoAgentStatus(): Promise<ZiniaoAgentStatus> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_status");
  return tauriInvoke("ziniao_agent_status");
}

/** 主程序轻量状态：仅查进程是否运行（不探测 agent_mode 端口，O(1)） */
export async function ziniaoAgentProcStatus(): Promise<ZiniaoAgentStatus> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_proc_status");
  return tauriInvoke("ziniao_agent_proc_status");
}

/** 获取店铺列表（agent_mode 免认证） */
export async function ziniaoAgentBrowserList(port: number): Promise<ZiniaoAgentBrowser[]> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_browser_list");
  return tauriInvoke("ziniao_agent_browser_list", { port });
}

/** 直开指定店铺 */
export async function ziniaoAgentStartBrowser(port: number, browserId: number): Promise<unknown> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_start_browser");
  return tauriInvoke("ziniao_agent_start_browser", { port, browserId });
}

/** 店铺环境 CDP 端口（= 9222 + browserId % 5000） */
export async function ziniaoAgentCdpPort(browserId: number): Promise<number> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_cdp_port");
  return tauriInvoke("ziniao_agent_cdp_port", { browserId });
}

/** 运行中的环境 browserId 列表（官方 getRunningInfo，SUCCESS 状态） */
export async function ziniaoAgentRunning(port: number): Promise<number[]> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_running");
  return tauriInvoke("ziniao_agent_running", { port });
}

/** 关闭指定环境（CDP Browser.close，等价窗口关闭） */
export async function ziniaoAgentClose(browserId: number): Promise<void> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_close");
  return tauriInvoke("ziniao_agent_close", { browserId });
}
