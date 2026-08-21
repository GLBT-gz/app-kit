// 海多客平台 API —— 公共层
//
// 平台测试/基础功能命令封装：所有用到海多客的项目共享同一套前端 API。
// 命令为裸名（tauriInvoke），由各项目 Rust 侧注册同名命令。
// 命令名与使用项目见 components/platform-test/registry.ts（平台测试注册表）。
//
// 统一契约（对齐 006/007 现有实现）：
//   - 浏览器参数直接传（exePath/profileId/userDataDir）
//   - phone/password 可选（各项目前端从自己的凭证存储读取后传入）
//   - 命令返回分步日志字符串（前端按行输出到日志栏）
//   - 实时进度经事件 haiduoke-test-progress 推送（{ message, level }）

import { tauriInvoke } from "./tauri-utils";

/** 浏览器参数（公共骨架与项目私有分节共用） */
export interface HaiduokeBrowserOpts {
  exePath: string;
  profileId: string;
  userDataDir: string;
}

/** invoke 参数需可索引（Record<string, unknown>），用交叉类型补 index signature */
type InvokeArgs<T> = T & Record<string, unknown>;

/** 打开海多客 → 检测登录状态 → 未登录自动登录（已保存账密可选，不传则手动登录） */
export function testHaiduokeOpenLogin(
  opts: InvokeArgs<HaiduokeBrowserOpts & { phone?: string; password?: string }>,
): Promise<string> {
  return tauriInvoke<string>("test_haiduoke_open_login", opts);
}
