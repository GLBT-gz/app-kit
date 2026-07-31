import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { saveFile } from "../api";
import { getGroupedDataItems, isLocalStorageKeyRegistered } from "../data";
import type { RegisteredDataItem } from "../data";
import { safeGetJSON, safeSetJSON, safeRemoveJSON, LS_KEYS } from "../localStorageKeys";
import { TabBar } from "./TabBar";
import type { TabItem } from "./TabBar";
import { isPlainObject, tryParseJSON, formatValue, typeTag, JsonNode, ConfirmDialog } from "./JsonTree";
import { LocalFiles } from "./LocalFiles";

// ============================================================
// 主组件 — 2 个 Tab：本地存储 | 本地文件
// ============================================================

type DataTab = "storage" | "local";

const DATA_TABS: TabItem[] = [
  { id: "storage", label: "本地存储" },
  { id: "local", label: "本地文件" },
];

const SUB_LABEL_MAP: Record<DataTab, string> = {
  storage: "本地存储",
  local: "本地文件",
};

interface DataManagerPanelProps {
  appName?: string;
  onClose?: () => void;
}

export function DataManagerPanel({ appName = "当前应用", onClose }: DataManagerPanelProps) {
  const [tab, setTabState] = useState<DataTab>(() => {
    const saved = safeGetJSON<string>(LS_KEYS.DATA_MGR_SUBTAB);
    if (saved === "本地存储") return "storage";
    if (saved === "本地文件") return "local";
    // 向后兼容：从旧版 NAV_LOCATION 的 3 级路径恢复
    const navPath = safeGetJSON<string[]>(LS_KEYS.NAV_LOCATION) ?? [];
    if (navPath.length >= 3 && navPath[1] === "数据管理") {
      if (navPath[2] === "本地文件") return "local";
      if (navPath[2] === "本地存储") return "storage";
    }
    return "storage";
  });

  const setTab = useCallback((t: string) => {
    const v = t as DataTab;
    setTabState(v);
    const label = SUB_LABEL_MAP[v];
    safeSetJSON(LS_KEYS.DATA_MGR_SUBTAB, label);
    safeSetJSON(LS_KEYS.NAV_LOCATION, ["设置", "数据管理", label]);
  }, []);

  const handleTabWheel = useCallback((e: React.WheelEvent) => {
    const idx = DATA_TABS.findIndex(t => t.id === tab);
    if (e.deltaY > 0) {
      if (idx < DATA_TABS.length - 1) setTab(DATA_TABS[idx + 1].id);
    } else {
      if (idx > 0) setTab(DATA_TABS[idx - 1].id);
    }
  }, [tab, setTab]);

  return (
    <div className="dm-panel">
      <div className="dm-header">
        <div className="dm-header-left">
          <span className="dm-title">数据管理</span>
          <span className="dm-header-app">{appName}</span>
        </div>
        <div className="dm-header-actions">
          {onClose && <button className="modal-close" onClick={onClose}>×</button>}
        </div>
      </div>
      <div onWheel={handleTabWheel}>
        <TabBar tabs={DATA_TABS} activeTab={tab} onTabChange={setTab} />
      </div>
      <div style={{ display: tab === "storage" ? undefined : "none" }}>
        <BrowserStorage />
      </div>
      <div style={{ display: tab === "local" ? undefined : "none" }}>
        <LocalFiles />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
//  快照系统
// ════════════════════════════════════════════

const SNAPSHOT_KEY = "core-snapshots";
const MAX_SNAPSHOTS = 5;

interface SnapshotEntry {
  timestamp: number;
  label: string;
  data: Record<string, string>;
}

function getSnapshots(): SnapshotEntry[] {
  return safeGetJSON<SnapshotEntry[]>(SNAPSHOT_KEY) ?? [];
}

/** 保存当前 localStorage 全量快照（不含快照自身），最多保留 MAX_SNAPSHOTS 个 */
function saveSnapshot(label: string): void {
  const data: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== SNAPSHOT_KEY) {
        const v = localStorage.getItem(k);
        if (v !== null) data[k] = v;
      }
    }
  } catch { /* 静默 */ }
  const entry: SnapshotEntry = { timestamp: Date.now(), label, data };
  const existing = getSnapshots();
  existing.unshift(entry);
  if (existing.length > MAX_SNAPSHOTS) existing.length = MAX_SNAPSHOTS;
  safeSetJSON(SNAPSHOT_KEY, existing);
}

// ════════════════════════════════════════════

function BrowserStorage() {
  // ── 清理自身旧的 localStorage 内部状态 ──
  useEffect(() => {
    const dmKeys = ["__dm_expanded_keys", "__dm_expanded_nodes", "__dm_expanded_files", "__dm_expanded_file_nodes"];
    for (const k of dmKeys) { try { localStorage.removeItem(k); } catch { /* skip */ } }
  }, []);

  // ── 注册表中获取结构 ──
  const grouped = getGroupedDataItems().filter(g =>
    g.items.some(i => i.storage === "localStorage"),
  );

  // ── 扫描所有 localStorage key ──
  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  // 解析缓存：key → { raw, parsed }，raw 未变时跳过重复 tryParseJSON
  const parsedCacheRef = useRef<Map<string, { raw: string; parsed: unknown }>>(new Map());

  const allEntries = useMemo(() => {
    const result: { key: string; raw: string; parsed: unknown }[] = [];
    const cache = parsedCacheRef.current;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        // 跳过内部状态 key（DataManager 自己记住的展开/折叠）
        if (k.startsWith("__dm_")) continue;
        const raw = localStorage.getItem(k) ?? "";
        // 命中缓存且 raw 未变 → 复用已解析的值，跳过 tryParseJSON
        const cached = cache.get(k);
        if (cached && cached.raw === raw) {
          result.push({ key: k, raw, parsed: cached.parsed });
        } else {
          const parsed = tryParseJSON(raw);
          cache.set(k, { raw, parsed });
          result.push({ key: k, raw, parsed });
        }
      }
    } catch { /* ignore */ }
    result.sort((a, b) => a.key.localeCompare(b.key));
    return result;
  }, [refreshKey]);

  // ── 计算最长 key 名，用于两列对齐 ──
  const allKeyNames = useMemo(() => {
    const names = new Set<string>();
    for (const g of grouped) {
      for (const item of g.items) {
        if (item.storage === "localStorage") names.add(item.key);
      }
    }
    for (const entry of allEntries) {
      names.add(entry.key);
    }
    return [...names];
  }, [grouped, allEntries]);

  const longestKeyName = useMemo(() => {
    return allKeyNames.reduce((a, b) => a.length >= b.length ? a : b, "") || "key";
  }, [allKeyNames]);

  const [keyColWidth, setKeyColWidth] = useState(0);
  const keyMeasureRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (keyMeasureRef.current) {
      setKeyColWidth(keyMeasureRef.current.offsetWidth + 8);
    }
  }, [longestKeyName]);

  // 分离注册和未注册的 key
  const unregisteredEntries = allEntries.filter(e => !isLocalStorageKeyRegistered(e.key));

  // ── 展开/折叠状态 ──
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  // ── 字段编辑状态 ──
  const [editingFieldPath, setEditingFieldPath] = useState<string | null>(null);
  const [editingFieldValue, setEditingFieldValue] = useState("");

  const handleEditStart = useCallback((path: string, current: string) => {
    setEditingFieldPath(path);
    setEditingFieldValue(current);
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditingFieldPath(null);
    setEditingFieldValue("");
  }, []);

  const handleEditSave = useCallback(() => {
    if (!editingFieldPath) return;
    const parts = editingFieldPath.split("\0");
    const storageKey = parts[1];
    if (!storageKey) { handleEditCancel(); return; }

    try {
      const currentRaw = localStorage.getItem(storageKey);
      if (!currentRaw) { handleEditCancel(); return; }
      const obj = JSON.parse(currentRaw);
      const fieldParts = parts.slice(2);

      let target = obj;
      for (let i = 0; i < fieldParts.length - 1; i++) {
        if (target == null || typeof target !== "object") break;
        target = target[fieldParts[i]];
      }

      if (target != null && typeof target === "object" && fieldParts.length > 0) {
        const lastKey = fieldParts[fieldParts.length - 1];
        if (Array.isArray(target)) {
          const idx = parseInt(lastKey, 10);
          if (!isNaN(idx) && idx >= 0 && idx < target.length) {
            target[idx] = tryParseJSON(editingFieldValue) ?? editingFieldValue;
          }
        } else {
          target[lastKey] = tryParseJSON(editingFieldValue) ?? editingFieldValue;
        }
      }

      localStorage.setItem(storageKey, JSON.stringify(obj));
      // 同步 jsonCache，避免其他组件通过 safeGetJSON 读到过期数据
      safeSetJSON(storageKey, obj);
    } catch { /* skip */ }

    handleEditCancel();
    triggerRefresh();
  }, [editingFieldPath, editingFieldValue, handleEditCancel, triggerRefresh]);

  // ── 字段级删除 ──
  const handleFieldDelete = useCallback((path: string) => {
    const parts = path.split("\0");
    const storageKey = parts[1];
    if (!storageKey) return;

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const obj = JSON.parse(raw);
      const fieldParts = parts.slice(2);

      if (fieldParts.length === 0) return; // 防御：path 格式异常

      let parent = obj;
      for (let i = 0; i < fieldParts.length - 1; i++) {
        if (parent == null || typeof parent !== "object") return;
        parent = parent[fieldParts[i]];
      }

      const lastKey = fieldParts[fieldParts.length - 1];
      if (Array.isArray(parent)) {
        const idx = parseInt(lastKey, 10);
        if (!isNaN(idx) && idx >= 0 && idx < parent.length) {
          parent.splice(idx, 1);
        }
      } else if (parent != null && typeof parent === "object") {
        delete parent[lastKey];
      }

      localStorage.setItem(storageKey, JSON.stringify(obj));
      safeSetJSON(storageKey, obj);
    } catch { /* skip */ }

    triggerRefresh();
  }, [triggerRefresh]);

  const toggleKey = useCallback((key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());

  const toggleNode = useCallback((path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // ── 全部展开/折叠 ──
  const collectAllPaths = useCallback((value: unknown, basePath: string, depth = 0, maxDepth = 20): string[] => {
    if (!value || typeof value !== "object") return [];
    if (depth >= maxDepth) return [basePath]; // 深度限制，避免深层嵌套导致栈溢出
    const paths: string[] = [];
    if (Array.isArray(value)) {
      paths.push(basePath);
      value.forEach((v, i) => paths.push(...collectAllPaths(v, `${basePath}\0${i}`, depth + 1, maxDepth)));
    } else {
      paths.push(basePath);
      Object.entries(value).forEach(([k, v]) => paths.push(...collectAllPaths(v, `${basePath}\0${k}`, depth + 1, maxDepth)));
    }
    return paths;
  }, []);

  const expandAll = useCallback(() => {
    const allPaths = new Set<string>();
    for (const entry of allEntries) {
      const isObj = isPlainObject(entry.parsed) || Array.isArray(entry.parsed);
      if (!isObj) continue;
      allPaths.add(entry.key);
      for (const p of collectAllPaths(entry.parsed, `root\0${entry.key}`)) {
        allPaths.add(p);
      }
    }
    setExpandedKeys(prev => {
      const next = new Set(prev);
      for (const k of allPaths) { if (!k.includes("\0")) next.add(k); }
      return next;
    });
    setExpandedNodes(allPaths);
  }, [allEntries, collectAllPaths]);

  const collapseAll = useCallback(() => {
    setExpandedKeys(new Set());
    setExpandedNodes(new Set());
  }, []);

  // ── 删除逻辑 ──
  const [confirmInfo, setConfirmInfo] = useState<{ key: string; behavior: string; desc: string } | null>(null);

  const handleDelete = useCallback((key: string) => {
    saveSnapshot(`删除「${key}」前`);
    safeRemoveJSON(key);
    window.location.reload();
  }, []);

  const requestDelete = useCallback((item: RegisteredDataItem) => {
    const behavior = item.onDelete;
    if (behavior === "blocked") return;
    if (behavior === "allowed") {
      handleDelete(item.key);
      return;
    }
    setConfirmInfo({
      key: item.key,
      behavior,
      desc: `确定删除 <code>${item.key}</code>？此操作不可恢复。`,
    });
  }, [handleDelete]);

  // ── 按类别重置：删除指定类别下所有非 blocked 的已注册项 ──
  const handleClearCategory = useCallback((categoryId: string) => {
    const group = grouped.find(g => g.categoryId === categoryId);
    if (!group) return;
    saveSnapshot(`重置「${group.category.label}」前`);
    for (const item of group.items) {
      if (item.storage === "localStorage" && item.onDelete !== "blocked") {
        safeRemoveJSON(item.key);
      }
    }
    window.location.reload();
  }, [grouped]);

  const [categoryClearConfirm, setCategoryClearConfirm] = useState<{ categoryId: string; label: string; count: number } | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // 自动消除 toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // ── 导出：唤出保存对话框，写入 JSON 备份文件 ──
  const handleExport = useCallback(async () => {
    if (allEntries.length === 0) {
      setToast({ type: "error", text: "没有可导出的数据" });
      return;
    }
    setExporting(true);
    const data: Record<string, unknown> = {};
    for (const entry of allEntries) {
      data[entry.key] = entry.parsed;
    }
    const json = JSON.stringify(data, null, 2);
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const savePath = await save({
        defaultPath: `appkit-backup-${ts}.json`,
        filters: [{ name: "JSON 文件", extensions: ["json"] }],
      });
      if (!savePath) { setExporting(false); return; } // 用户取消保存对话框
      // UTF-8 编码 → Base64 → Rust save_file
      const encoder = new TextEncoder();
      const bytes = encoder.encode(json);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const dataB64 = btoa(binary);
      await saveFile(savePath, dataB64);
      setToast({ type: "success", text: `已导出到 ${savePath}` });
    } catch (e) {
      console.error("[导出] 失败:", e);
      setToast({ type: "error", text: `导出失败：${String(e)}` });
    } finally {
      setExporting(false);
    }
  }, [allEntries]);

  // ── 导入：从 JSON 文件恢复数据 ──
  const handleImportFile = useCallback((file: File) => {
    // 预计算 blocked key 集合
    const blockedKeys = new Set<string>();
    for (const g of grouped) {
      for (const item of g.items) {
        if (item.onDelete === "blocked") blockedKeys.add(item.key);
      }
    }
    let blockedSkipped = 0;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (typeof data !== "object" || Array.isArray(data) || data === null) {
          setToast({ type: "error", text: "导入失败：无效的 JSON 格式" });
          return;
        }
        let imported = 0;
        saveSnapshot("导入数据前");
        for (const [key, value] of Object.entries(data)) {
          // 受保护 key 不允许覆盖
          if (blockedKeys.has(key)) { blockedSkipped++; continue; }
          try {
            safeSetJSON(key, value);
            imported++;
          } catch { /* skip invalid keys */ }
        }
        const blockedMsg = blockedSkipped > 0 ? `，跳过 ${blockedSkipped} 个受保护条目` : "";
        if (imported > 0) {
          setToast({ type: "success", text: `已导入 ${imported} 个条目${blockedMsg}，即将刷新...` });
          setTimeout(() => window.location.reload(), 800);
        } else {
          setToast({ type: "error", text: blockedSkipped > 0 ? `导入失败：${blockedSkipped} 个条目均为受保护数据` : "导入失败：未找到可导入的数据" });
        }
      } catch {
        setToast({ type: "error", text: "导入失败：JSON 解析错误" });
      }
    };
    reader.readAsText(file);
  }, [grouped]);

  const handleImportClick = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleImportFile(file);
    };
    input.click();
  }, [handleImportFile]);

  // ── 快照历史 ──
  const snapshots = useMemo(() => getSnapshots(), [refreshKey]);
  const [restoreSnapshotIndex, setRestoreSnapshotIndex] = useState<number | null>(null);

  const handleRestoreSnapshot = useCallback((index: number) => {
    const shots = getSnapshots();
    const entry = shots[index];
    if (!entry) return;

    // 恢复前自动保存当前状态为安全备份
    saveSnapshot("恢复快照前的自动备份");

    // 预计算 blocked key 集合
    const blockedKeys = new Set<string>();
    for (const g of grouped) {
      for (const item of g.items) {
        if (item.onDelete === "blocked") blockedKeys.add(item.key);
      }
    }

    const snapshotKeySet = new Set(Object.keys(entry.data));
    let cleared = 0;

    // 清除当前存在但快照中不存在的非 blocked key（快照时间点之后新增的）
    // 仅处理 core-/appkit- 前缀 key，避免影响第三方数据
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || k === SNAPSHOT_KEY || blockedKeys.has(k)) continue;
        if (!snapshotKeySet.has(k) && (k.startsWith("core-") || k.startsWith("appkit-"))) {
          localStorage.removeItem(k);
          cleared++;
        }
      }
    } catch { /* skip */ }

    let restored = 0;
    for (const [key, value] of Object.entries(entry.data)) {
      if (blockedKeys.has(key)) continue;
      try {
        // 快照中的 value 是原始 localStorage 字符串，直接用 setItem
        localStorage.setItem(key, value);
        restored++;
      } catch { /* skip */ }
    }

    const detail = [restored > 0 && `恢复 ${restored} 个`, cleared > 0 && `清除 ${cleared} 个`].filter(Boolean).join("，");
    setToast({ type: "success", text: `${detail} 条目，即将刷新...` });
    setTimeout(() => window.location.reload(), 800);
  }, [grouped]);

  // ── 渲染 ──
  const countLeafValues = (v: unknown): number => {
    if (v === null || v === undefined) return 1;
    if (Array.isArray(v)) {
      if (v.length === 0) return 0;
      return v.reduce((sum, item) => sum + countLeafValues(item), 0);
    }
    if (isPlainObject(v)) {
      const keys = Object.keys(v);
      if (keys.length === 0) return 0;
      return keys.reduce((sum, k) => sum + countLeafValues(v![k]), 0);
    }
    return 1;
  };

  const totalCount = grouped
    .flatMap(g => g.items.filter(i => i.storage === "localStorage")).length + unregisteredEntries.length;

  return (
    <>
      <span
        ref={keyMeasureRef}
        style={{ position: "absolute", visibility: "hidden", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" }}
      >
        {longestKeyName}
      </span>
      <div className="dm-toolbar">
        <span className="dm-toolbar-summary">
          共 {totalCount} 个条目
          {unregisteredEntries.length > 0 && `（${unregisteredEntries.length} 个未注册）`}
        </span>
        <div style={{ display: "flex", gap: 4, flex: 1, justifyContent: "flex-end" }}>
          <button className="dm-tool-btn" onClick={expandAll} title="全部展开">全部展开</button>
          <button className="dm-tool-btn" onClick={collapseAll} title="全部折叠">全部折叠</button>
          <button className="dm-tool-btn" onClick={handleExport} disabled={exporting} title="导出所有浏览器存储数据为 JSON 备份文件">{exporting ? "导出中..." : "导出"}</button>
          <button className="dm-tool-btn" onClick={() => setImportConfirm(true)} title="从 JSON 备份文件恢复数据">导入</button>
        </div>
      </div>

      <div className="dm-ls-list">
        {grouped.map(group => {
          const localItems = group.items.filter(i => i.storage === "localStorage");
          if (localItems.length === 0) return null;

          return (
            <div key={group.categoryId} className="dm-category-group">
              <div className="dm-category-header">
                <span className="dm-category-label">{group.category.label}</span>
                <span className={`dm-category-behavior dm-behavior-${group.category.onDelete}`}>
                  {group.category.onDelete === "warn" && "删除需确认"}
                  {group.category.onDelete === "allowed" && "可随意删除"}
                  {group.category.onDelete === "blocked" && "不可删除"}
                </span>
                {localItems.filter(i => i.onDelete !== "blocked").length > 0 && (
                  <button
                    className="dm-category-reset-btn"
                    onClick={() => setCategoryClearConfirm({
                      categoryId: group.categoryId,
                      label: group.category.label,
                      count: localItems.filter(i => i.onDelete !== "blocked").length,
                    })}
                    title={`重置「${group.category.label}」类别，所有条目恢复默认值`}
                  >
                    重置
                  </button>
                )}
              </div>

              {localItems.map(item => {
                const entry = allEntries.find(e => e.key === item.key);
                const raw = entry?.raw ?? null;
                const parsed = entry?.parsed;
                const currentValue = raw !== null ? parsed ?? raw : item.default;
                const isObj = isPlainObject(currentValue) || Array.isArray(currentValue);
                const expanded = expandedKeys.has(item.key);

                return (
                  <div key={item.key} className="dm-ls-entry">
                    <div className="dm-ls-key-row">
                      <span
                        className="dm-ls-key-icon"
                        onClick={() => isObj && toggleKey(item.key)}
                        style={{
                          cursor: isObj ? "pointer" : "default",
                          visibility: isObj ? "visible" : "hidden",
                        }}
                      >
                        {isObj ? (expanded ? "▼" : "▶") : "·"}
                      </span>
                      <span className="dm-storage-badge dm-badge-ls" title="localStorage">LS</span>
                      <code className="dm-ls-key-name" style={{ minWidth: keyColWidth || undefined }}>{item.key}</code>
                      <span className="dm-ls-key-desc" title={item.desc}>{item.desc}</span>
                      <span className="dm-ls-key-summary">
                        {expanded ? "" : (entry ? formatValue(currentValue) : <span className="dm-empty-tag">已清空</span>)}
                      </span>
                      <button
                        className="dm-ls-delete-btn"
                        disabled={item.onDelete === "blocked"}
                        onClick={() => requestDelete(item)}
                        title={item.onDelete === "blocked" ? "此数据不可删除" : "删除此数据"}
                      >
                        ✕
                      </button>
                    </div>

                    {isObj && expanded && (
                      <div className="jv-body">
                        {(() => {
                          const entries = Array.isArray(currentValue)
                            ? (currentValue as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
                            : Object.entries(currentValue as Record<string, unknown>);
                          let maxKvChars = 0;
                          for (const [k, v] of entries) {
                            const chars = k.length + 2 + 2 + formatValue(v).length;
                            if (chars > maxKvChars) maxKvChars = chars;
                          }
                          const kvMinWidthCh = maxKvChars > 0 ? maxKvChars + 2 : undefined;
                          return entries.map(([k, v]) => (
                            <JsonNode key={k} name={k} value={v} path={`root\0${item.key}\0${k}`} expanded={expandedNodes} onToggle={toggleNode}
                              editingPath={editingFieldPath} editValue={editingFieldValue}
                              onEditChange={setEditingFieldValue} onEditStart={handleEditStart} onEditCancel={handleEditCancel} onEditSave={handleEditSave}
                              fieldDescriptions={item.fieldDescriptions} onFieldDelete={handleFieldDelete} kvMinWidthCh={kvMinWidthCh} />
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {unregisteredEntries.length > 0 && (
          <div className="dm-category-group">
            <div className="dm-category-header" style={{ color: "#d4a017" }}>
              <span className="dm-category-label">未注册数据</span>
              <span className="dm-category-behavior dm-behavior-unregistered">
                未注册
              </span>
            </div>

            {unregisteredEntries.map(entry => {
              const isObj = isPlainObject(entry.parsed) || Array.isArray(entry.parsed);
              const expanded = expandedKeys.has(entry.key);

              return (
                <div key={entry.key} className="dm-ls-entry">
                  <div className="dm-ls-key-row">
                    <span
                      className="dm-ls-key-icon"
                      onClick={() => isObj && toggleKey(entry.key)}
                      style={{
                        cursor: isObj ? "pointer" : "default",
                        visibility: isObj ? "visible" : "hidden",
                      }}
                    >
                      {isObj ? (expanded ? "▼" : "▶") : "·"}
                    </span>
                    <span className="dm-storage-badge dm-badge-unknown" title="localStorage（未注册）">?</span>
                    <code className="dm-ls-key-name" style={{ minWidth: keyColWidth || undefined, color: "var(--text-secondary)" }}>{entry.key}</code>
                    <span className="dm-ls-key-summary">{typeTag(entry.parsed)}</span>
                    <button
                      className="dm-ls-delete-btn"
                      onClick={() => {
                        setConfirmInfo({
                          key: entry.key,
                          behavior: "allowed",
                          desc: `确定删除 <code>${entry.key}</code>？此操作不可恢复。`,
                        });
                      }}
                      title="删除此数据"
                    >
                      ✕
                    </button>
                  </div>

                  {isObj && expanded && (
                    <div className="jv-body">
                      {Array.isArray(entry.parsed)
                        ? (entry.parsed as unknown[]).map((v, i) => (
                            <JsonNode key={i} name={String(i)} value={v} path={`root\0${entry.key}\0${i}`} expanded={expandedNodes} onToggle={toggleNode}
                              editingPath={editingFieldPath} editValue={editingFieldValue}
                              onEditChange={setEditingFieldValue} onEditStart={handleEditStart} onEditCancel={handleEditCancel} onEditSave={handleEditSave}
                              onFieldDelete={handleFieldDelete} />
                          ))
                        : Object.entries(entry.parsed as Record<string, unknown>).map(([k, v]) => (
                            <JsonNode key={k} name={k} value={v} path={`root\0${entry.key}\0${k}`} expanded={expandedNodes} onToggle={toggleNode}
                              editingPath={editingFieldPath} editValue={editingFieldValue}
                              onEditChange={setEditingFieldValue} onEditStart={handleEditStart} onEditCancel={handleEditCancel} onEditSave={handleEditSave}
                              onFieldDelete={handleFieldDelete} />
                          ))
                      }
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {allEntries.length === 0 && (
          <div className="dm-empty">暂无数据</div>
        )}
      </div>

      {snapshots.length > 0 && (
        <div className="dm-category-group" style={{ marginTop: 16, borderTop: "2px solid rgba(139, 92, 246, 0.3)" }}>
          <div className="dm-category-header" style={{ color: "#a78bfa" }}>
            <span className="dm-category-label">快照历史</span>
            <span className="dm-category-behavior" style={{ color: "#8b5cf6" }}>
              {snapshots.length}/{MAX_SNAPSHOTS}
            </span>
          </div>
          {snapshots.map((s, i) => {
            const date = new Date(s.timestamp);
            const timeStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
            const keyCount = Object.keys(s.data).length;
            return (
              <div key={s.timestamp} className="dm-ls-entry">
                <div className="dm-ls-key-row">
                  <span className="dm-ls-key-icon" style={{ color: "#a78bfa" }}>●</span>
                  <code className="dm-ls-key-name" style={{ minWidth: "unset", flex: 1, color: "var(--text-secondary)" }}>
                    {timeStr} · {s.label} · {keyCount} 个 key
                  </code>
                  <button
                    className="dm-category-reset-btn"
                    style={{ fontSize: 11, padding: "2px 8px", borderColor: "rgba(139, 92, 246, 0.4)", color: "#a78bfa" }}
                    onClick={() => setRestoreSnapshotIndex(i)}
                    title="恢复到此快照"
                  >
                    恢复
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmInfo && (
        <ConfirmDialog
          title="确认删除"
          desc={confirmInfo.desc}
          onCancel={() => setConfirmInfo(null)}
          onConfirm={() => {
            handleDelete(confirmInfo.key);
            setConfirmInfo(null);
          }}
        />
      )}

      {categoryClearConfirm && (
        <ConfirmDialog
          title={`重置「${categoryClearConfirm.label}」`}
          desc={`确定重置「${categoryClearConfirm.label}」类别下的 ${categoryClearConfirm.count} 个条目？所有条目将恢复默认值。`}
          onCancel={() => setCategoryClearConfirm(null)}
          onConfirm={() => {
            const catId = categoryClearConfirm.categoryId;
            setCategoryClearConfirm(null);
            handleClearCategory(catId);
          }}
        />
      )}

      {importConfirm && (
        <ConfirmDialog
          title="导入数据"
          desc="选择 JSON 备份文件导入浏览器存储数据。同名 key 将被覆盖，不可恢复。确定继续？"
          onCancel={() => setImportConfirm(false)}
          onConfirm={() => {
            setImportConfirm(false);
            handleImportClick();
          }}
        />
      )}

      {restoreSnapshotIndex !== null && (
        <ConfirmDialog
          title="恢复快照"
          desc="恢复后将覆盖当前所有浏览器存储数据为快照时间点的状态。确定恢复？"
          onCancel={() => setRestoreSnapshotIndex(null)}
          onConfirm={() => {
            const idx = restoreSnapshotIndex;
            setRestoreSnapshotIndex(null);
            handleRestoreSnapshot(idx);
          }}
        />
      )}

      {toast && (
        <div
          className={`dm-toast dm-toast-${toast.type}`}
          onClick={() => setToast(null)}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}
