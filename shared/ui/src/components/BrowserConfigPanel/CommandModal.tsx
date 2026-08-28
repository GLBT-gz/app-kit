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
  profile, info, portStr, canLaunch, onClose, onLaunch, runningPort,
}: {
  profile: BCPProfile;
  info: LaunchCommandInfo;
  portStr: string;
  canLaunch: boolean;
  onClose: () => void;
  onLaunch: (p: BCPProfile, portStr: string) => void;
  /** 动态检测到的当前运行端口（可连时传入）；未启动/不可连为 null 时回退 info.debug_port */
  runningPort?: number | null;
}) {
  const livePort = runningPort || (info.debug_port > 0 ? info.debug_port : null);

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
          <div className="cmd-field">
            <label>调试端口</label>
            {runningPort ? (
              <div className="cmd-port-live">
                <code className="cmd-inline">{`--remote-debugging-port=${runningPort}`}</code>
                <span className="cmd-port-live-badge" title="该端口为当前运行实例动态检测所得（每轮 5s 轮询自动刷新）">已连接 · 动态端口</span>
              </div>
            ) : (
              <code className="cmd-inline" style={{ color: "var(--text-secondary)", userSelect: "none" }}>{livePort ? `--remote-debugging-port=${livePort}` : "未指定（正常启动，不带调试端口）"}</code>
            )}
          </div>
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
