// ============================================================
// appkit-template - 数据声明
//
// 所有数据项统一在此声明，DataManager 自动识别和管理。
// 任何存在于 localStorage 但未在此声明的 key，
// 都会在 DataManager 中显示为"未注册数据"——说明开发不规范。
// ============================================================

import { defineDataStore } from "@appkit/ui";

export const store = defineDataStore({
  version: "1.0.0",
  namespace: "appkit",
  categories: {
    ui: {
      label: "界面状态",
      onDelete: "allowed",
    },
    preference: {
      label: "用户偏好",
      onDelete: "warn",
    },
  },
  items: {
    /** 首页活动标签页 */
    "active-tab": {
      storage: "localStorage",
      category: "ui",
      desc: "首页当前选中的标签页",
      default: "home" as string,
    },
    /** 快捷短语列表（JSON 字符串） */
    "shortcuts": {
      storage: "localStorage",
      category: "preference",
      desc: "自定义快捷短语配置",
      default: JSON.stringify([
        { id: "1", abbreviation: "sj", replacement: "%yyyy%-%MM%-%dd% %HH%:%mm%:%ss%", enabled: true },
      ]) as string,
    },
  },
});
