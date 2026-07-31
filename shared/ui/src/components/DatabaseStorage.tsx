import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { listDatabaseFiles, clearDbTable, deleteDataFiles } from "../api";
import type { DatabaseFileEntry, DbTableInfo } from "../api";
import { getRegisteredDbItems, getDbExecute } from "../data";
import { ConfirmDialog } from "./JsonTree";
import { loadDbTables } from "../utils/db-helpers";

// ============================================================
// 数据库存储 Tab
// ============================================================

export function DatabaseStorage() {
  const [dbFiles, setDbFiles] = useState<DatabaseFileEntry[]>([]);
  const [dbTablesMap, setDbTablesMap] = useState<Record<string, DbTableInfo[]>>({});
  const [dbTablesLoading, setDbTablesLoading] = useState<Record<string, boolean>>({});
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set());
  const [confirmDeleteDb, setConfirmDeleteDb] = useState<string | null>(null);
  const [confirmClearTable, setConfirmClearTable] = useState<{ dbRelPath: string; tableName: string } | null>(null);
  const [dbOperating, setDbOperating] = useState(false);
  const [loading, setLoading] = useState(true);

  const dbItems = getRegisteredDbItems();
  const registeredDbFileNames = new Set(dbItems.map(i => i.dbFile).filter(Boolean));

  const dbFileByNameMap = useMemo(() => {
    const m = new Map<string, DatabaseFileEntry>();
    for (const f of dbFiles) m.set(f.name, f);
    return m;
  }, [dbFiles]);

  useEffect(() => {
    (async () => {
      try {
        const dbList = await listDatabaseFiles();
        setDbFiles(dbList);
      } catch {
        setDbFiles([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dbLoadedRef = useRef(new Set<string>());
  const dbLoadingRef = useRef(new Set<string>());
  const toggleDbFile = useCallback(async (relPath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
    if (dbLoadedRef.current.has(relPath) || dbLoadingRef.current.has(relPath)) return;
    dbLoadingRef.current.add(relPath);
    setDbTablesLoading(prev => ({ ...prev, [relPath]: true }));
    try {
      const tables = await loadDbTables(relPath);
      dbLoadedRef.current.add(relPath);
      setDbTablesMap(prev => ({ ...prev, [relPath]: tables }));
    } catch (e) {
      const errMsg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error(`加载表信息失败: ${relPath} — ${errMsg}`);
      if (e instanceof Error) console.error(e.stack);
    } finally {
      dbLoadingRef.current.delete(relPath);
      setDbTablesLoading(prev => ({ ...prev, [relPath]: false }));
    }
  }, []);

  const handleClearDbTable = useCallback(async (dbRelPath: string, tableName: string) => {
    setDbOperating(true);
    try {
      const execFn = getDbExecute(dbRelPath);
      if (execFn) {
        await execFn(`DELETE FROM "${tableName}"`, []);
      } else {
        await clearDbTable(dbRelPath, tableName);
      }
      const tables = await loadDbTables(dbRelPath);
      setDbTablesMap(prev => ({ ...prev, [dbRelPath]: tables }));
    } catch (e) {
      console.error(`清空表 ${tableName} 失败`, e);
    } finally {
      setDbOperating(false);
      setConfirmClearTable(null);
    }
  }, []);

  const handleDeleteDbFile = useCallback(async (relPath: string) => {
    setDbOperating(true);
    try {
      await deleteDataFiles([relPath]);
      setDbFiles(prev => prev.filter(f => f.rel_path !== relPath));
      setDbTablesMap(prev => { const n = { ...prev }; delete n[relPath]; return n; });
    } catch (e) {
      console.error(`删除数据库 ${relPath} 失败`, e);
    } finally {
      setDbOperating(false);
      setConfirmDeleteDb(null);
    }
  }, []);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // 分组：注册项 + 未注册文件
  const dbSections: { label: string; behavior: string; items: { name: string; relPath: string | null; desc: string; behavior: string; isRegistered: boolean; file: DatabaseFileEntry | undefined }[] }[] = [];

  // 按分类分组的注册项
  const catMap = new Map<string, { label: string; behavior: string; items: { name: string; relPath: string | null; desc: string; behavior: string; isRegistered: boolean; file: DatabaseFileEntry | undefined }[] }>();
  for (const item of dbItems) {
    const file = item.dbFile ? dbFileByNameMap.get(item.dbFile) : undefined;
    const entry = { name: item.dbFile ?? item.key, relPath: file?.rel_path ?? null, desc: item.desc, behavior: item.onDelete ?? "warn", isRegistered: true, file };
    if (!catMap.has(item.category)) {
      catMap.set(item.category, { label: item.categoryLabel, behavior: item.onDelete ?? "warn", items: [] });
    }
    catMap.get(item.category)!.items.push(entry);
  }
  for (const [, section] of catMap) {
    dbSections.push(section);
  }

  // 未注册的数据库文件
  const unknownDbFiles = dbFiles.filter(f => !registeredDbFileNames.has(f.name));
  if (unknownDbFiles.length > 0) {
    dbSections.push({
      label: "其他数据库文件",
      behavior: "allowed",
      items: unknownDbFiles.map(f => ({
        name: f.name, relPath: f.rel_path, desc: "未注册", behavior: "allowed", isRegistered: false, file: f,
      })),
    });
  }

  if (loading) return null;

  if (dbSections.length === 0) return null;

  return (
    <>
      {dbSections.map(section => (
            <div key={section.label} className="dm-category-group">
              <div className="dm-category-header">
                <span className="dm-category-label">{section.label}</span>
                <span className={`dm-category-behavior dm-behavior-${section.behavior}`}>
                  {section.behavior === "warn" && "删除需确认"}
                  {section.behavior === "allowed" && "可删除"}
                  {section.behavior === "blocked" && "不可删除"}
                </span>
              </div>
              {section.items.map(item => {
                const expanded = expandedFiles.has(item.relPath ?? item.name);
                const fileExists = !!item.file;
                const hasTables = fileExists && dbTablesMap[item.file!.rel_path]?.length > 0;
                const isLoadingTables = item.file ? dbTablesLoading[item.file.rel_path] : false;

                return (
                  <div key={item.name} className="dm-ls-entry">
                    <div className="dm-ls-key-row">
                      <span
                        className="dm-ls-key-icon"
                        onClick={() => { if (item.relPath) toggleDbFile(item.relPath); }}
                        style={{ cursor: fileExists ? "pointer" : "default", visibility: fileExists ? "visible" : "hidden" }}
                      >
                        {expanded ? "▼" : "▶"}
                      </span>
                      <span className="dm-storage-badge dm-badge-db" title="SQLite 数据库">DB</span>
                      <code className="dm-ls-key-name">{item.name}</code>
                      <span className="dm-ls-key-desc">{item.desc}</span>
                      {item.file ? (
                        <>
                          <span className="dm-ls-key-summary">{formatSize(item.file.size)}</span>
                          <button
                            className="dm-ls-delete-btn"
                            disabled={dbOperating || item.behavior === "blocked"}
                            onClick={() => setConfirmDeleteDb(item.relPath!)}
                            title={item.behavior === "blocked" ? "不可删除" : "删除此数据库"}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <span className="dm-ls-key-summary" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                          文件未创建
                        </span>
                      )}
                    </div>
                    {expanded && item.file && (
                      <div className="jv-body" style={{ padding: "4px 0" }}>
                        {isLoadingTables ? (
                          <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--text-secondary)" }}>
                            加载表信息...
                          </div>
                        ) : hasTables ? (
                          <table className="dm-db-table">
                            <thead>
                              <tr>
                                <th>表名</th>
                                <th style={{ textAlign: "right" }}>行数</th>
                                <th style={{ width: 80 }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {dbTablesMap[item.file.rel_path].map(t => (
                                <tr key={t.name}>
                                  <td><code>{t.name}</code></td>
                                  <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                                    {t.row_count}
                                  </td>
                                  <td>
                                    <button
                                      className="dm-db-action-btn"
                                      disabled={dbOperating}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmClearTable({ dbRelPath: item.file!.rel_path, tableName: t.name });
                                      }}
                                      title="清空此表的所有数据"
                                    >
                                      清空
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--text-secondary)" }}>
                            {dbTablesMap[item.file.rel_path] ? "（无用户表）" : "加载失败"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

      {/* 清空表数据确认弹窗 */}
      {confirmClearTable && (
        <ConfirmDialog
          title="清空表数据"
          desc={`确定清空表 <code>${confirmClearTable.tableName}</code> 的全部数据（${dbTablesMap[confirmClearTable.dbRelPath]?.find(t => t.name === confirmClearTable.tableName)?.row_count ?? 0} 行）？此操作不可恢复。`}
          onCancel={() => setConfirmClearTable(null)}
          onConfirm={() => handleClearDbTable(confirmClearTable.dbRelPath, confirmClearTable.tableName)}
        />
      )}

      {/* 删除数据库文件确认弹窗 */}
      {confirmDeleteDb && (
        <ConfirmDialog
          title="删除数据库"
          desc={`确定删除数据库文件 <code>${confirmDeleteDb}</code>？此操作不可恢复。`}
          onCancel={() => setConfirmDeleteDb(null)}
          onConfirm={() => handleDeleteDbFile(confirmDeleteDb)}
        />
      )}
    </>
  );
}
