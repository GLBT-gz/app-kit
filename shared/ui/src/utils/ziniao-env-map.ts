// ============================================================
//  紫鸟环境店铺名称映射（统一数据源）
//
//  紫鸟环境的静态检测只能得到容器目录 chrome_<containerId>（containerId == 紫鸟 browserId），
//  真实店铺名唯一的可靠来源是 agent 服务 getBrowserList（运行时 + 登录态）。
//
//  流程：用户在全局浏览器配置紫鸟面板点「登录并绑定店铺名称」→ 拉取 getBrowserList →
//  写入本映射（localStorage core-ziniao-env-map）→ refreshBrowserData 合并时对紫鸟
//  profiles 应用覆盖 name。未绑定前回退 Rust 端产出的「环境 {containerId}」。
//
//  所有消费方（全局配置卡片 / 当前配置卡片 / 平台选择器）从 browserStore 读取，自动获得真实店名。
//
//  注：店铺头像不再解析——紫鸟本地/接口均无真实店铺头像（browserIcon 为生成的彩色图标，
//  见踩坑记录 2026-08-28），店铺卡片统一走前端默认占位（首字母）。
// ============================================================

import type { BCPBrowser } from "../components/BrowserConfigPanel";
import { safeGetJSON, safeSetJSON } from "../localStorageKeys";

const LS_ZINIAO_ENV_MAP = "core-ziniao-env-map";

/** 单个环境的店铺信息（key = containerId / 紫鸟 browserId） */
export interface ZiniaoEnvInfo {
  name: string;
  platform_name?: string;
  store_username?: string;
}

/** containerId → 店铺信息 */
export type ZiniaoEnvMap = Record<string, ZiniaoEnvInfo>;

/** 读取映射（不存在返回空对象） */
export function getZiniaoEnvMap(): ZiniaoEnvMap {
  return safeGetJSON<ZiniaoEnvMap>(LS_ZINIAO_ENV_MAP) ?? {};
}

/** 整表覆盖写入 */
export function setZiniaoEnvMap(map: ZiniaoEnvMap): void {
  safeSetJSON(LS_ZINIAO_ENV_MAP, map);
}

/** 对紫鸟浏览器的 profiles 应用映射覆盖 name（按 id == containerId 匹配）；非紫鸟原样返回 */
export function applyZiniaoEnvNames(browser: BCPBrowser): BCPBrowser {
  if (browser.browser_type !== "ziniao" || !browser.profiles?.length) return browser;
  const map = getZiniaoEnvMap();
  const hasAny = browser.profiles.some(p => map[p.id]);
  if (!hasAny) return browser;
  return {
    ...browser,
    profiles: browser.profiles.map(p => {
      const info = map[p.id];
      if (!info) return p;
      return { ...p, name: info.name || p.name };
    }),
  };
}
