import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";

// ── 类型定义 ──

/** 日志级别 */
export type LogLevel = "info" | "success" | "error" | "warn" | "step" | "debug";

/** 日志内嵌表格 */
export interface LogTable {
  headers: string[];
  rows: string[][];
}

/** 单条日志条目 */
export interface LogEntry {
  /** 唯一 ID（自增） */
  id: number;
  /** 日志时间戳 */
  timestamp: Date;
  /** 格式化的时间字符串（HH:mm:ss） */
  time: string;
  /** 日志消息 */
  msg: string;
  /** 日志级别 */
  level: LogLevel;
  /** 可选的表格数据 */
  table?: LogTable;
}

/** useLog 钩子返回值 */
export interface UseLogReturn {
  /** 所有日志条目 */
  logs: LogEntry[];
  /** 添加一条日志 */
  log: (msg: string, level?: LogLevel, table?: LogTable) => void;
  /** 清空所有日志 */
  clear: () => void;
  /** 日志列表容器的 ref（用于 auto-scroll） */
  logEndRef: React.RefObject<HTMLDivElement | null>;
  /** 日志总数 */
  count: number;
}

/** LogPanel props */
export interface LogPanelProps {
  /** useLog 返回的对象 */
  log: UseLogReturn;
  /** 面板标题（默认 "运行日志"） */
  title?: string;
  /** 标题右侧额外内容（放在标题同一行左侧区域，即标题右侧） */
  titleExtra?: ReactNode;
  /** 标题栏滚轮事件 */
  onHeaderWheel?: (e: React.WheelEvent) => void;
  /** 底部外边距占位（px，用于适应 sticky 操作栏等，默认 0） */
  bottomPadding?: number;
  /** 自定义空状态提示 */
  emptyText?: string;
  /** 额外操作按钮（显示在标题行右侧） */
  extraActions?: ReactNode;
  /** 是否显示日志条数（默认 true） */
  showCount?: boolean;
  /** 是否隐藏标题栏（用于外部自行渲染一致的头部） */
  hideHeader?: boolean;
  /** 最大高度（px），不设则 flex:1 自适应 */
  maxHeight?: number;
  /** 额外的 CSS class */
  className?: string;
  /** 是否将日志面板折叠/展开（默认 false，不折叠） */
  collapsible?: boolean;
  /** 是否默认折叠（collapsible 为 true 时生效） */
  defaultCollapsed?: boolean;
}

// ── 缓存持久化 ──

interface PersistedLogEntry {
  id: number;
  timestamp: string;
  time: string;
  msg: string;
  level: LogLevel;
  table?: LogTable;
}

interface LogCache {
  date: string;
  logs: PersistedLogEntry[];
}

function getTodayStr(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function logStorageKey(sk: string): string {
  return `log-cache:${sk}`;
}

// ── 工具函数 ──

/** 格式化时间为 HH:mm:ss */
function fmtTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── Hook ──

/**
 * 创建日志状态管理。
 *
 * 支持自动监听 Tauri 事件（payload: { level?, msg? }），
 * 也可以通过返回的 `log()` 函数手动追加。
 *
 * @param options.eventName - 自动监听的事件名，默认 "appkit:progress"。传 null 禁用。
 * @param options.storageKey - 设置后在 localStorage 中持久化日志（当天有效，过期自动清空）
 */
export function useLog(options?: {
  eventName?: string | null;
  storageKey?: string;
}): UseLogReturn {
  const { eventName = "appkit:progress", storageKey } = options ?? {};

  const logIdRef = useRef(0);

  // 从 localStorage 加载缓存（当天有效）
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    if (!storageKey) return [];
    try {
      const raw = localStorage.getItem(logStorageKey(storageKey));
      if (!raw) return [];
      const cache: LogCache = JSON.parse(raw);
      if (cache.date !== getTodayStr()) return [];
      const maxId = cache.logs.reduce((max, l) => Math.max(max, l.id), 0);
      logIdRef.current = maxId;
      return cache.logs.map((l) => ({ ...l, timestamp: new Date(l.timestamp) }));
    } catch {
      return [];
    }
  });
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback(
    (msg: string, level: LogLevel = "info", table?: LogTable) => {
      const now = new Date();
      const entry: LogEntry = {
        id: ++logIdRef.current,
        timestamp: now,
        time: fmtTime(now),
        msg,
        level,
        table,
      };
      setLogs((prev) => [...prev, entry]);
    },
    [],
  );

  // 自动监听后端事件
  useEffect(() => {
    if (!eventName) return;

    const unlistenPromise = listen<{ level?: string; msg?: string; headers?: string[]; rows?: string[][] }>(
      eventName,
      (event) => {
        const level = (event.payload?.level as LogLevel) ?? "info";
        const msg = event.payload?.msg ?? "";
        const headers = event.payload?.headers;
        const rows = event.payload?.rows;
        const table = headers && rows ? { headers, rows } : undefined;
        if (msg || table) addLog(msg || "", level, table);
      },
    );

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [eventName, addLog]);

  // localStorage 持久化
  useEffect(() => {
    if (!storageKey) return;
    try {
      const cache: LogCache = {
        date: getTodayStr(),
        logs: logs.map((l) => ({
          id: l.id,
          timestamp: l.timestamp.toISOString(),
          time: l.time,
          msg: l.msg,
          level: l.level,
          table: l.table,
        })),
      };
      localStorage.setItem(logStorageKey(storageKey), JSON.stringify(cache));
    } catch {
      /* 存储空间满等异常忽略 */
    }
  }, [logs, storageKey]);

  const clear = useCallback(() => {
    setLogs([]);
    logIdRef.current = 0;
    if (storageKey) {
      try {
        localStorage.removeItem(logStorageKey(storageKey));
      } catch {
        /* ignore */
      }
    }
  }, [storageKey]);

  return useMemo(
    () => ({
      logs,
      log: addLog,
      clear,
      logEndRef,
      count: logs.length,
    }),
    [logs, addLog, clear],
  );
}

// ── 展示组件 ──

const LEVEL_COLORS: Record<LogLevel, { text: string; badge: string; label: string }> = {
  info:    { text: "var(--text-primary)",  badge: "var(--bg-badge)",        label: "INFO" },
  success: { text: "#52c41a",              badge: "rgba(82,196,26,0.15)",  label: "OK" },
  error:   { text: "#ff4d4f",             badge: "rgba(255,77,79,0.15)",  label: "ERR" },
  warn:    { text: "#faad14",             badge: "rgba(250,173,20,0.15)", label: "WARN" },
  step:    { text: "var(--accent)",        badge: "var(--accent-light)",    label: "STEP" },
  debug:   { text: "var(--text-muted)",    badge: "var(--bg-badge)",        label: "DEBUG" },
};

/**
 * 日志面板组件
 *
 * 用法:
 * ```tsx
 * const log = useLog();
 * <LogPanel log={log} />
 * ```
 */
export function LogPanel({
  log,
  title = "运行日志",
  titleExtra,
  onHeaderWheel,
  bottomPadding = 0,
  emptyText = "暂无日志",
  extraActions,
  showCount = true,
  maxHeight,
  className,
  collapsible = false,
  defaultCollapsed = false,
  hideHeader = false,
}: LogPanelProps) {
  const { logs, clear, logEndRef, count } = log;

  // auto-scroll
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, logEndRef]);

  // 折叠状态
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div
      className={`log-panel${collapsible ? " log-panel-collapsible" : ""}${className ? ` ${className}` : ""}`}
      style={maxHeight ? { maxHeight } : undefined}
      onWheel={hideHeader ? onHeaderWheel : undefined}
    >
      {/* ── 标题栏 ── */}
      {!hideHeader && (
        <div className="log-panel-header" onWheel={onHeaderWheel}>
          <div className="log-panel-header-left">
            {collapsible && (
            <button
              className="log-panel-collapse-btn"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "展开" : "折叠"}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          <span className="log-panel-title">{title}</span>
          {titleExtra}
        </div>
        <div className="log-panel-header-right">
          {extraActions}
          {showCount && <span className="log-panel-count">{count} 条</span>}
          {count > 0 && (
            <button className="log-panel-clear-btn" onClick={clear} title="清空日志">
              清除
            </button>
          )}
        </div>
      </div>
      )}

      {/* ── 日志列表 ── */}
      {!collapsed && (
        <div className="log-panel-body" style={{ paddingBottom: bottomPadding }}>
          {count === 0 ? (
            <div className="log-panel-empty">{emptyText}</div>
          ) : (
            <div className="log-panel-list">
              {logs.map((entry) => (
                <LogEntryItem key={entry.id} entry={entry} />
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 单条日志渲染 ──

function LogEntryItem({ entry }: { entry: LogEntry }) {
  const colors = LEVEL_COLORS[entry.level] ?? LEVEL_COLORS.info;

  return (
    <div
      className={`log-entry log-entry-${entry.level}`}
      style={{ "--log-level-color": colors.text } as React.CSSProperties}
    >
      {/* 摘要行（时间 + 徽标 + 消息），hover 变色 */}
      <div className="log-entry-summary">
        <span className="log-entry-time">{entry.time}</span>
        <span
          className="log-entry-badge"
          style={{
            background: colors.badge,
            color: colors.text,
          }}
        >
          {colors.label}
        </span>
        <span className="log-entry-msg">{entry.msg}</span>
      </div>

      {/* 内嵌表格 */}
      {entry.table && entry.table.headers && entry.table.rows && (
        <div className="log-entry-table-wrap">
          <table className="log-entry-table">
            <thead>
              <tr>
                {entry.table.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                // 计算第一列的 rowSpan（连续重复值合并）
                const rows = entry.table!.rows;
                const spans: (number | undefined)[] = [];
                for (let i = 0; i < rows.length; i++) {
                  if (i === 0 || rows[i][0] !== rows[i - 1][0] || rows[i][2] !== rows[i - 1][2]) {
                    let count = 1;
                    for (let j = i + 1; j < rows.length; j++) {
                      if (rows[j][0] === rows[i][0] && rows[j][2] === rows[i][2]) count++;
                      else break;
                    }
                    spans[i] = count;
                  } else {
                    spans[i] = undefined;
                  }
                }
                return rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => {
                      if (ci === 0) {
                        const span = spans[ri];
                        if (span === undefined) return null;
                        return <td key={ci} rowSpan={span}>{cell}</td>;
                      }
                      // 特殊列颜色
                      const h = entry.table!.headers[ci];
                      let cellStyle: React.CSSProperties | undefined;
                      if (h === '公式得数/备货件数' && cell !== '-') {
                         const salesIdx = entry.table!.headers.indexOf('近7日销量');
                         const s = salesIdx >= 0 ? parseInt(row[salesIdx]) : NaN;
                         cellStyle = { color: !isNaN(s) && s >= 5 ? '#2563eb' : '#93c5fd' };
                       }
                      return <td key={ci} style={cellStyle}>{cell}</td>;
                    })}
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
