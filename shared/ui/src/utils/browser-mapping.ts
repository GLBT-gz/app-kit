// ============================================================
//  后端 BrowserInfo → 组件层 BCPBrowser 的统一映射
//
//  后端字段 browser_version 与组件层 version 历史上并存（见 types.ts），
//  所有后端检测结果在进入 store / 组件前必须经过 toBCPBrowser 归一化，
//  下游一律只消费 version 字段，禁止再出现 `as any` 补丁。
// ============================================================

import type { BrowserInfo } from "../types";
import type { BCPBrowser } from "../components/BrowserConfigPanel";

/** 后端检测结果 → 组件层统一结构（version 字段归一化） */
export function toBCPBrowser(info: BrowserInfo): BCPBrowser {
  return {
    ...info,
    version: info.browser_version,
  };
}
