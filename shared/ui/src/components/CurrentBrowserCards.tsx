import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import type { BCPBrowser, BCPProfile } from "./BrowserConfigPanel";
import { safeGetJSON, safeSetJSON } from "../localStorageKeys";
import { getBrowserIcon } from "../utils/browser-icons";
import { detectBrowserRunningProcesses, launchBrowserProfile, findAvailablePort, killBrowserProfileProcess, killAllBrowserProcesses } from "../api";
import { useBrowserStore, refreshBrowserData } from "../data/browserStore";

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
  /** 浏览器列表（含已检测的 profiles，来自 browserStore） */
  browsers: BCPBrowser[];
  /**
   * @deprecated 组件不再自行检测，仅保留字段以兼容调用方。
   */
  exePaths?: Record<string, string>;
  /**
   * @deprecated 组件不再自行检测，仅保留字段以兼容调用方。
   */
  userDataDirs?: Record<string, string[]>;
  /**
   * @deprecated profiles 由 browserStore 统一检测提供，本组件不再自行调用。
   * 保留字段以兼容调用方（000/007 等）。
   */
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
  // 易得客/紫鸟的默认路径就是可用的主程序配置（店铺/环境窗口以 children 展示）
  if (b.browser_type === "edecker" || b.browser_type === "ziniao") return false;
  return !!b.default_user_data_dir && p.user_data_dir === b.default_user_data_dir;
}

/** 该 profile 所在目录是否为多用户目录（同 user-data-dir 含多个用户 → 浏览器单实例锁，
 *  同一时刻只能打开一个实例 → 部分受限）。counts 为各 user_data_dir 下的用户数。 */
function isMultiUserDir(b: BCPBrowser, p: BCPProfile, counts?: Record<string, number>): boolean {
  if (isDefaultUserDir(b, p)) return false;
  if (b.browser_type === "edecker" || b.browser_type === "ziniao") return false;
  return (counts?.[p.user_data_dir] ?? 0) > 1;
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

/** 排序分组：0=默认路径（完全受限，最前）、1=多用户目录（部分受限，其次）、2=单用户目录（完全规范） */
function getSortGroup(b: BCPBrowser, p: BCPProfile, counts?: Record<string, number>): number {
  if (isDefaultUserDir(b, p)) return 0;
  if (isMultiUserDir(b, p, counts)) return 1;
  return 2;
}

// ════════════════════════════════════════════
//  单个 Profile 卡片（memo：选中态变化只重渲染受影响的卡片）
// ════════════════════════════════════════════

interface ProfileCardProps {
  profile: BCPProfile;
  browserType: string;
  isSelected: boolean;
  isDefault: boolean;
  isSibling: boolean;
  /** 多用户目录下的用户总数（用于提示文案） */
  siblingUserCount?: number;
  isLaunching: boolean;
  launchStatus?: LaunchStatus;
  connStatus?: ConnectionStatus;
  onCardClick: (bt: string, profile: BCPProfile) => void;
  /** 右键回调：弹出上下文菜单（打开 / 调试打开） */
  onCardContextMenu?: (e: React.MouseEvent, bt: string, profile: BCPProfile) => void;
}

const ProfileCard = memo(function ProfileCard({
  profile,
  browserType,
  isSelected,
  isDefault,
  isSibling,
  siblingUserCount,
  isLaunching,
  launchStatus,
  connStatus,
  onCardClick,
  onCardContextMenu,
}: ProfileCardProps) {
  let cls = "current-card";
  if (isSelected) cls += " current-card--selected";
  if (isDefault) cls += " current-card--default";
  if (isSibling) cls += " current-card--sibling";

  return (
    <button
      className={cls}
      onClick={() => onCardClick(browserType, profile)}
      onContextMenu={(e) => {
        onCardContextMenu?.(e, browserType, profile);
      }}
      disabled={isDefault || isLaunching}
      title={
        isDefault
          ? "浏览器默认用户路径 — 基于浏览器安全规范，不可用于自动化控制"
          : isSibling
            ? `该目录下共 ${siblingUserCount ?? 2} 个用户 — 同一 user-data-dir 同一时刻只能打开一个实例（单实例锁），建议每个用户使用独立目录`
            : "选择此浏览器配置"
      }
    >
      {/* 选中标记（先于警告图标渲染，以覆盖） */}
      {isSelected && (
        <span className="current-card-check" style={{ background: "var(--accent)", border: "none", zIndex: 2 }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </span>
      )}
      {/* 默认路径锁定标记 */}
      {isDefault && (
        <span className="current-card-lock">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </span>
      )}
      {/* 多用户目录警告标记 */}
      {isSibling && (
        <span className="current-card-warn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </span>
      )}
      {/* 浏览器状态标签（左上角：是否启动 + 是否可连） */}
      {launchStatus && (
        <span className={"current-card-launch current-card-launch--" + launchStatus}>
          {LAUNCH_LABELS[launchStatus]}
        </span>
      )}
      {connStatus && launchStatus === "launched" && (
        <span className={"current-card-conn current-card-conn--" + connStatus}>
          {CONNECTION_LABELS[connStatus]}
        </span>
      )}
      {/* 头像 */}
      <div className={"current-card-avatar" + (isDefault ? " current-card-avatar--dimmed" : "")}>
        {profile.avatar_base64 ? (
          <img src={profile.avatar_base64} alt={profile.name} className="current-card-avatar-img" />
        ) : (
          <div className="current-card-avatar-placeholder">
            {profile.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      {/* 名称 */}
      <div className="current-card-name">{profile.name}</div>
      {/* 邮箱 */}
      {profile.email && <div className="current-card-email">{profile.email}</div>}
      {/* 来源目录（父目录\目录名） */}
      <div className="current-card-dir">
        {getDirDisplayName(profile.user_data_dir)}
      </div>
      {/* 默认路径提示 */}
      {isDefault && (
        <div className="current-card-default-label">默认路径·不可用</div>
      )}
      {/* 多用户目录警告 */}
      {isSibling && (
        <div className="current-card-sibling-label">多用户目录·受限</div>
      )}
      {/* 单用户目录（完全规范） */}
      {!isDefault && !isSibling && (
        <div className="current-card-valid-label">单用户目录·可用</div>
      )}
      {/* 启动中遮罩 */}
      {isLaunching && <div className="current-card-launching">启动中...</div>}
    </button>
  );
});

function CurrentBrowserCards({
  browsers,
  exePaths: _exePaths,
  userDataDirs: _userDataDirs,
  onDetectProfiles: _onDetectProfiles,
  selectedKey,
  onSelect,
  selectedKeys,
  onSelectionChange,
  onLaunchProfile,
}: CurrentBrowserCardsProps) {
  const { loading } = useBrowserStore();

  // ── 挂载时触发一次检测（按需：进入本页面才执行，应用启动不检测） ──
  useEffect(() => {
    refreshBrowserData();
  }, []);

  const [launching, setLaunching] = useState<string | null>(null);
  const [hideDefaultProfiles, setHideDefaultProfiles] = useState(() => {
    return safeGetJSON<boolean>("core-hide-uncontrollable") ?? false;
  });

  // ── 轻量 toast（复用组件库 .toast 样式） ──
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; type: "success" | "error" | "info" | "warning" }>>([]);
  const showToast = useCallback((text: string, type: "success" | "error" | "info" | "warning" = "info") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // 浏览器状态（内部自动检测）
  const [internalLaunchStatuses, setInternalLaunchStatuses] = useState<Record<string, LaunchStatus>>({});
  const [internalConnectionStatuses, setInternalConnectionStatuses] = useState<Record<string, ConnectionStatus>>({});

  // ── 容器可见性控制 ──
  const containerRef = useRef<HTMLDivElement>(null);

  // 序列号：后发 detectAll 运行时，让过时的运行自动放弃更新
  const cdpSeqRef = useRef(0);

  const toggleHideDefault = useCallback(() => {
    setHideDefaultProfiles(prev => {
      const newValue = !prev;
      safeSetJSON("core-hide-uncontrollable", newValue);
      return newValue;
    });
  }, []);

  // ── profiles 从 browsers（browserStore）派生，不再自行检测 ──
  const profilesByBrowser = useMemo(() => {
    const m: Record<string, BCPProfile[]> = {};
    for (const b of browsers) {
      const ps = (b.profiles || []).map(toBCPProfile);
      if (ps.length > 0) m[b.browser_type] = ps;
    }
    return m;
  }, [browsers]);

  // 每个 user_data_dir 下的用户数（同目录多用户 → 单实例锁 → 部分受限）
  const dirProfileCounts = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const b of browsers) {
      const counts: Record<string, number> = {};
      for (const p of b.profiles || []) {
        counts[p.user_data_dir] = (counts[p.user_data_dir] || 0) + 1;
      }
      m[b.browser_type] = counts;
    }
    return m;
  }, [browsers]);

  // 每个浏览器的排序结果（仅在 browsers/profiles 变化时重算）
  const grouped = useMemo(() => {
    return browsers.map(b => {
      const bt = b.browser_type;
      const allProfiles = profilesByBrowser[bt] || [];
      const counts = dirProfileCounts[bt];
      const sortedProfiles = [...allProfiles].sort((a, p) => {
        const ga = getSortGroup(b, a, counts);
        const gb = getSortGroup(b, p, counts);
        if (ga !== gb) return ga - gb;
        const dirA = a.user_data_dir.replace(/^.*[\\\/]/, '').toLowerCase();
        const dirB = p.user_data_dir.replace(/^.*[\\\/]/, '').toLowerCase();
        if (dirA !== dirB) return dirA.localeCompare(dirB);
        return a.id.localeCompare(p.id);
      });
      return { browser: b, sortedProfiles };
    });
  }, [browsers, profilesByBrowser, dirProfileCounts]);

  // 选中集合 Set（避免点击时 O(n) includes / 全量拷贝）
  const selectedKeySet = useMemo(() => new Set(selectedKeys || []), [selectedKeys]);

  // 点击回调：用 ref 持有最新 selectedKeys，保持回调引用稳定（memo 生效前提）
  const selectedKeysRef = useRef(selectedKeys);
  selectedKeysRef.current = selectedKeys;
  const handleCardClick = useCallback((bt: string, p: BCPProfile) => {
    const key = mkKey(bt, p);

    // 多选模式
    if (onSelectionChange) {
      const current = selectedKeysRef.current || [];
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
  }, [onSelectionChange, onSelect, onLaunchProfile]);

  // ── 右键菜单：打开 / 调试打开 ──

  /** 卡片右键：阻止默认菜单，通知独立的右键菜单组件显示（事件驱动，避免本组件重渲染） */
  const handleCardContextMenu = useCallback((e: React.MouseEvent, bt: string, p: BCPProfile) => {
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent("appkit:profile-ctx-menu", {
        detail: { x: e.clientX, y: e.clientY, bt, p },
      }),
    );
  }, []);

  /** 正常打开：不带调试端口（debug_port=0） */
  const doOpen = useCallback(async (bt: string, p: BCPProfile) => {
    const key = mkKey(bt, p);
    setLaunching(key);
    try {
      const fn = onLaunchProfile || launchBrowserProfile;
      const msg = await fn(bt, p.id, p.user_data_dir, 0);
      const pid = msg.replace("PID:", "");
      showToast(`「${p.name}」已启动${pid ? ` (PID: ${pid})` : ""}`, "success");
    } catch (e) {
      showToast(`打开失败: ${e}`, "error");
    } finally {
      setLaunching(null);
    }
  }, [onLaunchProfile, showToast]);

  /** 调试打开：先查同目录运行中的 profile 并关闭（释放 Singleton 锁），
   *  再分配可用端口以 --remote-debugging-port 启动 */
  const doDebugOpen = useCallback(async (bt: string, p: BCPProfile) => {
    const key = mkKey(bt, p);
    setLaunching(key);
    try {
      // Chrome/Edge 的 Singleton 锁针对整个 user_data_dir：同目录下有任何 profile
      // 在运行，新进程都无法使用该目录。先找同目录运行中的 profile 并关闭。
      const runningProfiles = (browsers.find(b => b.browser_type === bt)?.profiles || [])
        .filter(pr => pr.user_data_dir === p.user_data_dir)
        .map(pr => ({ user_data_dir: pr.user_data_dir, profile_id: pr.id }));
      const states = await detectBrowserRunningProcesses(runningProfiles);
      const running = states.find(s => s.is_running);
      const runningProfile = running
        ? (browsers.find(b => b.browser_type === bt)?.profiles || [])
          .find(pr => pr.user_data_dir === running.user_data_dir && pr.id === running.profile_id)
        : undefined;
      if (runningProfile) {
        showToast(`「${runningProfile.name}」正在运行（同用户目录），先关闭...`, "warning");
        await killBrowserProfileProcess(bt, runningProfile.id, runningProfile.user_data_dir);
        showToast("已关闭旧进程，等待释放目录锁", "info");
        // 等待进程完全退出，释放 Singleton 锁
        await new Promise(r => setTimeout(r, 1500));
      }
      showToast("查找可用调试端口...", "info");
      const port = await findAvailablePort(40000, 60000);
      const fn = onLaunchProfile || launchBrowserProfile;
      const msg = await fn(bt, p.id, p.user_data_dir, port);
      const pid = msg.replace("PID:", "");
      showToast(`「${p.name}」调试启动成功 (PID: ${pid}, 端口: ${port})`, "success");
    } catch (e) {
      showToast(`调试打开失败: ${e}`, "error");
    } finally {
      setLaunching(null);
    }
  }, [onLaunchProfile, browsers, showToast]);

  /** 关闭该配置：kill_browser_profile_process 按 user-data-dir + profile-directory
   *  精确匹配进程树（taskkill /T），只关闭该配置对应的浏览器实例，不影响其它配置 */
  const doClose = useCallback(async (bt: string, p: BCPProfile) => {
    try {
      const msg = await killBrowserProfileProcess(bt, p.id, p.user_data_dir);
      showToast(`「${p.name}」已关闭${msg ? ` (${msg})` : ""}`, "success");
    } catch (e) {
      const err = String(e);
      // 后端在未匹配到进程时返回“未找到匹配的浏览器进程”
      showToast(err.includes("未找到匹配") ? `「${p.name}」未在运行` : `关闭失败: ${e}`, "warning");
    }
  }, [showToast]);

  /** 全部终止：默认目录（完全受限，单实例）配置专用——杀死该浏览器的全部进程，
   *  含所有独立目录实例。影响大，需用户确认 */
  const doKillAll = useCallback(async (bt: string, p: BCPProfile) => {
    if (
      !window.confirm(
        `「${p.name}」属于浏览器默认用户目录（单实例）。\n全部终止将关闭该浏览器的所有窗口与进程（含其它独立目录实例），未保存的内容可能丢失。\n确定继续？`,
      )
    ) {
      return;
    }
    try {
      const msg = await killAllBrowserProcesses(bt);
      showToast(`已终止全部进程${msg ? ` (${msg})` : ""}`, "success");
    } catch (e) {
      showToast(`全部终止失败: ${e}`, "error");
    }
  }, [showToast]);

  const isSelectMode = !!onSelect;
  const isMultiSelectMode = !!onSelectionChange;

  /** 计算可见 profile 总数（不计被隐藏的默认配置） */
  const visibleProfileCount = useMemo(() => {
    return Object.entries(profilesByBrowser).reduce((sum, [bt, ps]) => {
      const browser = browsers.find(b => b.browser_type === bt);
      return sum + ps.filter(p => !(hideDefaultProfiles && browser && isDefaultUserDir(browser, p))).length;
    }, 0);
  }, [profilesByBrowser, browsers, hideDefaultProfiles]);

  // ── 浏览器状态检测（两个独立维度：是否启动 + 是否可连） ──
  // 轮询间隔（毫秒）：后端是 TCP 直连检测，开销极小
  const POLL_INTERVAL_MS = 5000;

  // 前一次状态快照（用于对比，避免无变化时触发重渲染）
  const prevStatusRef = useRef<{ launch: Record<string, LaunchStatus>; conn: Record<string, ConnectionStatus> }>({ launch: {}, conn: {} });

  useEffect(() => {
    // 收集所有 profile
    const items: { bt: string; dataDir: string; id: string }[] = [];
    for (const [bt, ps] of Object.entries(profilesByBrowser)) {
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
  }, [profilesByBrowser]);

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

      {grouped.map(({ browser, sortedProfiles }) => {
        const bt = browser.browser_type;
        const allProfiles = profilesByBrowser[bt] || [];

        // 过滤：根据需要隐藏默认配置
        const displayProfiles = hideDefaultProfiles
          ? sortedProfiles.filter(p => !isDefaultUserDir(browser, p))
          : sortedProfiles;

        return (
          <div key={bt} className="current-cards-browser">
            {/* 浏览器头部 */}
            <div className="current-cards-header">
              <span className="current-cards-header-icon">
                {getBrowserIcon(browser.browser_type) && <img src={getBrowserIcon(browser.browser_type)!} alt="" />}
              </span>
              <span className="current-cards-header-name">{browser.browser_name}</span>
              {loading && <span className="current-cards-loading">检测中...</span>}
              {!loading && (
                <span className="current-cards-header-count">
                  {allProfiles.length} 个配置
                </span>
              )}
            </div>

            {/* Profile 方形卡片网格 */}
            {displayProfiles.length > 0 ? (
              <div className="current-cards-grid">
                {displayProfiles.map(p => {
                  const key = mkKey(bt, p);
                  const isDefault = isDefaultUserDir(browser, p);
                  const counts = dirProfileCounts[bt];
                  const isSibling = isMultiUserDir(browser, p, counts);
                  const isSelected = !isDefault && ((isMultiSelectMode && selectedKeySet.has(key)) || (isSelectMode && selectedKey === key));
                  const isLaunching = !isDefault && !isSelectMode && !isMultiSelectMode && launching === key;

                  return (
                    <ProfileCard
                      key={key}
                      profile={p}
                      browserType={bt}
                      isSelected={isSelected}
                      isDefault={isDefault}
                      isSibling={isSibling}
                      siblingUserCount={counts?.[p.user_data_dir]}
                      isLaunching={isLaunching}
                      launchStatus={internalLaunchStatuses[key]}
                      connStatus={internalConnectionStatuses[key]}
                      onCardClick={handleCardClick}
                      onCardContextMenu={handleCardContextMenu}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="current-cards-empty">未检测到用户配置</div>
            )}
          </div>
        );
      })}

      {/* 轻量 toast（右上角） */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.text}</div>
        ))}
      </div>

      {/* 独立右键菜单组件：右键/关闭只重渲染菜单自身，不触发本组件重渲染 */}
      <ProfileContextMenu
        browsers={browsers}
        onOpen={doOpen}
        onDebugOpen={doDebugOpen}
        onClose={doClose}
        onKillAll={doKillAll}
      />
    </div>
  );
}

const CurrentBrowserCardsMemo = /* @__PURE__ */ memo(CurrentBrowserCards);
export { CurrentBrowserCardsMemo as CurrentBrowserCards };

/** 右键菜单事件名 */
const CTX_MENU_EVENT = "appkit:profile-ctx-menu";

/** 菜单状态（事件 detail） */
interface CtxMenuDetail {
  x: number;
  y: number;
  bt: string;
  p: BCPProfile;
}

interface ProfileContextMenuProps {
  browsers: BCPBrowser[];
  onOpen: (bt: string, p: BCPProfile) => void;
  onDebugOpen: (bt: string, p: BCPProfile) => void;
  onClose: (bt: string, p: BCPProfile) => void;
  onKillAll: (bt: string, p: BCPProfile) => void;
}

/** 独立右键菜单：内部自管状态，通过自定义事件接收「打开」指令。
 *  打开/关闭只重渲染本组件，不触发父组件（卡片网格）重渲染，保证菜单响应即时 */
const ProfileContextMenu = memo(function ProfileContextMenu({
  browsers,
  onOpen,
  onDebugOpen,
  onClose,
  onKillAll,
}: ProfileContextMenuProps) {
  const [menu, setMenu] = useState<CtxMenuDetail | null>(null);

  // 接收卡片右键事件
  useEffect(() => {
    const onCtx = (e: Event) => {
      const d = (e as CustomEvent<CtxMenuDetail>).detail;
      if (d) setMenu({ x: d.x, y: d.y, bt: d.bt, p: d.p });
    };
    window.addEventListener(CTX_MENU_EVENT, onCtx);
    return () => window.removeEventListener(CTX_MENU_EVENT, onCtx);
  }, []);

  // 关闭：点击空白 / Esc / 滚轮
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".current-card-ctx-menu")) setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onWheel = () => setMenu(null);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("touchstart", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [menu]);

  if (!menu) return null;

  const { x, y, bt, p } = menu;
  const ctxBrowser = browsers.find(b => b.browser_type === bt);
  const ctxIsDefault = ctxBrowser ? isDefaultUserDir(ctxBrowser, p) : false;
  const menuStyle = {
    left: Math.max(4, Math.min(x, window.innerWidth - 168)),
    top: Math.max(4, Math.min(y, window.innerHeight - 132)),
  };
  const run = (fn: (bt: string, p: BCPProfile) => void) => {
    setMenu(null);
    fn(bt, p);
  };

  return (
    <div className="current-card-ctx-menu" style={menuStyle} onContextMenu={e => e.preventDefault()}>
      {ctxIsDefault ? (
        <>
          <button
            className="current-card-ctx-item"
            onClick={() => run(onOpen)}
            title={`正常启动「${p.name}」（不带调试端口）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            启动
          </button>
          <button
            className="current-card-ctx-item"
            onClick={() => run(onKillAll)}
            title={`全部终止「${p.name}」所属浏览器（关闭全部窗口与进程，含独立目录实例）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            全部终止
          </button>
        </>
      ) : (
        <>
          <button
            className="current-card-ctx-item"
            onClick={() => run(onOpen)}
            title={`正常启动「${p.name}」（不带调试端口）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            打开
          </button>
          <button
            className="current-card-ctx-item"
            onClick={() => run(onDebugOpen)}
            title={`以随机可用端口调试启动（--remote-debugging-port）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
            调试打开
          </button>
          <button
            className="current-card-ctx-item"
            onClick={() => run(onClose)}
            title={`关闭「${p.name}」（只关闭该配置自己的进程）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            关闭
          </button>
        </>
      )}
    </div>
  );
});
