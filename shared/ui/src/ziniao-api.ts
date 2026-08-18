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
  /** v109 注入为旧版（启动后 33s 窗口，错过即永久失效），需重装为常驻版 */
  v109_stale: boolean;
  version: string;
  /** 架构类型：patch（v6.25.16 系需补丁）/ native（6.24.2 系原生支持） */
  arch: string;
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

/** 进入店铺：激活页面，若处于紫鸟账号检测扩展页则点击「打开账号」 */
export async function ziniaoEnterShop(port: number): Promise<string> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_enter_shop");
  return tauriInvoke("ziniao_enter_shop", { port });
}

/** 单轮自动进入检查结果（前端驱动轮询，每轮都有可见进度） */
export interface ZiniaoEnterPoll {
  /** 已进入店铺页（true 时 seller_url 有值），前端应停止轮询 */
  entered: boolean;
  seller_url: string | null;
  /** 检测到紫鸟扩展页（检测页候选）数量 */
  ext_pages: number;
  /** 本轮是否点击了「打开账号」 */
  clicked: boolean;
  /** 最后评估的页面 URL */
  last_url: string;
  /** 未进入时的原因提示（前端直接展示） */
  note: string;
}

/** 单轮自动进入检查（约 3-5s）：店铺页出现返回 entered=true，否则在目标店铺（name）
 * 的检测扩展页上点击「打开账号」（店铺名校验，防误点其他店铺） */
export async function ziniaoEnterShopPoll(port: number, name: string): Promise<ZiniaoEnterPoll> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_enter_shop_poll");
  return tauriInvoke("ziniao_enter_shop_poll", { port, name });
}

/** 指定环境执行 JS */
export async function ziniaoEval(port: number, js: string): Promise<unknown> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_eval");
  return tauriInvoke("ziniao_eval", { port, js });
}

/** 页面坐标 (x, y) 处真实鼠标左键点击（isTrusted=true，绕过商家后台 isTrusted 守卫） */
export async function ziniaoMouseClick(port: number, x: number, y: number): Promise<void> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_mouse_click");
  return tauriInvoke("ziniao_mouse_click", { port, x, y });
}

/** 当前聚焦元素真实键入文本（isTrusted=true，等价用户手动输入，触发原生 input 事件） */
export async function ziniaoInsertText(port: number, text: string): Promise<void> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_insert_text");
  return tauriInvoke("ziniao_insert_text", { port, text });
}

/** 当前聚焦元素派发真实按键（isTrusted=true；如 Enter 需 key="Enter" code="Enter" vk=13） */
export async function ziniaoKeyTap(port: number, key: string, code: string, vk: number): Promise<void> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_key_tap");
  return tauriInvoke("ziniao_key_tap", { port, key, code, vk });
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

// ── TikTok Shop 卖家中心左侧导航（站点知识在 Rust 平台层，一次命令） ──

/** 左侧导航菜单项 */
export interface ZiniaoSidebarItem {
  name: string;
  href: string;
  visible: boolean;
  selected: boolean;
  x: number;
  y: number;
  /** 顶层链接在 .p-menu-inner 中的子节点序号（分组内子项恒 0，仅顶层交错排序用） */
  pos?: number;
}

/** 可展开分组（订单/商品/物流…） */
export interface ZiniaoSidebarGroup {
  name: string;
  expanded: boolean;
  items: ZiniaoSidebarItem[];
  /** 分组在 .p-menu-inner 中的子节点序号（与顶层链接按此交错还原网页顺序） */
  pos?: number;
}

/** 左侧导航解析结果 */
export interface ZiniaoSidebarParse {
  ok: boolean;
  error: string | null;
  page_url: string;
  page_title: string;
  /** 解析时的 location.pathname + search */
  path: string;
  /** 顶层直达链接 */
  links: ZiniaoSidebarItem[];
  /** 可展开分组 */
  groups: ZiniaoSidebarGroup[];
  /** 全部菜单项（links + groups.items 合并） */
  items: ZiniaoSidebarItem[];
  /** 解析方式/失败原因说明 */
  note: string;
}

/** 菜单切换结果 */
export interface ZiniaoSwitchMenuResult {
  matched: boolean;
  /** precise-href / precise-name / semantic-href / semantic-name */
  matched_by: string;
  matched_name: string;
  matched_href: string;
  url_before: string;
  url_after: string;
  url_changed: boolean;
  note: string;
}

/** 解析 TikTok Shop 卖家中心左侧导航（精准优先、语义兜底） */
export async function ziniaoParseSidebar(port: number): Promise<ZiniaoSidebarParse> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_parse_sidebar");
  return tauriInvoke("ziniao_parse_sidebar", { port });
}

/** 切换左侧导航菜单（query 支持路由路径如 /order 或菜单文本如「订单」） */
export async function ziniaoSwitchMenu(port: number, query: string): Promise<ZiniaoSwitchMenuResult> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_switch_menu");
  return tauriInvoke("ziniao_switch_menu", { port, query });
}

/** 侧边栏检测/展开结果（compass 等路由折叠为图标模式时用） */
export interface ZiniaoSidebarExpandResult {
  port: number;
  /** 当前是否在 TikTok 卖家中心页（有 `.sidebar-root`） */
  on_seller: boolean;
  /** 展开前是否处于折叠态 */
  was_collapsed: boolean;
  width_before: number;
  width_after: number;
  note: string;
}

/** 检测并强制展开 TikTok 卖家中心左侧导航（返回展开前后宽度与折叠状态） */
export async function ziniaoSidebarExpand(port: number): Promise<ZiniaoSidebarExpandResult> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_sidebar_expand");
  return tauriInvoke("ziniao_sidebar_expand", { port });
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
  /** 未找到端口时的原因提示（后端填充；前端直接展示） */
  note: string;
}

/** 自动打开紫鸟主程序（未运行则启动） */
export async function ziniaoAgentLaunch(): Promise<{ launched: boolean; pid: number | null }> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_launch");
  return tauriInvoke("ziniao_agent_launch");
}

/** 强制停止所有紫鸟主进程（含子进程树）。用于装/重装补丁后自动重启加载新代码 */
export async function ziniaoAgentStop(): Promise<number> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_stop");
  return tauriInvoke("ziniao_agent_stop");
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

/** 官方关闭指定环境（agent_mode stopBrowser action，需端口；失败可回退 CDP close） */
export async function ziniaoAgentStopBrowser(port: number, browserId: number): Promise<unknown> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_stop_browser");
  return tauriInvoke("ziniao_agent_stop_browser", { port, browserId });
}

/** 关闭指定环境（CDP Browser.close，等价窗口关闭） */
export async function ziniaoAgentClose(browserId: number): Promise<void> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_agent_close");
  return tauriInvoke("ziniao_agent_close", { browserId });
}

// ── 达人寄样数据抓取（affiliate.tiktok.com 样品申请页） ──

/** 达人寄样数据行（达人 × 产品） */
export interface ZiniaoSampleRow {
  /** 达人ID（去 @） */
  creator_id: string;
  /** 达人昵称 */
  creator_name: string;
  product_id: string;
  product_title: string;
  sku_desc: string;
  /** 所属状态 tab id（0=全部 10=待审核 20=待发货 30=已发货 40=处理中 50=已完成 100=已取消） */
  status: number;
  /** 抓取时间（epoch 毫秒字符串） */
  fetch_time: string;
}

/** 单个状态 tab 的抓取结果 */
export interface ZiniaoTabFetchResult {
  tab: number;
  /** 该 tab 总申请数（接口 total_count 口径） */
  total: number;
  rows: ZiniaoSampleRow[];
  /** 抓取到的页数 */
  pages: number;
  note: string;
}

/** 样品申请页准备状态（前端轮询，登录等待） */
export interface ZiniaoSamplePrepare {
  /** 页面已就绪（可开始抓取） */
  ready: boolean;
  /** 需要用户手动登录 */
  need_login: boolean;
  url: string;
  note: string;
}

/** 达人寄样申请页 URL */
export const ZINIAO_SAMPLE_URL = "https://affiliate.tiktok.com/affiliate/sample/sample-request";

/** 状态 tab 定义（id + 显示名 + 是否默认勾选） */
export const ZINIAO_SAMPLE_TABS: { id: number; name: string; default?: boolean }[] = [
  { id: 0, name: "全部" },
  { id: 10, name: "待审核", default: true },
  { id: 20, name: "待发货", default: true },
  { id: 30, name: "已发货" },
  { id: 40, name: "处理中" },
  // 注意：已完成=100、已取消=50（实测页面 group/list 请求 postData.tab，与直觉相反，勿改回）
  { id: 100, name: "已完成" },
  { id: 50, name: "已取消" },
];

/** 准备样品申请页（幂等，可轮询；need_login 时提示用户手动登录） */
export async function ziniaoSamplePrepare(port: number): Promise<ZiniaoSamplePrepare> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_sample_prepare");
  return tauriInvoke("ziniao_sample_prepare", { port });
}

/** 抓取单个状态 tab 的全部数据（分页自动翻完） */
export async function ziniaoSampleFetchTab(port: number, tab: number): Promise<ZiniaoTabFetchResult> {
  if (!isTauriRuntime()) throw tauriRuntimeError("ziniao_sample_fetch_tab");
  return tauriInvoke("ziniao_sample_fetch_tab", { port, tab });
}

// ── 跨境店（affiliate.tiktokshopglobalselling.com，普通浏览器 Edge/Chrome） ──

/** 跨境店浏览器启动结果 */
export interface CrossStart {
  /** 该浏览器 CDP 调试端口（判登录轮询/抓取复用） */
  port: number;
  /** 配置名（profileId，即「以邮箱为单位」的账号名） */
  profile_name: string;
  /** 是否已登录（打开首页后即判定一次） */
  logged_in: boolean;
  url: string;
  note: string;
}

/** 跨境店登录状态（前端轮询用，幂等） */
export interface CrossLoginStatus {
  /** 已进入应用页（非登录页） */
  logged_in: boolean;
  /** 停在登录页，需用户手动登录 */
  need_login: boolean;
  url: string;
  note: string;
}

/** 跨境店首页 URL 前缀（shop_region 参数化，如 MY/VN/PH） */
export const CROSS_HOME_URL = "https://affiliate.tiktokshopglobalselling.com/platform/homepage?shop_region=";

/** 启动浏览器并打开跨境店首页（幂等：已有实例直连，不重复启动） */
export async function crossBrowserStart(profileKey: string, region: string): Promise<CrossStart> {
  if (!isTauriRuntime()) throw tauriRuntimeError("cross_browser_start");
  return tauriInvoke("cross_browser_start", { profileKey, region });
}

/** 检测登录状态（幂等，前端轮询直到 logged_in） */
export async function crossBrowserLoginCheck(port: number): Promise<CrossLoginStatus> {
  if (!isTauriRuntime()) throw tauriRuntimeError("cross_browser_login_check");
  return tauriInvoke("cross_browser_login_check", { port });
}

/** 关闭跨境店浏览器（Browser.close，等价窗口关闭） */
export async function crossBrowserClose(port: number): Promise<void> {
  if (!isTauriRuntime()) throw tauriRuntimeError("cross_browser_close");
  return tauriInvoke("cross_browser_close", { port });
}
