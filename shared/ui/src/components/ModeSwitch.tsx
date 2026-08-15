import { type JSX, type ReactNode, type WheelEvent as ReactWheelEvent, useCallback } from "react";

export interface ModeSwitchProps {
  autoMode: "visible" | "api";
  setAutoMode: (mode: "visible" | "api") => void;
  running?: boolean;
  children?: ReactNode;
}

/**
 * ModeSwitch —— 自动化模式切换容器，收敛 003 appkit-compat / 004 本地两份实现。
 * 提供「可视化」和「后台 (API)」两种模式的切换按钮，
 * 支持滚轮切换（向上→可视化，向下→后台），容器内任意位置滚轮均生效。
 * 样式沿用本地类名 mode-switch*。
 */
export function ModeSwitch({ autoMode, setAutoMode, running = false, children }: ModeSwitchProps): JSX.Element {
  const handleWheel = useCallback(
    (e: ReactWheelEvent) => {
      if (running) return;
      if (e.deltaY > 0 && autoMode === "visible") setAutoMode("api");
      else if (e.deltaY < 0 && autoMode === "api") setAutoMode("visible");
    },
    [autoMode, setAutoMode, running],
  );

  return (
    <div className="mode-switch" onWheel={handleWheel}>
      <div className="mode-switch-left">
        <span className="mode-switch-label">自动化模式</span>
        <div className="mode-switch-buttons">
          <button
            className={`mode-switch-btn${autoMode === "visible" ? " active" : ""}`}
            disabled={running}
            title={running ? "自动化运行中，无法切换" : "打开浏览器窗口执行操作，适合调试和检查"}
            onClick={() => setAutoMode("visible")}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            可视化
          </button>
          <button
            className={`mode-switch-btn${autoMode === "api" ? " active" : ""}`}
            disabled={running}
            title={running ? "自动化运行中，无法切换" : "通过 API 静默运行，速度快、无窗口干扰"}
            onClick={() => setAutoMode("api")}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            后台 (API)
          </button>
        </div>
      </div>
      <div className="mode-switch-right">{children}</div>
    </div>
  );
}
