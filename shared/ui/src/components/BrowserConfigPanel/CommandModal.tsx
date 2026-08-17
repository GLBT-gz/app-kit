import { Button } from "../controls/Button";
import type { BCPProfile } from "./types";

// ════════════════════════════════════════════
//  启动命令 Modal
// ════════════════════════════════════════════

export interface LaunchCommandInfo {
  exe_path: string;
  args: string[];
  command_line: string;
  debug_port: number;
}

export function CommandModal({
  profile, info, portStr, canLaunch, onClose, onLaunch,
}: {
  profile: BCPProfile;
  info: LaunchCommandInfo;
  portStr: string;
  canLaunch: boolean;
  onClose: () => void;
  onLaunch: (p: BCPProfile, portStr: string) => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>启动命令 — {profile.name}</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="cmd-field"><label>完整命令</label><div className="cmd-box"><code>{info.command_line}</code><button className="cmd-copy" onClick={() => navigator.clipboard.writeText(info.command_line)}>复制</button></div></div>
          <div className="cmd-field"><label>可执行文件</label><code className="cmd-inline">{info.exe_path}</code></div>
          <div className="cmd-field"><label>调试端口</label><code className="cmd-inline" style={{ color: "var(--text-secondary)", userSelect: "none" }}>{info.debug_port > 0 ? `--remote-debugging-port=${info.debug_port}` : "未指定（正常启动，不带调试端口）"}</code></div>
          <div className="cmd-field"><label>参数</label><div className="cmd-args">{info.args.map((arg, i) => <code key={i} className="cmd-arg">{arg}</code>)}</div></div>
        </div>
        <div className="modal-footer">
          {canLaunch && (
            <Button variant="primary" onClick={() => { onLaunch(profile, portStr); onClose(); }}>启动浏览器</Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  );
}
