// ============================================================
// 全局数据 schema 注册表
//
// 即原 cache/registry.ts + cache/cache-types.ts 的合并。
// 用于：
// 1. DataManagerPanel 获取所有 key 的分组信息
// 2. AboutPanel 展示数据管理
// 3. defineDataStore → registerDataItems → schemaRegistry.register
// ============================================================

// ── 类型定义（来自原 cache/cache-types.ts） ──

/** 版本变更行为 */
export type CategoryBehavior =
  | "preserve"
  | "reset"
  | { migrate: (old: unknown, prevVersion: string) => unknown };

/** 删除行为 */
export type DeleteBehavior = "allowed" | "warn" | "blocked";

/** 分类定义（注册表内部使用） */
export interface CacheCategoryDef {
  label: string;
  onVersionChange: CategoryBehavior;
  onUserDelete: DeleteBehavior;
}

/** 匹配模式 */
export type MatchMode = "exact" | "prefix";

/** 单个 key 的注册表引用 */
export interface CacheKeyRef<T = unknown> {
  key: string;
  default: T;
  category: string;
  desc: string;
  storage?: "localStorage" | "file" | "db";
  matchMode: MatchMode;
  onDelete?: DeleteBehavior;
  fieldDescriptions?: Record<string, string>;
  dbFile?: string;
}

/** 迁移操作 */
export type MigrateOperation =
  | { renameTo: string }
  | { delete: true }
  | { transform: (old: unknown) => unknown };

// ── 注册表实现（来自原 cache/registry.ts） ──

interface SchemaRegistration {
  version: string;
  categories: Record<string, CacheCategoryDef>;
  keys: Record<string, CacheKeyRef<any>>;
  migrations: Record<string, Record<string, MigrateOperation>>;
}

class SchemaRegistry {
  private schemas: SchemaRegistration[] = [];

  register(schema: SchemaRegistration): boolean {
    const existingKeys = this.getAllKeyRefs();
    // 过滤掉已存在的 key，避免静默覆盖（先注册者优先）
    const newKeys: Record<string, CacheKeyRef<any>> = {};
    for (const [key, ref] of Object.entries(schema.keys)) {
      if (!(key in existingKeys)) {
        newKeys[key] = ref;
      }
    }
    if (Object.keys(newKeys).length === 0) return false;
    this.schemas.push({ ...schema, keys: newKeys });
    return true;
  }

  getAll(): SchemaRegistration[] {
    return [...this.schemas];
  }

  getAllCategories(): Record<string, CacheCategoryDef> {
    const merged: Record<string, CacheCategoryDef> = {};
    for (const s of this.schemas) {
      Object.assign(merged, s.categories);
    }
    return merged;
  }

  getAllKeyRefs(): Record<string, CacheKeyRef<any>> {
    const merged: Record<string, CacheKeyRef<any>> = {};
    for (const s of this.schemas) {
      Object.assign(merged, s.keys);
    }
    return merged;
  }

  isKeyRegistered(key: string): boolean {
    for (const s of this.schemas) {
      if (key in s.keys) return true;
      // 检查前缀匹配（matchMode === "prefix"）
      for (const [registeredKey, ref] of Object.entries(s.keys)) {
        if (ref.matchMode === "prefix" && key.startsWith(registeredKey)) {
          return true;
        }
      }
    }
    return false;
  }

  getCategoryOfKey(key: string): string | undefined {
    for (const s of this.schemas) {
      if (key in s.keys) return s.keys[key].category;
      // 检查前缀匹配
      for (const [registeredKey, ref] of Object.entries(s.keys)) {
        if (ref.matchMode === "prefix" && key.startsWith(registeredKey)) {
          return ref.category;
        }
      }
    }
    return undefined;
  }

  getAllMigrations(): Record<string, Record<string, MigrateOperation>> {
    const merged: Record<string, Record<string, MigrateOperation>> = {};
    for (const s of this.schemas) {
      for (const [fromVer, ops] of Object.entries(s.migrations)) {
        const existing = merged[fromVer] ?? {};
        Object.assign(existing, ops);
        merged[fromVer] = existing;
      }
    }
    return merged;
  }

  getGroupedKeys(): { categoryId: string; category: CacheCategoryDef; keys: CacheKeyRef<any>[] }[] {
    const cats = this.getAllCategories();
    const allKeys = this.getAllKeyRefs();
    const groups: Record<string, CacheKeyRef<any>[]> = {};
    for (const [, keyRef] of Object.entries(allKeys)) {
      const catId = keyRef.category;
      if (!groups[catId]) groups[catId] = [];
      groups[catId].push(keyRef);
    }
    return Object.entries(cats).map(([catId, catDef]) => ({
      categoryId: catId,
      category: catDef,
      keys: groups[catId] ?? [],
    }));
  }
}

// === 单例 ===

export const schemaRegistry = new SchemaRegistry();

// === 分类辅助函数 ===

const _registeredCategories: Record<string, CacheCategoryDef> = {};

export function registerCategories(cats: Record<string, CacheCategoryDef>): void {
  Object.assign(_registeredCategories, cats);
}

export function getRegisteredCategories(): Record<string, CacheCategoryDef> {
  return { ..._registeredCategories };
}

export function getAllRegisteredKeys(): CacheKeyRef<any>[] {
  return Object.values(schemaRegistry.getAllKeyRefs());
}
