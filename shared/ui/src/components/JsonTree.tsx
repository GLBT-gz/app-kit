// ============================================================
// 工具函数
// ============================================================
import { Button } from "./controls/Button";

export function tryParseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function typeTag(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (isPlainObject(v)) return `Object(${Object.keys(v).length})`;
  return typeof v;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (isPlainObject(v)) return `{…}`;
  return String(v);
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
    // 通知同标签页的 useData hook 重新读取（同标签页不触发 StorageEvent）
    window.dispatchEvent(new CustomEvent("ls-changed", { detail: { key } }));
  } catch { /* 静默失败 */ }
}

// ============================================================
// JSON 树节点组件
// ============================================================

export interface JsonNodeProps {
  name: string | null;
  value: unknown;
  path: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onEdit?: (path: string, newValue: string) => void;
  editingPath?: string | null;
  editValue?: string;
  onEditChange?: (v: string) => void;
  onEditStart?: (path: string, current: string) => void;
  onEditCancel?: () => void;
  onEditSave?: () => void;
  /** 字段级描述映射 */
  fieldDescriptions?: Record<string, string>;
  /** 字段级删除回调。提供此回调时会在行末显示 ✕ 按钮 */
  onFieldDelete?: (path: string) => void;
  /**
   * 同级 key:value 展示的最小宽度（ch 单位）。
   * 设置后，jv-kv-block 会使用此 min-width，使所有字段的描述在同一列对齐。
   */
  kvMinWidthCh?: number;
}

export function formatPrimitive(v: unknown): { text: string; className: string } {
  if (v === null) return { text: "null", className: "jv-null" };
  if (typeof v === "string") return { text: `"${v}"`, className: "jv-string" };
  if (typeof v === "number") return { text: String(v), className: "jv-number" };
  if (typeof v === "boolean") return { text: String(v), className: "jv-boolean" };
  return { text: String(v), className: "jv-other" };
}

export function JsonNode({ name, value, path, expanded, onToggle, onEdit, editingPath, editValue, onEditChange, onEditStart, onEditCancel, onEditSave, fieldDescriptions, onFieldDelete, kvMinWidthCh }: JsonNodeProps) {
  const collapsible = isPlainObject(value) || Array.isArray(value);
  const isExpanded = expanded.has(path);
  const isEditing = editingPath === path;
  const prim = formatPrimitive(value);

  const summary = collapsible
    ? (Array.isArray(value) ? `Array(${value.length})` : `Object(${Object.keys(value as Record<string, unknown>).length})`)
    : "";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onEditSave?.();
    if (e.key === "Escape") onEditCancel?.();
  };

  return (
    <div className="jv-node">
      <div
        className="jv-row"
        onClick={() => collapsible && onToggle(path)}
        style={{ cursor: collapsible ? "pointer" : "default" }}
      >
        <span className="jv-kv-block" style={kvMinWidthCh ? { minWidth: `${kvMinWidthCh}ch` } : undefined}>
          <span className="jv-arrow" style={{ visibility: collapsible ? "visible" : "hidden" }}>
            {collapsible ? (isExpanded ? "▼" : "▶") : ""}
          </span>
          {name !== null && <span className="jv-key">"{name}"</span>}
          {name !== null && !Array.isArray(value) && !isPlainObject(value) && (
            <span className="jv-sep">: </span>
          )}
          {(!collapsible || !isExpanded) && (
            collapsible ? (
              <span className="jv-summary">{summary}</span>
            ) : isEditing ? (
              <input
                className="jv-edit-input"
                value={editValue ?? ""}
                onChange={e => onEditChange?.(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={onEditSave}
                autoFocus
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span
                className={`jv-val ${prim.className}`}
                onClick={e => {
                  e.stopPropagation();
                  if (!collapsible && onEditStart) {
                    const display = value === null ? "null" : typeof value === "string" ? value : JSON.stringify(value);
                    onEditStart(path, display);
                  }
                }}
                style={{ cursor: "text" }}
              >
                {prim.text}
              </span>
            )
          )}
        </span>
        {name !== null && fieldDescriptions?.[name] && (
          <span className="jv-field-desc" title={fieldDescriptions[name]}>{fieldDescriptions[name]}</span>
        )}
        {onFieldDelete && name !== null && (
          <button className="jv-del-btn" onClick={e => { e.stopPropagation(); onFieldDelete(path); }} title="删除此字段">✕</button>
        )}
      </div>
      {collapsible && isExpanded && (
        <div className="jv-children">
          {!Array.isArray(value)
            ? Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                <JsonNode key={k} name={k} value={v} path={`${path}\0${k}`} expanded={expanded} onToggle={onToggle}
                  onEdit={onEdit} editingPath={editingPath} editValue={editValue}
                  onEditChange={onEditChange} onEditStart={onEditStart} onEditCancel={onEditCancel} onEditSave={onEditSave}
                  fieldDescriptions={fieldDescriptions} onFieldDelete={onFieldDelete} kvMinWidthCh={kvMinWidthCh} />
              ))
            : (value as unknown[]).map((v, i) => (
                <JsonNode key={i} name={String(i)} value={v} path={`${path}\0${i}`} expanded={expanded} onToggle={onToggle}
                  onEdit={onEdit} editingPath={editingPath} editValue={editValue}
                  onEditChange={onEditChange} onEditStart={onEditStart} onEditCancel={onEditCancel} onEditSave={onEditSave}
                  fieldDescriptions={fieldDescriptions} onFieldDelete={onFieldDelete} kvMinWidthCh={kvMinWidthCh} />
              ))
          }
        </div>
      )}
    </div>
  );
}

// ============================================================
// 确认删除弹窗
// ============================================================

export interface ConfirmDialogProps {
  title: string;
  desc: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ title, desc, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, lineHeight: 1.8, fontSize: 13 }}>{desc}</p>
        </div>
        <div className="modal-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="danger" onClick={onConfirm}>确认删除</Button>
        </div>
      </div>
    </div>
  );
}
