import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import type { BCPBrowser, BCPProfile } from "./BrowserConfigPanel";
import { safeGetJSON, safeSetJSON } from "../localStorageKeys";
import { getBrowserIcon } from "../utils/browser-icons";
import { detectBrowserRunningProcesses } from "../api";

// ── 浏览器状态（两个独立维度：是否启动 + 是否可连） ──

/** 浏览器进程是否已启动 */
export type LaunchStatus = "not_launched" | "launched";
/** CDP 是否可连接 */
export type ConnectionStatus = "not_connectable" | "connectable";

export const LAUNCH_LABELS: Record<LaunchStatus, string> = {
  not_launched: "未启动",
  launched: "已启动",
};

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  not_connectable: "不可连",
  connectable: "可连",
};

interface CurrentBrowserCardsProps {
  /** 浏览器列表（含已检测的 profiles） */
  browsers: BCPBrowser[];
  /** 每个浏览器的可执行文件路径 */
  exePaths: Record<string, string>;
  /** 每个浏览器的用户数据目录 */
  userDataDirs: Record<string, string[]>;
  /** 检测浏览器 profiles */
  onDetectProfiles?: (browserType: string, exePath: string | null, userDirs: string[]) => Promise<BCPBrowser>;

  // ── 单选模式 ──
  /** 当前选中的 browser|userDataDir|profileId 复合键（选中模式） */
  selectedKey?: string;
  /** 选中回调（选中模式），不传则点击卡片为启动模式 */
  onSelect?: (key: string, browserType: string, profile: BCPProfile) => void;

  // ── 多选模式 ──
  /** 多选模式下选中的 keys（onSelectionChange 存在时启用多选模式） */
  selectedKeys?: string[];
  /** 多选回调：keys = 所有选中的 key 数组，携带最后一个操作的 key/bt/profile/selected 信息 */
  onSelectionChange?: (keys: string[], browserType: string, profile: BCPProfile, selected: boolean) => void;

  /** 启动浏览器 profile（启动模式，不传 onSelect 时使用） */
  onLaunchProfile?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<string>;

}

/** 将 backend ProfileInfo 统一为 BCPProfile 格式 */
function toBCPProfile(p: { id: string; name: string; user_data_dir: string; avatar_base64?: string | null; email?: string | null; user_name?: string | null }): BCPProfile {
  return {
    id: p.id,
    name: p.name,
    user_data_dir: p.user_data_dir,
    avatar_base64: p.avatar_base64 || null,
    email: p.email || null,
    user_name: p.user_name || undefined,
  };
}

function mkKey(bt: string, p: BCPProfile): string {
  return `${bt}|${p.user_data_dir}|${p.id}`;
}

/** 该 profile 所在目录是否为浏览器的默认用户路径（不可用于自动化） */
function isDefaultUserDir(b: BCPBrowser, p: BCPProfile): boolean {
  // 易得客的默认路径就是可用的主程序配置
  if (b.browser_type === "edecker") return false;
  return !!b.default_user_data_dir && p.user_data_dir === b.default_user_data_dir;
}

/** 该 profile 所在目录是否为默认路径的同级目录（同父目录下，非默认路径本身） */
function isDefaultSiblingDir(b: BCPBrowser, p: BCPProfile): boolean {
  if (isDefaultUserDir(b, p)) return false;
  if (!b.default_user_data_dir) return false;
  if (b.browser_type === "edecker") return false;
  const defaultParent = b.default_user_data_dir.replace(/[\\\/][^\\\/]*$/, '').toLowerCase();
  const profileParent = p.user_data_dir.replace(/[\\\/][^\\\/]*$/, '').toLowerCase();
  return defaultParent === profileParent;
}

/** 获取目录的显示名称：父目录\\目录名 */
function getDirDisplayName(path: string): string {
  const normalized = path.replace(/[\\\/]$/, '');
  const parts = normalized.split(/[\\\/]/);
  if (parts.length >= 2) {
    return parts[parts.length - 2] + '\\' + parts[parts.length - 1];
  }
  return normalized;
}

/** 排序分组：0=默认路径（最前）、1=默认同级目录（其次）、2=正常目录 */
function getSortGroup(b: BCPBrowser, p: BCPProfile): number {
  if (isDefaultUserDir(b, p)) return 0;
  if (isDefaultSiblingDir(b, p)) return 1;
  return 2;
}

function CurrentBrowserCards({
  browsers,
  exePaths,
  userDataDirs,
  onDetectProfiles,
  selectedKey,
  onSelect,
  selectedKeys,
  onSelectionChange,
  onLaunchProfile,
}: CurrentBrowserCardsProps) {
  // 每个浏览器的 profiles state: [browserType → BCPProfile[]]
  const [profilesMap, setProfilesMap] = useState<Record<string, BCPProfile[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [launching, setLaunching] = useState<string | null>(null);
  const [hideDefaultProfiles, setHideDefaultProfiles] = useState(() => {
    return safeGetJSON<boolean>("core-hide-uncontrollable") ?? false;
  });

  // 浏览器状态（内部自动检测）
  const [internalLaunchStatuses, setInternalLaunchStatuses] = useState<Record<string, LaunchStatus>>({});
  const [internalConnectionStatuses, setInternalConnectionStatuses] = useState<Record<string, ConnectionStatus>>({});

  // ── 容器可见性控制 ──
  const containerRef = useRef<HTMLDivElement>(null);

  // 序列号：后发 detectAll 运行时，让过时的运行自动放弃更新
  const detectSeqRef = useRef(0);
  const cdpSeqRef = useRef(0);

  // 上一次检测输入的签名（避免纯重渲染导致重复检测）
  const lastDetectSigRef = useRef("");

  const toggleHideDefault = useCallback(() => {
    setHideDefaultProfiles(prev => {
      const newValue = !prev;
      safeSetJSON("core-hide-uncontrollable", newValue);
      return newValue;
    });
  }, []);

  // 检测所有浏览器的 profiles（稳定引用，仅依赖 onDetectProfiles）
  const detectAll = useCallback(async (seq: number, bws: typeof browsers, exes: typeof exePaths, dirs: typeof userDataDirs) => {
    if (!onDetectProfiles) return;
    // 并行检测所有浏览器（每个浏览器独立 loading，互不影响）
    await Promise.all(bws.map(async (b) => {
      const bt = b.browser_type;
      const bsDirs = (dirs[bt] && dirs[bt]!.length > 0) ? dirs[bt]! : (b.user_data_dirs || []);
      if (bsDirs.length === 0) return;

      setLoading(prev => ({ ...prev, [bt]: true }));
      try {
        const result = await onDetectProfiles(bt, exes[bt] || null, bsDirs);
        if (seq !== detectSeqRef.current) return;
        const profiles = (result.profiles || []).map(toBCPProfile);
        setProfilesMap(prev => ({ ...prev, [bt]: profiles }));
      } catch {
        // ignore
      } finally {
        setLoading(prev => ({ ...prev, [bt]: false }));
      }
    }));
  }, [onDetectProfiles]);

  // 仅当检测输入实际变化时才重新检测（纯重渲染跳过）
  useEffect(() => {
    const sig = JSON.stringify({
      dirs: userDataDirs,
      exes: exePaths,
      browsers: browsers.map(b => ({ bt: b.browser_type, ud: b.user_data_dirs, def: b.default_user_data_dir })),
    });
    if (sig === lastDetectSigRef.current) return;
    lastDetectSigRef.current = sig;

    detectSeqRef.current += 1;
    const seq = detectSeqRef.current;
    const rafId = requestAnimationFrame(() => {
      detectAll(seq, browsers, exePaths, userDataDirs);
    });
    return () => {
      cancelAnimationFrame(rafId);
      // ★ StrictMode 下 React 会 fire effect → cleanup → effect，
      // 不清除 sig 会导致第二次 effect 跳过检测，用户永远看不到 profiles
      lastDetectSigRef.current = "";
    };
  }, [browsers, exePaths, userDataDirs, detectAll]);

  // ── 浏览器状态检测（两个独立维度：是否启动 + 是否可连） ──
  // 轮询间隔（毫秒）：后端是 TCP 直连检测，开销极小
  const POLL_INTERVAL_MS = 5000;

  // 前一次状态快照（用于对比，避免无变化时触发重渲染）
  const prevStatusRef = useRef<{ launch: Record<string, LaunchStatus>; conn: Record<string, ConnectionStatus> }>({ launch: {}, conn: {} });

  useEffect(() => {
    // 收集所有 profile
    const items: { bt: string; dataDir: string; id: string }[] = [];
    for (const [bt, ps] of Object.entries(profilesMap)) {
      for (const p of ps) {
        items.push({ bt, dataDir: p.user_data_dir, id: p.id });
      }
    }
    if (items.length === 0) return;

    const seq = ++cdpSeqRef.current;
    let cancelled = false;

    const detect = async () => {
      // 容器被 display:none 隐藏 → 跳过本轮 IPC 检测，避免 5 秒一次的主线程阻塞
      if (!containerRef.current || containerRef.current.offsetParent === null) return;

      try {
        const states = await detectBrowserRunningProcesses(
          items.map(e => ({ user_data_dir: e.dataDir, profile_id: e.id }))
        );
        if (cancelled || seq !== cdpSeqRef.current) return;

        // 建立 user_data_dir|profile_id → state 的查找表
        const stateByLookup: Record<string, { is_running: boolean; debug_port: string | null; cdp_reachable: boolean }> = {};
        for (const s of states) {
          stateByLookup[`${s.user_data_dir}|${s.profile_id}`] = s;
        }

        const launchMap: Record<string, LaunchStatus> = {};
        const connMap: Record<string, ConnectionStatus> = {};
        for (const e of items) {
          const key = `${e.bt}|${e.dataDir}|${e.id}`;
          const lookup = `${e.dataDir}|${e.id}`;
          const st = stateByLookup[lookup];

          // 维度一：是否启动
          if (!st || !st.is_running) {
            launchMap[key] = "not_launched";
            connMap[key] = "not_connectable";
            continue;
          }

          launchMap[key] = "launched";

          // 维度二：是否可连（后端已通过 TCP 直连检测 CDP 端口，无 CORS 问题）
          connMap[key] = st.cdp_reachable ? "connectable" : "not_connectable";
        }

        if (!cancelled && seq === cdpSeqRef.current) {
          // 与前一次对比，只有实际变化时才 setState，避免无意义重渲染
          const prev = prevStatusRef.current;
          const launchChanged = Object.keys(launchMap).some(k => prev.launch[k] !== launchMap[k])
            || Object.keys(prev.launch).some(k => !(k in launchMap));
          const connChanged = Object.keys(connMap).some(k => prev.conn[k] !== connMap[k])
            || Object.keys(prev.conn).some(k => !(k in connMap));

          if (launchChanged) setInternalLaunchStatuses(launchMap);
          if (connChanged) setInternalConnectionStatuses(connMap);
          prevStatusRef.current = { launch: launchMap, conn: connMap };
        }
      } catch {
        // 检测失败时不更新
      }
    };
    // 首次立即检测
    detect();

    // 定时轮询（仅在页面可见时运行，切换标签页后暂停）
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = setInterval(detect, POLL_INTERVAL_MS);
    };
    const stopPoll = () => {
      if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
    };

    // 初始状态：可见才启动轮询
    if (!document.hidden) startPoll();

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPoll();
      } else {
        // 切回可见时立即检测一次，再启动轮询
        detect();
        startPoll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stopPoll();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [profilesMap]);

  // 点击卡片
  const handleCardClick = (bt: string, b: BCPBrowser, p: BCPProfile) => {
    if (isDefaultUserDir(b, p)) return; // 默认路径不可选中
    const key = mkKey(bt, p);

    // 多选模式
    if (onSelectionChange) {
      const current = selectedKeys || [];
      const isSelected = current.includes(key);
      const next = isSelected
        ? current.filter(k => k !== key)
        : [...current, key];
      onSelectionChange(next, bt, p, !isSelected);
      return;
    }

    // 单选模式
    if (onSelect) {
      onSelect(key, bt, p);
    } else if (onLaunchProfile) {
      // 启动模式
      setLaunching(key);
      onLaunchProfile(bt, p.id, p.user_data_dir, 0)
        .catch(() => {})
        .finally(() => setLaunching(null));
    }
  };

  const isSelectMode = !!onSelect;
  const isMultiSelectMode = !!onSelectionChange;

  /** 计算可见 profile 总数（不计被隐藏的默认配置） */
  const visibleProfileCount = useMemo(() => {
    return Object.entries(profilesMap).reduce((sum, [bt, ps]) => {
      const browser = browsers.find(b => b.browser_type === bt);
      return sum + ps.filter(p => !(hideDefaultProfiles && browser && isDefaultUserDir(browser, p))).length;
    }, 0);
  }, [profilesMap, browsers, hideDefaultProfiles]);

  // 没有浏览器 > 显示占位（保持高度，防止抽搐）
  if (browsers.length === 0) {
    return (
      <div className="current-cards" ref={containerRef}>
        <div className="current-cards-placeholder">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginRight: 6, opacity: 0.4 }}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          正在检测浏览器...
        </div>
      </div>
    );
  }

  return (
    <div className="current-cards" ref={containerRef}>
      <div className="current-cards-toolbar">
        <span className="current-cards-count">
          共 {visibleProfileCount} 个用户配置
        </span>
        {isMultiSelectMode && <span className="current-cards-hint">勾选要控制的浏览器配置（支持多选）</span>}
        {isSelectMode && !isMultiSelectMode && <span className="current-cards-hint">点击卡片选择要控制的浏览器配置</span>}
        <span className="current-cards-toolbar-right">
          <label className="current-cards-filter-label" title="启用后不再展示浏览器默认用户路径下的配置">
            <input
              type="checkbox"
              className="current-cards-filter-checkbox"
              checked={hideDefaultProfiles}
              onChange={toggleHideDefault}
            />
            隐藏不可控的用户配置
          </label>
        </span>
      </div>

      {browsers.map(b => {
        const bt = b.browser_type;
        const allProfiles = profilesMap[bt] || [];

        // 排序：默认路径 → 同级目录 → 正常目录；组内按目录名、profile id 排序
        const sortedProfiles = [...allProfiles].sort((a, p) => {
          const ga = getSortGroup(b, a);
          const gb = getSortGroup(b, p);
          if (ga !== gb) return ga - gb;
          const dirA = a.user_data_dir.replace(/^.*[\\\/]/, '').toLowerCase();
          const dirB = p.user_data_dir.replace(/^.*[\\\/]/, '').toLowerCase();
          if (dirA !== dirB) return dirA.localeCompare(dirB);
          return a.id.localeCompare(p.id);
        });

        // 过滤：根据需要隐藏默认配置
        const displayProfiles = hideDefaultProfiles
          ? sortedProfiles.filter(p => !isDefaultUserDir(b, p))
          : sortedProfiles;

        return (
          <div key={bt} className="current-cards-browser">
            {/* 浏览器头部 */}
            <div className="current-cards-header">
              <span className="current-cards-header-icon">
                {getBrowserIcon(b.browser_type) && <img src={getBrowserIcon(b.browser_type)!} alt="" />}
              </span>
              <span className="current-cards-header-name">{b.browser_name}</span>
              {loading[bt] && <span className="current-cards-loading">检测中...</span>}
              {!loading[bt] && (
                <span className="current-cards-header-count">
                  {allProfiles.length} 个配置
                </span>
              )}
            </div>

            {/* Profile 方形卡片网格 */}
            {loading[bt] ? (
              <div className="current-cards-loading-row">
                <div className="current-cards-loading-bar" />
              </div>
            ) : displayProfiles.length > 0 ? (
              <div className="current-cards-grid">
                {displayProfiles.map(p => {
                  const key = mkKey(bt, p);
                  const isDefault = isDefaultUserDir(b, p);
                  const isSibling = isDefaultSiblingDir(b, p);
                  const isSelected = !isDefault && ((isMultiSelectMode && (selectedKeys || []).includes(key)) || (isSelectMode && selectedKey === key));
                  const isLaunching = !isDefault && !isSelectMode && !isMultiSelectMode && launching === key;

                  let cls = "current-card";
                  if (isSelected) cls += " current-card--selected";
                  if (isDefault) cls += " current-card--default";
                  if (isSibling) cls += " current-card--sibling";

                  return (
                    <button
                      key={key}
                      className={cls}
                      onClick={() => handleCardClick(bt, b, p)}
                      disabled={isDefault || isLaunching}
                      title={
                        isDefault
                          ? "浏览器默认用户路径 — 基于浏览器安全规范，不可用于自动化控制"
                          : isSibling
                            ? "与默认路径同级目录 — 存在限制，无法同时控制多个浏览器实例，建议谨慎使用"
                            : (isMultiSelectMode ? `切换选择 ${p.name}` : (isSelectMode ? `选择 ${p.name}` : `启动 ${p.name}`))
                      }
                    >
                      {/* 选中标记（先于警告图标渲染，以覆盖） */}
                      {isSelected && (
                        <span className="current-card-check" style={isMultiSelectMode ? { background: "var(--accent)", border: "none", zIndex: 2 } : { zIndex: 2 }}>
                          <svg width={isMultiSelectMode ? 12 : 16} height={isMultiSelectMode ? 12 : 16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        </span>
                      )}
                      {/* 默认路径锁定标记 */}
                      {isDefault && (
                        <span className="current-card-lock">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                        </span>
                      )}
                      {/* 同级目录警告标记 */}
                      {isSibling && (
                        <span className="current-card-warn">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        </span>
                      )}
                      {/* 浏览器状态标签（左上角：是否启动 + 是否可连） */}
                      {internalLaunchStatuses[key] && (
                        <span className={"current-card-launch current-card-launch--" + internalLaunchStatuses[key]}>
                          {LAUNCH_LABELS[internalLaunchStatuses[key]]}
                        </span>
                      )}
                      {internalConnectionStatuses[key] && internalLaunchStatuses[key] === "launched" && (
                        <span className={"current-card-conn current-card-conn--" + internalConnectionStatuses[key]}>
                          {CONNECTION_LABELS[internalConnectionStatuses[key]]}
                        </span>
                      )}
                      {/* 头像 */}
                      <div className={"current-card-avatar" + (isDefault ? " current-card-avatar--dimmed" : "")}>
                        {p.avatar_base64 ? (
                          <img src={p.avatar_base64} alt={p.name} className="current-card-avatar-img" />
                        ) : (
                          <div className="current-card-avatar-placeholder">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      {/* 名称 */}
                      <div className="current-card-name">{p.name}</div>
                      {/* 邮箱 */}
                      {p.email && <div className="current-card-email">{p.email}</div>}
                      {/* 来源目录（父目录\目录名） */}
                      <div className="current-card-dir">
                        {getDirDisplayName(p.user_data_dir)}
                      </div>
                      {/* 默认路径提示 */}
                      {isDefault && (
                        <div className="current-card-default-label">默认路径·不可用</div>
                      )}
                      {/* 同级目录警告 */}
                      {isSibling && (
                        <div className="current-card-sibling-label">默认同级路径·受限</div>
                      )}
                      {/* 合法路径（非默认非同级） */}
                      {!isDefault && !isSibling && (
                        <div className="current-card-valid-label">路径规范·可用</div>
                      )}
                      {/* 启动中遮罩 */}
                      {isLaunching && <div className="current-card-launching">启动中...</div>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="current-cards-empty">未检测到用户配置</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CurrentBrowserCardsMemo = /* @__PURE__ */ memo(CurrentBrowserCards);
export { CurrentBrowserCardsMemo as CurrentBrowserCards };
