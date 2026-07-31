// ============================================================
// defineDataStore
//
// 统一数据声明入口，替代 defineCacheSchema。
//
// 用法（见项目 data.ts）：
//
//   export const store = defineDataStore({
//     version: "1.0.0",
//     namespace: "000",
//     categories: {
//       preference: { label: "偏好设置", onDelete: "warn" },
//     },
//     items: {
//       "active-tab": { storage: "localStorage", category: "preference", desc: "当前标签页", default: "home" as string },
//     },
//     files: {
//       "config.json": { storage: "file", category: "preference", desc: "应用配置" },
//     },
//     databases: {
//       "my-app.db": { storage: "db", category: "preference", desc: "App 数据库" },
//     },
//   });
//
//   // 组件中：
//   //   const [tab, setTab] = useData(store.keys["active-tab"]);
//   //   const { value } = useFile(store.files["config.json"]);
// ============================================================

import { registerDataItems } from "./registry";
import type {
  DataStoreDef,
  FrontendItemDef,
  FileItemDef,
  DbItemDef,
  DataKeyRef,
  FileKeyRef,
  DbKeyRef,
  AnyItemDef,
} from "./types";

type FrontendKeys<K extends Record<string, any>> = {
  [P in keyof K as K[P] extends { storage: "localStorage" } ? P : never]: DataKeyRef<
    K[P] extends { default: infer D } ? D : never
  >;
};

type FileKeys<F extends Record<string, any>> = {
  [P in keyof F]: FileKeyRef<F[P] extends { default?: infer D } ? D : never>;
};

type DbKeys<D extends Record<string, any>> = {
  [P in keyof D]: DbKeyRef;
};

/**
 * 定义数据存储声明。
 * - 注册 categories 和 items/files/databases 到全局注册表
 * - 返回类型安全的 keys / files / databases 对象
 */
export function defineDataStore<
  C extends Record<string, any>,
  K extends Record<string, any>,
  F extends Record<string, any>,
  D extends Record<string, any>,
>(
  config: DataStoreDef & { categories?: C; items?: K; files?: F; databases?: D },
): {
  version: string;
  categories: C;
  keys: FrontendKeys<K>;
  files: FileKeys<F>;
  databases: DbKeys<D>;
} {
  const { version, namespace, categories, items = {}, files = {}, databases = {} } = config;
  // 泛型声明后 Object.entries 会推导为 unknown，这里转回具体类型处理运行时逻辑
  const itemsAny = items as Record<string, AnyItemDef>;
  const filesAny = files as Record<string, FileItemDef>;
  const databasesAny = databases as Record<string, DbItemDef>;
  const applyPrefix = (key: string) => (namespace ? `${namespace}-${key}` : key);

  // 合并所有项到统一注册表
  const allItems: Record<string, AnyItemDef> = {};

  // 1. localStorage 项（带 namespace 前缀）
  for (const [key, def] of Object.entries(itemsAny)) {
    if (def.storage !== "localStorage") continue;
    if (def.storage === "localStorage" && !("default" in def)) {
      console.error(`[DataStore] localStorage item "${key}" 缺少 default 值。`);
    }
    allItems[applyPrefix(key)] = def;
  }

  // 2. 文件项（key 即文件名，不带 namespace 前缀）
  for (const [key, def] of Object.entries(filesAny)) {
    if (def.storage !== "file") continue;
    allItems[key] = def;
  }

  // 3. 数据库项（key 即文件名）
  for (const [key, def] of Object.entries(databasesAny)) {
    if (def.storage !== "db") continue;
    allItems[key] = def;
  }

  // 注册到全局注册表
  registerDataItems(version, categories, allItems);

  // 构建返回的 keys 对象（仅前端项）
  const frontendKeys: Record<string, DataKeyRef<any>> = {};
  for (const [key, def] of Object.entries(itemsAny)) {
    if (def.storage === "localStorage") {
      const fDef = def as FrontendItemDef;
      frontendKeys[key] = {
        key: applyPrefix(key),
        default: fDef.default,
        category: fDef.category,
        desc: fDef.desc,
        storage: "localStorage",
        fieldDescriptions: fDef.fieldDescriptions,
      };
    }
  }

  // 构建返回的 files 对象
  const fileKeys: Record<string, FileKeyRef<any>> = {};
  for (const [key, def] of Object.entries(filesAny)) {
    if (def.storage === "file") {
      fileKeys[key] = {
        key,
        default: def.default ?? null,
        category: def.category,
        desc: def.desc,
        fieldDescriptions: def.fieldDescriptions,
      };
    }
  }

  // 构建返回的 databases 对象
  const dbKeys: Record<string, DbKeyRef> = {};
  for (const [key, def] of Object.entries(databasesAny)) {
    if (def.storage === "db") {
      dbKeys[key] = {
        key,
        category: def.category,
        desc: def.desc,
      };
    }
  }

  return {
    version,
    categories: categories as any,
    keys: frontendKeys as any,
    files: fileKeys as any,
    databases: dbKeys as any,
  } as any;
}
