/**
 * @responsibility
 * 前端镜像 `shared/core/src/nas_release.rs::APP_ID_MAP` —— 把历史短名 app_id
 * 映射到 NAS 实际目录名. AboutPanel 显示 + 打开按钮都用映射后的目录名,
 * 避免 d7f2788 引入的"前端必须传完整目录名"约束在 17 个 fork 项目上全部失效
 * (见 module-level-docs entries of `nas_release.rs`).
 *
 * @hard-rules
 * - **与 Rust APP_ID_MAP 1:1 同步**: 加/删 fork 项目时, Rust 端先改, 本文件后改.
 * - **fallback**: 不在表中 → 原样返回 (假设调用方已传完整名).
 * - **业务耦合**: NAS 路径是 GLBT 业务专有; 本约束是 d7f2788 历史事实的工程补救,
 *   不引入新业务概念, 仅补全映射.
 *
 * @接口清单
 * - `APP_ID_MAP: ReadonlyArray<readonly [string, string]>` 短名 → 完整目录名
 * - `appIdToDir(appId: string): string` 未命中时原样返回
 * - `nasBaseDir: string` GLBT 发行包 NAS 共享根路径 (单反斜杠 UNC,
 *   Windows API 对 `\\`/`\` 头都接受, 这里用标准 UNC 形式)
 *
 * @状态
 * 2026-09-24: 镜像 nas_release.rs::APP_ID_MAP (17 条); 用于 AboutPanel
 * "更新来源"行的显示 + 打开按钮.
 */

/** GLBT 发行包 NAS 共享路径根 (公司内网 SMB UNC, 单反斜杠形式). */
export const nasBaseDir = "\\Nas2025\\Rpa数据\\#软件发行";

/**
 * 历史短名 (Rust 端 `const APP_ID`) → NAS 目录名 (`000-template` / `016-auto-withdraw` 等).
 * 与 `shared/core/src/nas_release.rs::APP_ID_MAP` 保持同步.
 */
export const APP_ID_MAP: ReadonlyArray<readonly [string, string]> = [
  ["template", "000-template"],
  ["dxm-purchase", "001-dxm-purchase"],
  ["temu-ops", "002-temu-ops"],
  ["reorder-stock", "003-reorder-stock"],
  ["dxm-cost", "004-dxm-cost"],
  ["profit-calc", "005-profit-calc"],
  ["excel-ops", "005-excel-ops"],
  ["overseas-stock-sync", "006-overseas-stock-sync"],
  ["product-listing", "010-product-listing"],
  ["inventory-turnover", "007-inventory-turnover"],
  ["ziniao-ops", "008-ziniao-ops"],
  ["withdraw", "016-auto-withdraw"],
  ["software-manager", "900-software-manager"],
  ["agent", "999-agent"],
];

/** 历史短名 → NAS 目录名; 未命中时原样返回 (假设调用方已传完整目录名). */
export function appIdToDir(appId: string): string {
  const hit = APP_ID_MAP.find(([short]) => short === appId);
  return hit ? hit[1] : appId;
}