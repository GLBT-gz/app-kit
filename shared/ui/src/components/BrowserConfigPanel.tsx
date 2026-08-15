// ============================================================
// BrowserConfigPanel - 浏览器配置面板
//
// 按职责拆分为子模块（对外导入路径 "../components/BrowserConfigPanel" 不变）：
//   - BrowserConfigPanel/types.ts         通用类型（BCPBrowser/BCPProfile/Props）
//   - BrowserConfigPanel/Panel.tsx        主组件（侧边栏 + 面板容器）
//   - BrowserConfigPanel/Item.tsx         单个浏览器配置项（React.memo 懒挂载包装）
//   - BrowserConfigPanel/Inner.tsx        浏览器配置详情（路径/目录/Profile 管理）
//   - BrowserConfigPanel/ProfileCard.tsx  用户配置卡片
//   - BrowserConfigPanel/ChildWindows.tsx 子浏览器窗口列表
//   - BrowserConfigPanel/ZiniaoPatchCard.tsx 紫鸟 CDP 补丁卡片
//   - BrowserConfigPanel/CommandModal.tsx 启动命令弹窗
//   - BrowserConfigPanel/NewUserModal.tsx 新增用户弹窗
//
// 本文件为桶文件：重导出各子模块公开面，保持与拆分前一致。
// ============================================================

import { BrowserConfigPanel } from "./BrowserConfigPanel/Panel";

export { BrowserConfigPanel };
export type { BrowserConfigPanelProps, BCPBrowser, BCPProfile } from "./BrowserConfigPanel/types";

export default BrowserConfigPanel;
