import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { listDataFiles, readAllLocalFiles, getDataDirectory, deleteDataFiles, clearDbTable } from "../api";
import type { DataFileEntry, DbTableInfo } from "../api";
import { getRegisteredFileItems, getRegisteredDbItems, getDbExecute } from "../data";
import type { RegisteredDataItem } from "../data";
import { isPlainObject, tryParseJSON, JsonNode, ConfirmDialog } from "./JsonTree";
import { loadDbTables } from "../utils/db-helpers";

// ============================================================
// 本地文件 Tab（含 JSON 文件和 SQLite 数据库文件）
// ============================================================

export function LocalFiles() {
  const [dataDir, setDataDir] = useState("");
  const [files, setFiles] = useState<DataFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fileContents, setFileContents] = useState<Record<string, unknown>>({});
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clearAllBackendConfirm, setClearAllBackendConfirm] = useState(false);
  const [clearingAllBackend, setClearingAllBackend] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── 数据库表信息 ──
  const [dbTablesMap, setDbTablesMap] = useState<Record<string, DbTableInfo[]>>({});
  const [dbTablesLoading, setDbTablesLoading] = useState<Record<string, boolean>>({});
  const [dbOperating, setDbOperating] = useState(false);
  const [confirmClearTable, setConfirmClearTable] = useState<{ dbRelPath: string; tableName: string } | null>(null);

  // 已注册的后端文件和数据库文件（useMemo 稳定引用，避免每次渲染新 Set 导致 useEffect 无限循环）
  const dbRegItems = useMemo(() => getRegisteredDbItems(), []);
  const backendFiles = useMemo(() => getRegisteredFileItems(), []);
  const backendFileNames = useMemo(() => new Set(backendFiles.map(f => f.key)), [backendFiles]);
  const dbRegFileNames = useMemo(() => new Set(dbRegItems.map(i => i.dbFile).filter(Boolean)), [dbRegItems]);

  const toggleFile = useCallback((name: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleNode = useCallback((path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // ── 加载数据库表信息（首次展开 db 文件时） ──
  //
  // 优先使用前端注册的查询函数（复用 tauri-plugin-sql 连接，无锁竞争），
  // 回退到 Rust 后端命令（需要 db-bridge feature）。
  //
  // 使用 ref 避免闭包依赖 state 导致的重建和并发问题。
  // 注意：必须放在 expandAllFiles 之前，因为 expandAllFiles 引用 ensureDbTables
  const dbLoadedRef = useRef(new Set<string>());
  const dbLoadingRef = useRef(new Set<string>());
  const ensureDbTables = useCallback(async (relPath: string) => {
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
      // 自动重试一次（应对首次打开时后端连接未就绪）
      try {
        await new Promise(r => setTimeout(r, 1500));
        const tables = await loadDbTables(relPath);
        dbLoadedRef.current.add(relPath);
        setDbTablesMap(prev => ({ ...prev, [relPath]: tables }));
      } catch (e2) {
        const errMsg2 = e2 instanceof Error ? `${e2.name}: ${e2.message}` : String(e2);
        console.error(`加载表信息重试也失败: ${relPath} — ${errMsg2}`);
        if (e2 instanceof Error) console.error(e2.stack);
      }
    } finally {
      dbLoadingRef.current.delete(relPath);
      setDbTablesLoading(prev => ({ ...prev, [relPath]: false }));
    }
  }, []);

  const expandAllFiles = useCallback(() => {
    const fileNames = files.map(f => f.name);
    const allPaths = new Set<string>();
    const collectPaths = (v: unknown, base: string, depth = 0) => {
      if (depth >= 20) return; // 深度限制，防止栈溢出
      if (isPlainObject(v)) {
        for (const k of Object.keys(v)) {
          const p = `${base}\0${k}`;
          allPaths.add(p);
          collectPaths(v[k], p, depth + 1);
        }
      } else if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          const p = `${base}\0${i}`;
          allPaths.add(p);
          collectPaths(v[i], p, depth + 1);
        }
      }
    };
    for (const name of fileNames) {
      const content = fileContents[name];
      if (isPlainObject(content) || Array.isArray(content)) {
        collectPaths(content, `file\0${name}`);
      }
    }
    setExpandedFiles(new Set(fileNames));
    setExpandedNodes(allPaths);
    // 展开全部时同步触发数据库文件的表信息加载
    for (const item of dbRegItems) {
      const fn = item.dbFile;
      if (!fn || !files.find(f => f.name === fn)) continue;
      ensureDbTables(fn);
    }
  }, [files, fileContents, dbRegItems, ensureDbTables]);

  const collapseAllFiles = useCallback(() => {
    setExpandedFiles(new Set());
    setExpandedNodes(new Set());
  }, []);

  // ── 清空数据库表 ──
  //
  // 优先使用前端注册的执行函数，回退到 Rust 后端命令。
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

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [dir, fileList] = await Promise.all([
        getDataDirectory(),
        listDataFiles(),
      ]);
      setDataDir(dir);
      setFiles(fileList);

      // 预加载所有文件内容（一次 IPC 批量读取，跳过数据库文件）
      const contents: Record<string, unknown> = {};
      const toRead: string[] = [];
      for (const f of fileList) {
        if (dbRegFileNames.has(f.name)) {
          contents[f.name] = null; // 标记为 db 文件
        } else {
          toRead.push(f.name);
        }
      }
      if (toRead.length > 0) {
        const batch = await readAllLocalFiles(toRead.map(n => `${dir}\\${n}`));
        for (const [fullPath, raw] of Object.entries(batch)) {
          const name = fullPath.slice(fullPath.lastIndexOf("\\") + 1);
          contents[name] = raw ? (tryParseJSON(raw) ?? raw) : "（读取失败）";
        }
      }
      setFileContents(contents);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("加载本地文件失败", e);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [dbRegFileNames]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = useCallback(async (name: string) => {
    setDeleting(true);
    try {
      await deleteDataFiles([name]);
      setFiles(prev => prev.filter(f => f.name !== name));
      setFileContents(prev => { const n = { ...prev }; delete n[name]; return n; });
    } catch (e) {
      console.error(`删除 ${name} 失败`, e);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }, []);

  const handleClearAllBackend = useCallback(async () => {
    setClearingAllBackend(true);
    try {
      const allNames = files.map(f => f.name);
      if (allNames.length === 0) return;
      // 排除数据库文件（正在使用中无法删除，留给后端跳过或报错提示）
      const deletable = allNames.filter(n => !dbRegFileNames.has(n));
      const dbSkipped = allNames.filter(n => dbRegFileNames.has(n));
      if (deletable.length === 0) return;
      await deleteDataFiles(deletable);
      setFiles(prev => prev.filter(f => deletable.includes(f.name)));
      setFileContents(prev => {
        const n = { ...prev };
        for (const name of deletable) delete n[name];
        return n;
      });
      if (dbSkipped.length > 0) {
        console.warn(`清空全部跳过 ${dbSkipped.length} 个数据库文件（正在使用）: ${dbSkipped.join(", ")}`);
      }
    } catch (e) {
      console.error("清空后端数据失败", e);
    } finally {
      setClearingAllBackend(false);
      setClearAllBackendConfirm(false);
    }
  }, [files, dbRegFileNames]);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // 合并已注册的文件和数据库项，按 category 分组
  const mergedRegItems = useMemo(() => {
    const map = new Map<string, { categoryLabel: string; items: RegisteredDataItem[] }>();
    for (const f of backendFiles) {
      const cat = f.category;
      if (!map.has(cat)) map.set(cat, { categoryLabel: f.categoryLabel, items: [] });
      map.get(cat)!.items.push(f);
    }
    for (const d of dbRegItems) {
      const cat = d.category;
      if (!map.has(cat)) map.set(cat, { categoryLabel: d.categoryLabel, items: [] });
      map.get(cat)!.items.push(d);
    }
    return [...map.entries()];
  }, [backendFiles, dbRegItems]);

  // 分离已知和未知文件
  const otherFiles = files.filter(f => !backendFileNames.has(f.name) && !dbRegFileNames.has(f.name));

  // SQLite 辅助文件（.db-shm / .db-wal）关联分组
  const sqliteAuxMap = useMemo(() => {
    const map = new Map<string, DataFileEntry[]>();
    const auxRe = /\.(db-shm|db-wal|db-journal)$/;
    for (const f of otherFiles) {
      const m = f.name.match(auxRe);
      if (!m) continue;
      const parent = f.name.slice(0, -(m[1].length + 1));
      const arr = map.get(parent);
      if (arr) arr.push(f);
      else map.set(parent, [f]);
    }
    return map;
  }, [otherFiles]);

  const groupedAuxNames = useMemo(() => {
    const s = new Set<string>();
    for (const [, auxFiles] of sqliteAuxMap) {
      for (const f of auxFiles) s.add(f.name);
    }
    return s;
  }, [sqliteAuxMap]);
  const filteredOtherFiles = otherFiles.filter(f => !groupedAuxNames.has(f.name));

  if (loading) {
    return <div className="dm-empty" style={{ padding: 24 }}>加载中...</div>;
  }

  return (
    <>
      <div className="dm-toolbar">
        <span className="dm-toolbar-summary">
          <span
            style={{ fontSize: 12, userSelect: "text", cursor: "text" }}
            title={dataDir}
          >
            {dataDir}
          </span>
          <button
            className="dm-tool-btn"
            style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}
            onClick={() => {
              try { navigator.clipboard.writeText(dataDir); } catch { /* 剪贴板不可用时静默 */ }
            }}
            title="复制目录路径"
          >
            复制
          </button>
          {loadError && files.length > 0 && <span style={{ color: "#ef4444", marginLeft: 8 }}>（部分文件读取失败）</span>}
        </span>
        <div style={{ display: "flex", gap: 4, flex: 1, justifyContent: "flex-end" }}>
          <button className="dm-tool-btn" onClick={loadData} disabled={loading} title="刷新文件列表">{loading ? "刷新中..." : "刷新"}</button>
          <button className="dm-tool-btn" onClick={expandAllFiles} title="全部展开">全部展开</button>
          <button className="dm-tool-btn" onClick={collapseAllFiles} title="全部折叠">全部折叠</button>
          <button
            className="dm-tool-btn dm-tool-btn-danger"
            onClick={() => setClearAllBackendConfirm(true)}
            disabled={files.length === 0 || clearingAllBackend}
            title="删除所有后端数据文件（不可恢复）"
          >
            {clearingAllBackend ? "删除中..." : "清空全部"}
          </button>
        </div>
      </div>
      <div className="dm-ls-list">
        {files.length === 0 ? (
          <div className="dm-empty">{loadError ? `加载失败：${loadError}` : "目录为空"}</div>
        ) : (
          <>
            {/* 按分类分组的已注册项（JSON 文件 + 数据库文件） */}
            {mergedRegItems.map(([catId, group]) => {
              const fileEntries: { file: DataFileEntry | undefined; item: RegisteredDataItem }[] = [];
              for (const item of group.items) {
                const fileName = item.storage === "db" ? item.dbFile : item.key;
                if (!fileName) continue;
                const fe = files.find(f => f.name === fileName);
                fileEntries.push({ file: fe, item });
              }
              const visibleEntries = fileEntries.filter((e): e is { file: DataFileEntry; item: RegisteredDataItem } => !!e.file);
              if (visibleEntries.length === 0) return null;

              const behavior = group.items[0]?.onDelete ?? "warn";

              return (
                <div key={catId} className="dm-category-group">
                  <div className="dm-category-header">
                    <span className="dm-category-label">{group.categoryLabel}</span>
                    <span className={`dm-category-behavior dm-behavior-${behavior}`}>
                      {behavior === "warn" && "删除需确认"}
                      {behavior === "allowed" && "可随意删除"}
                      {behavior === "blocked" && "不可删除"}
                    </span>
                  </div>

                  {visibleEntries.map(({ file: entry, item: reg }) => {
                    const fileName = entry.name;
                    const isDb = reg.storage === "db";
                    const expanded = expandedFiles.has(fileName);
                    const content = fileContents[fileName];
                    const isObj = !isDb && (isPlainObject(content) || Array.isArray(content));

                    return (
                      <div key={fileName} className="dm-ls-entry">
                        <div className="dm-ls-key-row">
                          <span
                            className="dm-ls-key-icon"
                            onClick={() => {
                              toggleFile(fileName);
                              if (isDb && expanded === false) {
                                // 首次展开数据库文件时加载表信息
                                ensureDbTables(entry.name);
                              }
                            }}
                            style={{ cursor: "pointer", visibility: "visible" }}
                          >
                            {expanded ? "▼" : "▶"}
                          </span>
                          <span className={`dm-storage-badge ${isDb ? "dm-badge-db" : "dm-badge-file"}`} title={isDb ? "SQLite 数据库" : "后端文件"}>
                            {isDb ? "DB" : "文件"}
                          </span>
                          <code className="dm-ls-key-name">{fileName}</code>
                          {reg?.desc && <span className="dm-ls-key-desc">{reg.desc}</span>}
                          <span className="dm-ls-key-summary">{formatSize(entry.size)}</span>
                          <button
                            className="dm-ls-delete-btn"
                            disabled={deleting || dbOperating || behavior === "blocked"}
                            onClick={() => setConfirmDelete(entry.name)}
                            title={behavior === "blocked" ? "此文件不可删除" : "删除此文件"}
                          >
                            ✕
                          </button>
                        </div>
                        {expanded && (
                          <div className="jv-body" style={isDb ? { padding: "4px 0" } : undefined}>
                            {isDb ? (
                              <DbFileContent
                                fileName={fileName}
                                dbTablesMap={dbTablesMap}
                                dbTablesLoading={dbTablesLoading}
                                dbOperating={dbOperating}
                                onClearTable={(tableName) => setConfirmClearTable({ dbRelPath: fileName, tableName })}
                              />
                            ) : !content ? (
                              <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--text-secondary)" }}>
                                （加载中...）
                              </div>
                            ) : isObj ? (
                              Object.entries(content as Record<string, unknown>).map(([k, v]) => (
                                <JsonNode key={k} name={k} value={v} path={`file\0${fileName}\0${k}`} expanded={expandedNodes} onToggle={toggleNode} />
                              ))
                            ) : (
                              <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                                {String(content)}
                              </div>
                            )}
                          </div>
                        )}
                        {confirmDelete === fileName && (
                          <ConfirmDialog
                            title="确认删除"
                            desc={`确定删除 <code>${fileName}</code>？此操作不可恢复。`}
                            onCancel={() => setConfirmDelete(null)}
                            onConfirm={() => handleDelete(fileName)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* 其他未注册文件 */}
            {filteredOtherFiles.length > 0 && (
              <div className="dm-category-group">
                <div className="dm-category-header" style={{ color: "#d4a017" }}>
                  <span className="dm-category-label">其他文件</span>
                  <span className="dm-category-behavior dm-behavior-allowed">
                    未注册
                  </span>
                </div>

                {filteredOtherFiles.map(entry => {
                  const expanded = expandedFiles.has(entry.name);
                  const content = fileContents[entry.name];
                  const isObj = isPlainObject(content) || Array.isArray(content);
                  const auxFiles = sqliteAuxMap.get(entry.name) ?? null;

                  return (
                    <div key={entry.name} className="dm-ls-entry">
                      <div className="dm-ls-key-row">
                        <span
                          className="dm-ls-key-icon"
                          onClick={() => { toggleFile(entry.name); }}
                          style={{ cursor: "pointer", visibility: "visible" }}
                        >
                          {expanded ? "▼" : "▶"}
                        </span>
                        <span className="dm-storage-badge dm-badge-unknown" title="未注册文件">?</span>
                        <code className="dm-ls-key-name" style={{ color: "var(--text-secondary)" }}>{entry.name}</code>
                        <span className="dm-ls-key-summary">{formatSize(entry.size)}</span>
                        <button
                          className="dm-ls-delete-btn"
                          disabled={deleting}
                          onClick={() => setConfirmDelete(entry.name)}
                          title="删除此文件"
                        >
                          ✕
                        </button>
                      </div>
                      {expanded && (
                        <div className="jv-body">
                          {auxFiles ? (
                            <div style={{ padding: "4px 8px" }}>
                              {auxFiles.map(aux => (
                                <div key={aux.name} className="dm-ls-key-row" style={{ padding: "2px 8px" }}>
                                  <span className="dm-storage-badge dm-badge-unknown" title="SQLite 辅助文件" style={{ background: "var(--border)", color: "var(--text-secondary)", fontSize: 10 }}>aux</span>
                                  <code className="dm-ls-key-name" style={{ color: "var(--text-secondary)", fontSize: 12 }}>{aux.name}</code>
                                  <span className="dm-ls-key-summary">{formatSize(aux.size)}</span>
                                  <button
                                    className="dm-ls-delete-btn"
                                    disabled={deleting}
                                    onClick={() => setConfirmDelete(aux.name)}
                                    title="删除此辅助文件"
                                    style={{ fontSize: 11, opacity: 0.6 }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : !content ? (
                            <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--text-secondary)" }}>
                              （加载中...）
                            </div>
                          ) : isObj ? (
                            Object.entries(content as Record<string, unknown>).map(([k, v]) => (
                              <JsonNode key={k} name={k} value={v} path={`file\0${entry.name}\0${k}`} expanded={expandedNodes} onToggle={toggleNode} />
                            ))
                          ) : (
                            <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                              {String(content)}
                            </div>
                          )}
                        </div>
                      )}
                      {confirmDelete === entry.name && (
                        <ConfirmDialog
                          title="确认删除"
                          desc={`确定删除 <code>${entry.name}</code>？此操作不可恢复。`}
                          onCancel={() => setConfirmDelete(null)}
                          onConfirm={() => handleDelete(entry.name)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* 清空表数据确认弹窗 */}
      {confirmClearTable && (
        <ConfirmDialog
          title="清空表数据"
          desc={`确定清空表 <code>${confirmClearTable.tableName}</code> 的全部数据（${dbTablesMap[confirmClearTable.dbRelPath]?.find(t => t.name === confirmClearTable.tableName)?.row_count ?? 0} 行）？此操作不可恢复。`}
          onCancel={() => setConfirmClearTable(null)}
          onConfirm={() => handleClearDbTable(confirmClearTable.dbRelPath, confirmClearTable.tableName)}
        />
      )}

      {/* 清空全部后端数据弹窗 */}
      {clearAllBackendConfirm && (() => {
        const dbCount = files.filter(f => dbRegFileNames.has(f.name)).length;
        const delCount = files.length - dbCount;
        return (
          <ConfirmDialog
            title="清空全部后端数据"
            desc={dbCount > 0
              ? `将删除 ${delCount} 个文件（共 ${files.length} 个）。` +
                `另有 ${dbCount} 个数据库文件正在使用，无法删除。` +
                `此操作不可恢复。`
              : `确定清空所有后端数据文件（共 ${files.length} 个）？` +
                `此操作不可恢复，浏览器配置、主题配置等将被删除。`}
            onCancel={() => setClearAllBackendConfirm(false)}
            onConfirm={handleClearAllBackend}
          />
        );
      })()}

      {/* 清空全部后端数据弹窗 */}
    </>
  );
}

// ============================================================
// 数据库文件内容展示（表列表）
// ============================================================

function DbFileContent({
  fileName,
  dbTablesMap,
  dbTablesLoading,
  dbOperating,
  onClearTable,
}: {
  fileName: string;
  dbTablesMap: Record<string, DbTableInfo[]>;
  dbTablesLoading: Record<string, boolean>;
  dbOperating: boolean;
  onClearTable: (tableName: string) => void;
}) {
  const isLoading = dbTablesLoading[fileName];
  const tables = dbTablesMap[fileName];

  if (isLoading) {
    return (
      <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--text-secondary)" }}>
        加载表信息...
      </div>
    );
  }

  if (!tables || tables.length === 0) {
    return (
      <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--text-secondary)" }}>
        {tables ? "（无用户表）" : "加载失败"}
      </div>
    );
  }

  return (
    <table className="dm-db-table">
      <thead>
        <tr>
          <th>表名</th>
          <th style={{ textAlign: "right" }}>行数</th>
          <th style={{ width: 80 }}></th>
        </tr>
      </thead>
      <tbody>
        {tables.map(t => (
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
                  onClearTable(t.name);
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
  );
}
