// ============================================================
//  紫鸟店铺名称同步（统一数据源写入口）
//
//  拉取 agent getBrowserList → 写入 core-ziniao-env-map → 触发 refreshBrowserData，
//  使 browserStore 的紫鸟 profiles 带上真实店名。全局浏览器配置面板的
// 「登录并绑定店铺名称」与各项目（008 等）的「解析店铺列表」共用本函数，
// 避免各自复制一份绑定逻辑。
// ============================================================

import { ziniaoAgentLaunch, ziniaoAgentStatus, ziniaoAgentBrowserList } from "../ziniao-api";
import { setZiniaoEnvMap, type ZiniaoEnvMap } from "../utils/ziniao-env-map";
import { refreshBrowserData } from "./browserStore";

/**
 * 同步紫鸟店铺名称并刷新浏览器数据。
 * @returns 绑定到的店铺数量
 */
export async function syncZiniaoShopNames(): Promise<number> {
  await ziniaoAgentLaunch();
  const st = await ziniaoAgentStatus();
  if (!st.running) throw new Error("紫鸟主程序未运行");
  if (!st.port) throw new Error(st.note || "未发现 agent 服务，请确认已登录紫鸟");

  const list = await ziniaoAgentBrowserList(st.port);
  const map: ZiniaoEnvMap = {};
  for (const s of list) {
    map[String(s.browserId)] = {
      name: s.browserName,
      platform_name: s.platform_name,
      store_username: s.store_username,
    };
  }
  setZiniaoEnvMap(map);
  refreshBrowserData(true);
  return list.length;
}
