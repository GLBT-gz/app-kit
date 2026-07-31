// ============================================================
// ESLint 配置 — 继承共享配置
//
// 运行：npx eslint src/
//
// 共享配置规则：
// - 禁止直接调用 localStorage（必须使用 @glbt/ui 的 useData / defineDataStore）
// - 禁止访问 Storage.prototype
// ============================================================

import sharedConfig from "../../shared/eslint.config.mjs";

export default [
  ...sharedConfig,
  {
    // 项目特定的规则可在此追加
  },
];
