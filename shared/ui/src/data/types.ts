// ============================================================
// 统一数据层核心类型定义
//
// 设计原则：
// 1. 一个注册入口：defineDataStore 覆盖三种存储后端
// 2. 子项目只声明，CRUD 由共享 hooks 统一提供
// 3. DataManager 从同一注册表读取结构，实现统一管理
// ============================================================

/** 存储后端 */
export type StorageBackend = "localStorage" | "file" | "db";

/** 删除行为 */
export type DeleteBehavior = "allowed" | "warn" | "blocked";

/** 分类定义 */
export interface DataCategoryDef {
  /** UI 上展示的分类名称 */
  label: string;
  /** 用户在 DataManager 删除此分类下的数据时的行为 */
  onDelete: DeleteBehavior;
}

/** 前端项定义（localStorage，可用 useData 读写） */
export interface FrontendItemDef<T = unknown> {
  storage: "localStorage";
  /** 所属分类，引用 categories 中的 key */
  category: string;
  /** 面向用户的描述文字 */
  desc: string;
  /** 默认值，也会用于推断类型 */
  default: T;
  /** 删除行为（覆盖 category.onDelete） */
  onDelete?: DeleteBehavior;
  /**
   * 匹配模式："exact" 精确匹配，"prefix" 前缀匹配（动态 key）。
   * 设为 "prefix" 表示以该 key 为前缀的所有 localStorage key 都被视为已注册。
   */
  matchMode?: "exact" | "prefix";
  /**
   * 字段级描述，仅对 JSON 对象/字典有效。
   * key 为字段名，value 为面向用户的中文解释。
   * 展开数据项时，每个字段旁边会显示对应的描述。
   */
  fieldDescriptions?: Record<string, string>;
}

/** 文件项定义（Rust 后端文件，供 DataManager 管理 + useFile 读写） */
export interface FileItemDef<T = unknown> {
  storage: "file";
  /** 所属分类 */
  category: string;
  /** 面向用户的描述文字 */
  desc: string;
  /** 默认值 */
  default?: T;
  /** 删除行为（覆盖 category.onDelete） */
  onDelete?: DeleteBehavior;
  /** 字段级描述 */
  fieldDescriptions?: Record<string, string>;
}

/** 数据库项定义（SQLite .db 文件，供 DataManager 管理） */
export interface DbItemDef {
  storage: "db";
  /** 所属分类 */
  category: string;
  /** 面向用户的描述文字 */
  desc: string;
  /** 删除行为（覆盖 category.onDelete） */
  onDelete?: DeleteBehavior;
  /**
   * 数据库文件名（不含路径）。
   * 不指定则默认使用声明 key 作为文件名。
   * 例如: key="reorder-stock", dbFile="reorder-stock.db"
   */
  dbFile?: string;
}

/** 统一的数据项定义 */
export type AnyItemDef = FrontendItemDef | FileItemDef | DbItemDef;

/** 完整的 store 声明 */
export interface DataStoreDef {
  /** Schema 版本号 */
  version: string;
  /**
   * 项目命名空间。
   * 设置后所有 item key 自动以 "{namespace}-" 为前缀写入 localStorage，
   * 不同项目用不同 namespace 避免 key 冲突。
   * 框架级 key（core-*）不受影响。
   */
  namespace?: string;
  /** 分类定义 */
  categories: Record<string, DataCategoryDef>;
  /** 数据项定义（前端项 + 后端文件项 + 数据库项） */
  items?: Record<string, AnyItemDef>;
  /** 文件项定义（便捷写法，filename = key，实际文件存于 app_data_dir） */
  files?: Record<string, FileItemDef>;
  /** 数据库项定义 */
  databases?: Record<string, DbItemDef>;
}

/** 前端项的类型安全引用（供 useData 使用） */
export interface DataKeyRef<T = unknown> {
  /** localStorage key */
  key: string;
  /** 默认值 */
  default: T;
  /** 所属分类 */
  category: string;
  /** 描述 */
  desc: string;
  /** 存储位置 */
  storage: StorageBackend;
  /** 字段级描述映射 */
  fieldDescriptions?: Record<string, string>;
}

/** 文件项的类型安全引用（供 useFile 使用） */
export interface FileKeyRef<T = unknown> {
  /** 注册表 key（也是文件名） */
  key: string;
  /** 默认值 */
  default: T;
  /** 所属分类 */
  category: string;
  /** 描述 */
  desc: string;
  /** 字段级描述 */
  fieldDescriptions?: Record<string, string>;
}

/** 数据库项的类型安全引用 */
export interface DbKeyRef {
  /** 注册表 key */
  key: string;
  /** 所属分类 */
  category: string;
  /** 描述 */
  desc: string;
}

/** 注册后的运行时数据项（含完整信息） */
export interface RegisteredDataItem {
  key: string;
  storage: StorageBackend;
  category: string;
  /** 分类的展示标签 */
  categoryLabel: string;
  desc: string;
  default: unknown;
  onDelete: DeleteBehavior;
  /** 字段级描述映射 */
  fieldDescriptions?: Record<string, string>;
  /** 数据库文件名（仅 storage="db" 的项，由 Rust 端管理） */
  dbFile?: string;
}
