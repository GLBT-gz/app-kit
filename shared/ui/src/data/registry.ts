// ============================================================
// 统一数据注册表
//
// 基于 schema-registry.ts 的全局 SchemaRegistry 构建，
// 提供面向 defineDataStore 的友好 API。
// ============================================================

import { schemaRegistry } from "./schema-registry";
import type { CacheCategoryDef, CacheKeyRef, DeleteBehavior as CacheDeleteBehavior } from "./schema-registry";
import { safeSetJSON, safeRemoveJSON, safeGetItem } from "../localStorageKeys";
import type {
  DataCategoryDef,
  AnyItemDef,
  FrontendItemDef,
  FileItemDef,
  DbItemDef,
  RegisteredDataItem,
} from "./types";

// ── 将新类型映射到缓存系统的类型 ──

function mapDeleteBehavior(b: DataCategoryDef["onDelete"]): CacheDeleteBehavior {
  return b;
}

function defToCacheKeyRef(key: string, def: AnyItemDef): CacheKeyRef<any> {
  const frontend = def.storage === "localStorage" ? (def as FrontendItemDef) : undefined;
  const fileItem = def.storage === "file" ? (def as FileItemDef) : undefined;
  const dbItem = def.storage === "db" ? (def as DbItemDef) : undefined;
  return {
    key,
    default: frontend?.default ?? fileItem?.default ?? null,
    category: def.category,
    desc: def.desc,
    storage: def.storage,
    matchMode: frontend?.matchMode ?? "exact",
    onDelete: def.onDelete,
    fieldDescriptions: frontend?.fieldDescriptions ?? fileItem?.fieldDescriptions,
    dbFile: dbItem !== undefined ? (dbItem.dbFile ?? key) : undefined,
  };
}

// ── Public API ──

/**
 * 注册单个数据项到全局注册表。
 * 供 defineDataStore 内部调用。
 */
export function registerDataItems(
  version: string,
  categories: Record<string, DataCategoryDef>,
  items: Record<string, AnyItemDef>,
): void {
  // 转换 categories
  const cacheCategories: Record<string, CacheCategoryDef> = {};
  for (const [id, cat] of Object.entries(categories)) {
    cacheCategories[id] = {
      label: cat.label,
      onVersionChange: "preserve",
      onUserDelete: mapDeleteBehavior(cat.onDelete),
    };
  }

  // 转换 items
  const cacheKeys: Record<string, CacheKeyRef<any>> = {};
  for (const [key, def] of Object.entries(items)) {
    cacheKeys[key] = defToCacheKeyRef(key, def);
  }

  // 注册到底层 schemaRegistry（先注册者优先，重复 key 静默跳过）
  const ok = schemaRegistry.register({
    version,
    categories: cacheCategories,
    keys: cacheKeys,
    migrations: {},
  });
  if (!ok) {
    console.warn(`[registerDataItems] 所有 key 均已被注册，schema 被跳过。版本: ${version}, keys: ${Object.keys(items).join(", ")}`);
  }
}

/**
 * 注册一个实际 localStorage key 到全局注册表。
 * 适用于通过 safeGetJSON/safeSetJSON 直接读写的独立 key（不走 cache 系统）。
 * key 必须是实际的 localStorage key 名。
 */
export function registerRawDataItem(
  key: string,
  def: AnyItemDef,
): void {
  schemaRegistry.register({
    version: "1.0.0",
    categories: {},
    keys: {
      [key]: defToCacheKeyRef(key, def),
    },
    migrations: {},
  });
}

/**
 * 获取所有已注册的数据项（按 category 分组）。
 * 返回按 DataManager 展示优化的结构。
 */
export function getGroupedDataItems(): {
  categoryId: string;
  category: DataCategoryDef;
  items: RegisteredDataItem[];
}[] {
  const groups = schemaRegistry.getGroupedKeys();
  return groups.map((g) => ({
    categoryId: g.categoryId,
    category: {
      label: g.category.label,
      onDelete: g.category.onUserDelete,
    },
    items: g.keys.map((k) => ({
      key: k.key,
      storage: k.storage ?? "localStorage",
      category: k.category,
      categoryLabel: g.category.label,
      desc: k.desc,
      default: k.default,
      onDelete: k.onDelete ?? g.category.onUserDelete,
      fieldDescriptions: k.fieldDescriptions,
      dbFile: k.dbFile,
    })),
  }));
}

/**
 * 获取所有已注册的前端项（仅 localStorage）。
 */
export function getRegisteredFrontendKeys(): RegisteredDataItem[] {
  const all = getAllRegisteredItems();
  return all.filter((item) => item.storage === "localStorage");
}

/**
 * 获取所有已注册的文件项（仅 file）。
 */
export function getRegisteredFileItems(): RegisteredDataItem[] {
  const all = getAllRegisteredItems();
  return all.filter((item) => item.storage === "file");
}

/** @deprecated 使用 getRegisteredFileItems */
export const getRegisteredBackendFiles = getRegisteredFileItems;

/**
 * 获取所有已注册的数据库项（仅 db）。
 */
export function getRegisteredDbItems(): RegisteredDataItem[] {
  const all = getAllRegisteredItems();
  return all.filter((item) => item.storage === "db");
}

/**
 * 获取所有已注册的数据项（扁平数组）。
 */
export function getAllRegisteredItems(): RegisteredDataItem[] {
  const groups = schemaRegistry.getGroupedKeys();
  const result: RegisteredDataItem[] = [];
  for (const g of groups) {
    for (const k of g.keys) {
      result.push({
        key: k.key,
        storage: k.storage ?? "localStorage",
        category: k.category,
        categoryLabel: g.category.label,
        desc: k.desc,
        default: k.default,
        onDelete: k.onDelete ?? g.category.onUserDelete,
        fieldDescriptions: k.fieldDescriptions,
        dbFile: k.dbFile,
      });
    }
  }
  return result;
}

// ── 前端数据库查询注册（DataManager 复用 tauri-plugin-sql 连接） ──

/**
 * 数据库 SELECT 查询函数类型。
 * 复用前端已有的 `Database` 实例，避免在 Rust 后端开第二个连接导致锁竞争。
 */
export type DbSelectFunc = (sql: string, params?: unknown[]) => Promise<unknown[]>;

/**
 * 数据库 EXECUTE 执行函数类型。
 */
export type DbExecuteFunc = (sql: string, params?: unknown[]) => Promise<unknown>;

const dbSelectRegistry = new Map<string, DbSelectFunc>();
const dbExecuteRegistry = new Map<string, DbExecuteFunc>();

/**
 * 为指定数据库文件注册 SELECT 查询函数。
 * 供各项目在初始化时调用，传入自身 `getDb()` 的封装。
 */
export function registerDbSelect(dbFile: string, select: DbSelectFunc): void {
  dbSelectRegistry.set(dbFile, select);
}

/**
 * 为指定数据库文件注册 EXECUTE 执行函数。
 */
export function registerDbExecute(dbFile: string, execute: DbExecuteFunc): void {
  dbExecuteRegistry.set(dbFile, execute);
}

/**
 * 获取已注册的 SELECT 查询函数。
 */
export function getDbSelect(dbFile: string): DbSelectFunc | undefined {
  return dbSelectRegistry.get(dbFile);
}

/**
 * 获取已注册的 EXECUTE 执行函数。
 */
export function getDbExecute(dbFile: string): DbExecuteFunc | undefined {
  return dbExecuteRegistry.get(dbFile);
}

/**
 * 检查 localStorage key 是否已注册（精确匹配或前缀匹配）。
 */
export function isLocalStorageKeyRegistered(key: string): boolean {
  return schemaRegistry.isKeyRegistered(key);
}

/**
 * 返回指定 category 的删除行为。
 */
export function getDeleteBehavior(categoryId: string): RegisteredDataItem["onDelete"] {
  const cats = schemaRegistry.getAllCategories();
  return cats[categoryId]?.onUserDelete ?? "warn";
}


/**
 * 将所有已注册的 localStorage 项的默认值写入前端存储（如果 key 尚不存在）。
 *
 * 适用于：
 * - App 启动时调用，确保所有注册项的默认值已写入 localStorage
 * - 清空全部数据后调用，自动恢复默认值而无需手动重置
 *
 * 可安全重复调用（已存在的 key 不会被覆盖）。
 */
export function ensureDataDefaults(): void {
  if (typeof localStorage === "undefined") return;

  // ── key 名迁移：theme-config → core-theme-config ──
  try {
    const oldVal = safeGetItem("theme-config");
    if (oldVal !== null && safeGetItem("core-theme-config") === null) {
      const parsed = JSON.parse(oldVal);
      safeSetJSON("core-theme-config", parsed);
    }
    // 无论迁移是否成功，都清除旧 key（parse 失败说明数据已损坏，保留也无意义）
  } catch (e) {
    console.warn("[ensureDataDefaults] theme-config 迁移异常:", e);
  }
  safeRemoveJSON("theme-config");

  const all = getAllRegisteredItems();
  for (const item of all) {
    if (item.storage !== "localStorage") continue;
    // 跳过 default: null 的项（缓存类数据，由消费者在首次使用时写入）
    if (item.default === null) continue;
    // 跳过注册默认值为空对象 {} 的项（如 core-shortcuts），
    // 这类项的消费者代码（如 loadShortcuts()）会在首次访问时写入完整的默认值
    if (!Array.isArray(item.default) && typeof item.default === "object" && Object.keys(item.default).length === 0) continue;
    if (safeGetItem(item.key) === null) {
      try {
        safeSetJSON(item.key, item.default);
      } catch {
        // 静默失败
      }
    }
  }

  // 清理因旧 bug 错误写入 localStorage 的后端 key
  const backendItems = getRegisteredBackendFiles();
  for (const item of backendItems) {
    if (safeGetItem(item.key) !== null) {
      safeRemoveJSON(item.key);
    }
  }
}