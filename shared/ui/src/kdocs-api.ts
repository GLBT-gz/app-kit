// 多维表格（kdocs，365.kdocs.cn）平台 API —— 公共层
//
// 平台测试/基础功能命令封装：所有用到多维表格的项目共享同一套前端 API。
// 命令为裸名（tauriInvoke），由各项目 Rust 侧注册同名命令。
// 命令名与使用项目见 components/platform-test/registry.ts（平台测试注册表）。
//
// 统一契约（对齐 007-库存周转的实现方式）：
//   - 浏览器参数直接传（exePath/profileId/userDataDir），命令内部自行保证浏览器就绪
//   - 实时进度经事件 kdocs-test-progress 推送（公共 KdocsTestPanel 顶层监听）
//   - 终止命令 cancel_kdocs（运行中的骨架模块可随时取消）

import { tauriInvoke } from "./tauri-utils";

// ── 浏览器参数 ──

export interface KdocsBrowserOpts {
  exePath: string;
  profileId: string;
  userDataDir: string;
}

/** invoke 参数需可索引（Record<string, unknown>），用交叉类型补 index signature */
type InvokeArgs<T> = T & Record<string, unknown>;

// ── 通用骨架命令（4 项） ──

/** 打开多维表格页面（验证页面可访问），返回步骤日志 */
export function testKdocsOpen(opts: InvokeArgs<KdocsBrowserOpts & { kdocsUrl: string }>): Promise<string> {
  return tauriInvoke<string>("test_kdocs_open", opts);
}

/** 解析多维表格侧边栏树（只读，自动展开全部路由），返回侧边栏树日志 */
export function testKdocsSidebar(opts: InvokeArgs<KdocsBrowserOpts & { kdocsUrl: string }>): Promise<string> {
  return tauriInvoke<string>("test_kdocs_sidebar", opts);
}

/** 解析脚本编辑器内的脚本列表（只读，供脚本下拉缓存） */
export function testKdocsParseScripts(opts: InvokeArgs<KdocsBrowserOpts & { kdocsUrl: string }>): Promise<string> {
  return tauriInvoke<string>("test_kdocs_parse_scripts", opts);
}

/** 运行脚本并读取运行日志（route 为 006 所需的左侧路由，007 可省略） */
export function testKdocsRunScript(
  opts: InvokeArgs<KdocsBrowserOpts & { kdocsUrl: string; scriptName: string; route?: string; maxWait?: number }>,
): Promise<string> {
  return tauriInvoke<string>("test_kdocs_run_script", opts);
}

/** 终止当前多维表格自动化（打开/侧边栏/脚本列表/运行脚本） */
export function cancelKdocs(): Promise<string> {
  return tauriInvoke<string>("cancel_kdocs");
}
