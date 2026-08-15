import { useState } from "react";
import { Button } from "../controls/Button";

// ════════════════════════════════════════════
//  新增用户 Modal（UI 状态自包含，创建逻辑由父组件 onSubmitted 执行）
// ════════════════════════════════════════════

export function NewUserModal({
  browserName,
  defaultParentDir,
  onBrowseDirectory,
  onSubmitted,
  onClose,
}: {
  browserName: string;
  defaultParentDir: string;
  onBrowseDirectory?: () => Promise<string | string[] | null>;
  onSubmitted: (name: string, parentDir: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [customParentDir, setCustomParentDir] = useState("");
  const [creating, setCreating] = useState(false);

  const resetAndClose = () => { setName(""); setCustomParentDir(""); onClose(); };

  const doCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await onSubmitted(name, customParentDir);
      setName("");
      setCustomParentDir("");
      onClose();
    } catch {
      // 错误提示由 onSubmitted 内部以 toast 呈现
    } finally {
      setCreating(false);
    }
  };

  // 与后端 sanitize_dir_name 保持一致，用于预览显示
  const sanitizeDirName = (n: string) => n.replace(/[<>:"/\\|?*\n\r]/g, '_').trim();

  return (
    <div className="modal-overlay" onClick={() => { if (!creating) resetAndClose(); }}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>新增浏览器用户</h3>
          <button className="modal-close" onClick={resetAndClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="config-field"><label>浏览器类型</label><input type="text" className="config-input" value={browserName} disabled /></div>
          <div className="config-field" style={{ marginTop: 12 }}>
            <label>用户目录名称</label>
            <input type="text" className="config-input" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && !creating && doCreate()} placeholder="例如: Work、Personal、Shopping" disabled={creating} autoFocus />
          </div>
          <div className="config-field" style={{ marginTop: 12 }}>
            <label>创建位置（可自定义）</label>
            <div className="config-dir-row">
              <div className="config-dir-input-wrap">
                <input
                  type="text" className="config-input"
                  value={customParentDir || defaultParentDir}
                  onChange={e => setCustomParentDir(e.target.value)}
                  placeholder="选择或输入目标目录"
                  disabled={creating}
                />
              </div>
              {onBrowseDirectory && (
                <button className="config-btn-folder" onClick={async () => {
                  try {
                    const result = await onBrowseDirectory();
                    const dir = Array.isArray(result) ? result[0] : result;
                    if (dir) setCustomParentDir(dir as string);
                  } catch {}
                }} disabled={creating} title="浏览选择目录">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                </button>
              )}
              <div className="config-btn-spacer" />
            </div>
            <code className="cmd-inline">{(customParentDir || defaultParentDir || "（未选择）").replace(/\\+$/, '') + '\\' + (sanitizeDirName(name) || "目录名称")}</code>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="primary" onClick={doCreate} disabled={creating}>{creating ? "创建中..." : "创建并添加"}</Button>
          <Button onClick={resetAndClose} disabled={creating}>取消</Button>
        </div>
      </div>
    </div>
  );
}
