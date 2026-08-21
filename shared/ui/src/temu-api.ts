// Temu 平台 API —— 公共层
//
// 平台测试/基础功能命令封装：所有用到 Temu 的项目共享同一套前端 API。
// 命令为裸名（tauriInvoke），由各项目 Rust 侧注册同名命令。
// 命令名与使用项目见 components/platform-test/registry.ts（平台测试注册表）。
//
// 统一契约（对齐 003-返单备货量自动化的实现方式）：
//   - 浏览器参数直接传（exePath/browserType/profileId/userDataDir），命令内部自行保证浏览器就绪
//   - platform: "gz"（广州）| "hk"（香港），对应 platformSelections 的 temu-gz / temu-hk key
//   - 各命令返回分步日志字符串（前端按行输出到日志栏）

import { tauriInvoke } from "./tauri-utils";

/** 浏览器参数（公共骨架与项目私有分节共用） */
export interface TemuBrowserOpts {
  exePath: string;
  browserType: string;
  profileId: string;
  userDataDir: string;
}

/** invoke 参数需可索引（Record<string, unknown>），用交叉类型补 index signature */
type InvokeArgs<T> = T & Record<string, unknown>;

export type TemuPlatform = "gz" | "hk";

/** 缓存的 Temu 店铺（各命令写入的 load_cached_shops 缓存） */
export interface TemuCachedShop {
  mall_id: string;
  mall_name: string;
  alias?: string;
}

/** 加载缓存的店铺列表（gz_shops / hk_shops） */
export function loadTemuCachedShops(): Promise<{ gz_shops: TemuCachedShop[]; hk_shops: TemuCachedShop[] }> {
  return tauriInvoke("load_cached_shops");
}

/** 打开 Temu → 检测登录状态 → 未登录自动登录（可视化/后台模式可选） */
export function testTemuAutoLogin(
  opts: InvokeArgs<TemuBrowserOpts & { platform: TemuPlatform; headless: boolean }>,
): Promise<string> {
  return tauriInvoke<string>("test_temu_auto_login", opts);
}

/** 登录 Temu → 关闭所有弹窗广告 */
export function testTemuClosePopups(
  opts: InvokeArgs<TemuBrowserOpts & { platform: TemuPlatform }>,
): Promise<string> {
  return tauriInvoke<string>("test_temu_close_popups", opts);
}

/** 自动登录 → 获取所有店铺列表 */
export function testTemuGetShops(
  opts: InvokeArgs<TemuBrowserOpts & { platform: TemuPlatform; headless: boolean }>,
): Promise<string> {
  return tauriInvoke<string>("test_temu_get_shops", opts);
}

/** 自动登录 → 切换到指定店铺（targetMallName 取 load_cached_shops 缓存） */
export function testTemuSwitchShop(
  opts: InvokeArgs<TemuBrowserOpts & { platform: TemuPlatform; targetMallName: string }>,
): Promise<string> {
  return tauriInvoke<string>("test_temu_switch_shop", opts);
}

/** 左侧路由导航（menu1 > menu2，预定义常用路由） */
export function testTemuNavigateMenu(
  opts: InvokeArgs<TemuBrowserOpts & { platform: TemuPlatform; menu1: string; menu2: string }>,
): Promise<string> {
  return tauriInvoke<string>("test_temu_navigate_menu", opts);
}
