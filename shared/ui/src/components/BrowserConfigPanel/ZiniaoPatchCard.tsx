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
  detail: string;
}

export function ZiniaoPatchCard({
  state,
  onApply,
}: {
  state: ZiniaoPatchState;
  onApply: () => void;
}) {
  return (
    <div className={`ziniao-patch-card ${state.patched ? 'ok' : 'warn'}`}>
      <div className="ziniao-patch-info">
        <div className="ziniao-patch-title">
          <span className={`ziniao-patch-dot ${state.patched ? 'ok' : 'warn'}`} />
          {state.loading
            ? '检测中…'
            : state.v109
              ? '补丁 v10.9 已生效（CDP 多开 + agent_mode 直开环境）'
              : state.patched
                ? '补丁 v10.8 已生效（CDP 多开，可升级 v10.9）'
                : 'CDP 多开补丁未安装'}
        </div>
        {!state.loading && <div className="ziniao-patch-detail">{state.detail}</div>}
      </div>
      {!state.v109 && (
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
