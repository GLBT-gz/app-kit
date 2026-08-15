import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { safeGetJSON, safeSetJSON } from "../localStorageKeys";
import { Button } from "./controls/Button";

export interface ShortcutDef {
  id: string;
  label: string;
  defaultKeys: string;
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { id: "back-to-home", label: "返回首页", defaultKeys: "Esc" },
  { id: "toggle-settings", label: "打开设置", defaultKeys: "Ctrl+e" },
  { id: "toggle-pin", label: "切换窗口置顶", defaultKeys: "Ctrl+t" },
  { id: "toggle-theme", label: "切换白天/黑夜", defaultKeys: "Ctrl+q" },
];

const BUILTIN_SHORTCUTS: { label: string; keys: string }[] = [
  { label: "刷新当前页面", keys: "Ctrl+r" },
];

/**
 * 读取已保存的快捷键配置（可能包含空值表示禁用）。
 * 如果从未保存过，写入默认值（含注册的额外快捷键）并返回。
 */
function loadShortcuts(extraShortcuts: ShortcutDef[] = []): Record<string, string> {
  const saved = safeGetJSON<Record<string, string>>("core-shortcuts");
  if (saved === null) {
    // 首次使用：写入完整默认值，确保 DataManager 能看到全部条目
    const defaults: Record<string, string> = {};
    for (const def of [...DEFAULT_SHORTCUTS, ...extraShortcuts]) {
      defaults[def.id] = def.defaultKeys;
    }
    safeSetJSON("core-shortcuts", defaults);
    return defaults;
  }
  return saved;
}

/**
 * 保存完整快捷键映射（含默认值），确保 DataManager 看到全部条目。
 */
function saveFullShortcuts(map: Record<string, string>) {
  safeSetJSON("core-shortcuts", map);
}

/**
 * 获取生效的快捷键（已保存值兜底到默认值）。
 * extraShortcuts：项目注册的额外快捷键，未保存时兜底到各自默认值。
 */
export function getEffectiveShortcuts(extraShortcuts: ShortcutDef[] = []): Record<string, string> {
  const saved = loadShortcuts(extraShortcuts);
  const map: Record<string, string> = {};
  for (const def of [...DEFAULT_SHORTCUTS, ...extraShortcuts]) {
    map[def.id] = saved[def.id] ?? def.defaultKeys;
  }
  return map;
}

export function ShortcutsPanel({ extraShortcuts = [] }: { extraShortcuts?: ShortcutDef[] }) {
  // 初始化为完整生效图
  const [shortcuts, setShortcuts] = useState<Record<string, string>>(() => getEffectiveShortcuts(extraShortcuts));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const allDefs = useMemo(() => [...DEFAULT_SHORTCUTS, ...extraShortcuts], [extraShortcuts]);

  useEffect(() => {
    if (recording && inputRef.current) {
      inputRef.current.focus();
    }
  }, [recording]);

  const startRecording = useCallback((id: string) => {
    setEditingId(id);
    setRecording(true);
  }, []);

  const commitMap = useCallback((next: Record<string, string>) => {
    setShortcuts(next);
    saveFullShortcuts(next);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (editingId === null) return;

    // Escape 取消录制，不当作快捷键
    if (e.key === "Escape") {
      cancelEditing();
      return;
    }

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");

    const key = e.key;
    if (!["Control", "Shift", "Alt", "Meta"].includes(key)) {
      const mapped = key === "Escape" ? "Esc" : key === " " ? "Space" : key.length === 1 ? key.toLowerCase() : key;
      parts.push(mapped);
    }

    if (parts.length > 0 && !["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
      const combo = parts.join("+");
      commitMap({ ...shortcuts, [editingId]: combo });
      setEditingId(null);
      setRecording(false);
    }
  }, [editingId, shortcuts, commitMap]);

  /** 重置为默认值 */
  const resetShortcut = useCallback((id: string) => {
    const def = allDefs.find(d => d.id === id);
    commitMap({ ...shortcuts, [id]: def?.defaultKeys ?? "" });
  }, [shortcuts, commitMap, allDefs]);

  /** 清除快捷键（设为禁用） */
  const clearShortcut = useCallback((id: string) => {
    commitMap({ ...shortcuts, [id]: "" });
  }, [shortcuts, commitMap]);

  /** 恢复全部默认 */
  const resetAll = useCallback(() => {
    const defaults: Record<string, string> = {};
    for (const def of allDefs) {
      defaults[def.id] = def.defaultKeys;
    }
    commitMap(defaults);
  }, [commitMap, allDefs]);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setRecording(false);
  }, []);

  const formatKeys = (keys: string) => {
    if (!keys) {
      return <span className="shortcut-disabled">（未设置）</span>;
    }
    // 将字母键转为大写，如 "Ctrl+e" → "Ctrl+E"
    const formatted = keys.replace(/\+([a-z])$/, (_, c) => '+' + c.toUpperCase());
    return <kbd>{formatted}</kbd>;
  };

  return (
    <div className="settings-section shortcuts-panel">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">快捷键设置</h3>
        </div>
        <Button size="sm" onClick={resetAll} title="所有快捷键恢复为默认值">
          恢复默认
        </Button>
      </div>
      <div className="shortcuts-list">
        {allDefs.map(def => (
          <div key={def.id} className="shortcut-row">
            <span className="shortcut-label">{def.label}</span>
            <div className="shortcut-input-wrapper">
              {editingId === def.id ? (
                <input
                  ref={inputRef}
                  className="shortcut-input recording"
                  onKeyDown={handleKeyDown}
                  onBlur={cancelEditing}
                  placeholder="按下快捷键..."
                  readOnly
                  autoFocus
                />
              ) : (
                <button
                  className="shortcut-input"
                  onClick={() => startRecording(def.id)}
                  title="点击修改快捷键"
                >
                  {formatKeys(shortcuts[def.id] ?? def.defaultKeys)}
                </button>
              )}
              {/* ✕ 清除按钮：始终显示 */}
              <button
                className="shortcut-action-btn"
                onClick={() => clearShortcut(def.id)}
                title="清除此快捷键"
              >
                ✕
              </button>
              {/* ↺ 重置按钮：仅当不同于默认值时显示 */}
              {(shortcuts[def.id] && shortcuts[def.id] !== def.defaultKeys) && (
                <button
                  className="shortcut-action-btn"
                  onClick={() => resetShortcut(def.id)}
                  title="重置为默认值"
                >
                  ↺
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="shortcuts-builtin">
        <h4>系统默认快捷键</h4>
        <div className="shortcuts-builtin-inner">
          {BUILTIN_SHORTCUTS.map((s, i) => (
            <div key={i} className="shortcut-row">
              <span className="shortcut-label">{s.label}</span>
              {formatKeys(s.keys)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
