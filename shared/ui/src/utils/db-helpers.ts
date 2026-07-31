import { getDbTables } from "../api";
import type { DbTableInfo } from "../api";
import { getDbSelect } from "../data";

/**
 * 加载数据库表信息。
 * 优先使用前端注册的 dbSelect 函数（复用已有连接、无锁竞争），
 * 回退到 Rust 后端的 getDbTables 命令。
 */
export async function loadDbTables(relPath: string): Promise<DbTableInfo[]> {
  const selectFn = getDbSelect(relPath);
  if (selectFn) {
    const rows = await selectFn(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      [],
    );
    if (!Array.isArray(rows)) {
      throw new Error(`selectFn 返回类型异常，期望数组，实际: ${typeof rows}`);
    }
    const tableNames = (rows as Array<{ name: string }>).map(r => r.name);

    const tables: DbTableInfo[] = [];
    for (const name of tableNames) {
      const countRows = await selectFn(
        `SELECT COUNT(*) AS cnt FROM "${name}"`,
        [],
      );
      if (!Array.isArray(countRows)) {
        throw new Error(`count selectFn 返回类型异常，期望数组，实际: ${typeof countRows}`);
      }
      const rowCount = (countRows as Array<{ cnt: number }>).length > 0
        ? Number((countRows as Array<{ cnt: number }>)[0].cnt)
        : 0;
      tables.push({ name, row_count: rowCount });
    }
    return tables;
  }

  return getDbTables(relPath);
}
