import { Button } from "../controls/Button";

// ════════════════════════════════════════════
//  紫鸟 CDP patch 状态卡片（应用内无痕化）
// ════════════════════════════════════════════

export interface ZiniaoPatchState {
  supported: boolean;
  loading: boolean;
  patching: boolean;
  patched: boolean;
  v109: boolean;
  /** 架构类型：patch（v6.25.16 系需补丁）/ native（6.24.2 系原生支持） */
  arch: string;
  detail: string;
}

export function ZiniaoPatchCard({
  state,
  onApply,
}: {
  state: ZiniaoPatchState;
  onApply: () => void;
}) {
  const native = state.arch === "native";
  return (
    <div className={`ziniao-patch-card ${native || state.patched ? 'ok' : 'warn'}`}>
      <div className="ziniao-patch-info">
        <div className="ziniao-patch-title">
          <span className={`ziniao-patch-dot ${native || state.patched ? 'ok' : 'warn'}`} />
          {state.loading
            ? '检测中…'
            : native
              ? '新架构（6.24.2+）原生支持，无需补丁'
              : state.v109
                ? '补丁 v10.9 已生效（CDP 多开 + agent_mode 直开环境）'
                : state.patched
                  ? '补丁 v10.8 已生效（CDP 多开，可升级 v10.9）'
                  : 'CDP 多开补丁未安装'}
        </div>
        {!state.loading && <div className="ziniao-patch-detail">{state.detail}</div>}
      </div>
      {!state.v109 && !native && (
        <Button
          variant="primary"
          size="sm"
          disabled={state.loading || state.patching}
          onClick={onApply}
        >
          {state.patching ? '安装中…' : state.patched ? '升级到 v10.9' : '一键安装'}
        </Button>
      )}
    </div>
  );
}
