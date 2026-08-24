import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import type { BCPBrowser, BCPProfile } from "./BrowserConfigPanel";
import { safeGetJSON, safeSetJSON } from "../localStorageKeys";
import { getBrowserIcon } from "../utils/browser-icons";
import { detectBrowserRunningProcesses, launchBrowserProfile, killBrowserProfileProcess, killAllBrowserProcesses, getLaunchCommand, createDesktopShortcut } from "../api";
import { useBrowserStore, refreshBrowserData } from "../data/browserStore";
import { mkKey, isDefaultUserDir, isMultiUserDir, getSortGroup, getDirDisplayName } from "../utils/profile-rules";
import { debugLaunchWithLockCheck } from "./browserLaunch";
import { CommandModal, type LaunchCommandInfo } from "./BrowserConfigPanel/CommandModal";

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

// 三档受限规则 / key 生成 / 目录显示名等纯函数见 utils/profile-rules.ts

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
  /** 卡片唯一 key（bt|user_data_dir|id），供拖拽批量勾选按点定位 */
  dataKey: string;
  onCardClick: (bt: string, profile: BCPProfile) => void;
  /** 右键回调：弹出上下文菜单（打开 / 调试打开） */
  onCardContextMenu?: (e: React.MouseEvent, bt: string, profile: BCPProfile) => void;
  /** 按下回调：多选模式下启动「按住拖拽批量勾选/取消」会话 */
  onCardMouseDown?: (e: React.MouseEvent, bt: string, profile: BCPProfile) => void;
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
  dataKey,
  onCardClick,
  onCardContextMenu,
  onCardMouseDown,
}: ProfileCardProps) {
  let cls = "current-card";
  if (isSelected) cls += " current-card--selected";
  if (isDefault) cls += " current-card--default";
  if (isSibling) cls += " current-card--sibling";

  return (
    <button
      className={cls}
      data-key={dataKey}
      onClick={() => onCardClick(browserType, profile)}
      onMouseDown={(e) => onCardMouseDown?.(e, browserType, profile)}
      onContextMenu={(e) => {
        onCardContextMenu?.(e, browserType, profile);
      }}
      // 默认路径卡片不禁用：需保持右键菜单可用（启动/全部终止）；点击选择由父组件拦截提示
      disabled={isLaunching}
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
          <img src={profile.avatar_base64} alt={profile.name} className="current-card-avatar-img" draggable={false} />
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

  // ── 多选拖拽批量勾选：按下卡片后拖动，移动经过的卡片统一勾选/取消 ──
  // 模式由起始卡片当前状态决定：未选中 → 拖拽统一「勾选」；已选中 → 拖拽统一「取消」
  const [dragSelecting, setDragSelecting] = useState(false);
  const dragRef = useRef<{ active: boolean; mode: "select" | "deselect"; lastKey: string | null; startX: number; startY: number } | null>(null);
  /** 拖拽会话启动后抑制随后的 click，避免与按下时的那次切换叠加（重复切换） */
  const suppressClickRef = useRef(false);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

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

  // key → {bt, profile} 查找表：拖拽时按卡片 key 反查浏览器类型与 profile
  const keyInfoMap = useMemo(() => {
    const m = new Map<string, { bt: string; p: BCPProfile }>();
    for (const b of browsers) {
      for (const p of b.profiles || []) {
        const pp = toBCPProfile(p);
        m.set(mkKey(b.browser_type, pp), { bt: b.browser_type, p: pp });
      }
    }
    return m;
  }, [browsers]);
  const keyInfoMapRef = useRef(keyInfoMap);
  keyInfoMapRef.current = keyInfoMap;

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
    // 拖拽会话的按下动作已切换过该卡片：吞掉随之而来的 click，避免重复切换
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // 浏览器默认用户路径不可用于自动化控制：点击仅提示，不进入选择逻辑
    const b = browsers.find(x => x.browser_type === bt);
    if (b && isDefaultUserDir(b, p)) {
      showToast("浏览器默认用户路径不可用于自动化控制", "warning");
      return;
    }
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
  }, [browsers, showToast, onSelectionChange, onSelect, onLaunchProfile]);

  // ── 多选拖拽批量勾选/取消 ──
  /** 按下卡片：仅多选模式下启动拖拽会话。模式 = 起始卡片当前状态的反向
   *  （未选中 → 拖拽统一「勾选」；已选中 → 拖拽统一「取消」），并立即切换起始卡片 */
  const handleCardMouseDown = useCallback((e: React.MouseEvent, bt: string, p: BCPProfile) => {
    if (!onSelectionChange || e.button !== 0) return;
    const b = browsers.find(x => x.browser_type === bt);
    if (b && isDefaultUserDir(b, p)) return; // 锁定卡片不可勾选：退回普通点击（toast 提示）
    const key = mkKey(bt, p);
    const isSelected = (selectedKeysRef.current || []).includes(key);
    dragRef.current = {
      active: true,
      mode: isSelected ? "deselect" : "select",
      lastKey: null,
      startX: e.clientX,
      startY: e.clientY,
    };
    suppressClickRef.current = true;
    setDragSelecting(true);
    // 起始卡片立即切换（即使拖拽途中已快速离开该卡片也不漏）
    const info = keyInfoMapRef.current.get(key);
    if (info) {
      const current = selectedKeysRef.current || [];
      const next = isSelected
        ? current.filter(k => k !== key)
        : [...current, key];
      onSelectionChangeRef.current?.(next, info.bt, info.p, !isSelected);
    }
  }, [browsers, onSelectionChange]);

  // 拖拽会话的全局监听（一次绑定，动态值全部走 ref）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag?.active) return;
      // 在窗口外松开（收不到 mouseup）：检测到无按键即终止会话，避免残留拖拽状态
      if (e.buttons === 0) {
        dragRef.current = null;
        suppressClickRef.current = false;
        setDragSelecting(false);
        return;
      }
      // 移动未超过阈值（手抖）仍视为点击，不触发批量勾选
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (dx * dx + dy * dy < 25) return;
      const card = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".current-card") as HTMLElement | null;
      const key = card?.dataset.key;
      if (!key || key === drag.lastKey) return;
      drag.lastKey = key;
      // 锁定卡片（默认路径）跳过
      if (card.classList.contains("current-card--default")) return;
      const info = keyInfoMapRef.current.get(key);
      if (!info) return;
      const current = selectedKeysRef.current || [];
      const has = current.includes(key);
      if (drag.mode === "select" && has) return;
      if (drag.mode === "deselect" && !has) return;
      const next = drag.mode === "select" ? [...current, key] : current.filter(k => k !== key);
      onSelectionChangeRef.current?.(next, info.bt, info.p, drag.mode === "select");
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragSelecting(false);
      // click 在 mouseup 后同步派发：若落在卡片上会被 handleCardClick 消费；
      // 用宏任务兜底清除，避免未消费的抑制标记误吞下一次点击
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

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

  /** 调试打开：复用共享 util（锁检查 + 杀旧进程 + 找端口 + 启动），与全局配置行为一致 */
  const doDebugOpen = useCallback(async (bt: string, p: BCPProfile) => {
    const key = mkKey(bt, p);
    setLaunching(key);
    try {
      const profiles = browsers.find(b => b.browser_type === bt)?.profiles || [];
      const result = await debugLaunchWithLockCheck({
        browserType: bt,
        profiles,
        profile: p,
        launch: (bt2, id, dir, port) => (onLaunchProfile || launchBrowserProfile)(bt2, id, dir, port),
        log: (msg, level) => showToast(msg, level),
      });
      if (!result) return; // 用户取消关闭确认
      showToast(`「${p.name}」调试启动成功 (PID: ${result.pid}, 端口: ${result.port})`, "success");
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

  // ── 命令 / 快捷方式（右键菜单入口，与全局配置行为一致） ──
  const [cmdModal, setCmdModal] = useState<{ browserType: string; profile: BCPProfile; info: LaunchCommandInfo; portStr: string } | null>(null);

  const doShowCommand = useCallback(async (bt: string, p: BCPProfile) => {
    try {
      const info = await getLaunchCommand(bt, p.id, p.user_data_dir, 0);
      setCmdModal({ browserType: bt, profile: p, info, portStr: "" });
    } catch (e) {
      showToast(`获取命令失败: ${e}`, "error");
    }
  }, [showToast]);

  const doCreateShortcut = useCallback(async (bt: string, p: BCPProfile) => {
    try {
      const msg = await createDesktopShortcut(bt, p.id, p.user_data_dir, p.name, p.avatar_base64 ?? "", 0);
      showToast(
        msg.startsWith("overwrite:") ? `已覆盖桌面快捷方式: ${p.name}` : `已创建桌面快捷方式: ${msg}`,
        msg.startsWith("overwrite:") ? "warning" : "success",
      );
    } catch (e) {
      showToast(`创建快捷方式失败: ${e}`, "error");
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

  // detect 取消标记：组件卸载 / effect 重建时置位，放弃进行中的检测结果
  const detectCancelledRef = useRef(false);

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
    detectCancelledRef.current = false;

    const detect = async () => {
      // 容器被 display:none 隐藏 → 跳过本轮 IPC 检测，避免 5 秒一次的主线程阻塞
      if (!containerRef.current || containerRef.current.offsetParent === null) return;

      try {
        const states = await detectBrowserRunningProcesses(
          items.map(e => ({ user_data_dir: e.dataDir, profile_id: e.id }))
        );
        if (detectCancelledRef.current || seq !== cdpSeqRef.current) return;

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

        if (!detectCancelledRef.current && seq === cdpSeqRef.current) {
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

    // IntersectionObserver：容器从 display:none 切回可见（tab 内切换）时立即检测一次，
    // 无需等到下一次 5s 轮询 tick
    let io: IntersectionObserver | null = null;
    const el = containerRef.current;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(entries => {
        if (entries.some(en => en.isIntersecting)) detect();
      });
      io.observe(el);
    }

    return () => {
      detectCancelledRef.current = true;
      stopPoll();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      io?.disconnect();
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
    <div className={"current-cards" + (dragSelecting ? " current-cards-dragging" : "")} ref={containerRef}>
      <div className="current-cards-toolbar">
        <span className="current-cards-count">
          共 {visibleProfileCount} 个用户配置
        </span>
        {isMultiSelectMode && <span className="current-cards-hint">勾选要控制的浏览器配置（按住卡片拖动可批量勾选/取消）</span>}
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
                      dataKey={key}
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
                      onCardMouseDown={handleCardMouseDown}
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
        onShowCommand={doShowCommand}
        onShortcut={doCreateShortcut}
      />

      {/* 启动命令 Modal（与全局配置一致） */}
      {cmdModal && (
        <CommandModal
          profile={cmdModal.profile}
          info={cmdModal.info}
          portStr={cmdModal.portStr}
          canLaunch
          onClose={() => setCmdModal(null)}
          onLaunch={async (p, portStr) => {
            const portNum = Number(portStr) || 0;
            setLaunching(mkKey(cmdModal.browserType, p));
            try {
              const fn = onLaunchProfile || launchBrowserProfile;
              const msg = await fn(cmdModal.browserType, p.id, p.user_data_dir, portNum);
              const pid = msg.replace("PID:", "");
              showToast(`「${p.name}」已启动${pid ? ` (PID: ${pid})` : ""}`, "success");
            } catch (e) {
              showToast(`打开失败: ${e}`, "error");
            } finally {
              setLaunching(null);
            }
          }}
        />
      )}
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
  onShowCommand: (bt: string, p: BCPProfile) => void;
  onShortcut: (bt: string, p: BCPProfile) => void;
}

/** 独立右键菜单：内部自管状态，通过自定义事件接收「打开」指令。
 *  打开/关闭只重渲染本组件，不触发父组件（卡片网格）重渲染，保证菜单响应即时 */
const ProfileContextMenu = memo(function ProfileContextMenu({
  browsers,
  onOpen,
  onDebugOpen,
  onClose,
  onKillAll,
  onShowCommand,
  onShortcut,
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
      // 菜单容器 className 为 ctx-menu（见下方渲染）：class 不匹配会导致
      // mousedown 点击菜单项时误判为「点击空白」而关闭菜单，使 click 事件丢失，
      // 表现为「打开/调试打开」不生效且无提示
      if (!t.closest(".ctx-menu")) setMenu(null);
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
  // 菜单高度按项数估算（每项约 32px + 上下 padding 8px），与通用 ContextMenu 保持一致
  // 默认目录：启动/全部终止/命令/快捷方式（4 项）；普通：打开/调试打开/关闭/命令/快捷方式（5 项）
  const menuHeight = (ctxIsDefault ? 4 : 5) * 32 + 8;
  const menuStyle = {
    left: Math.max(4, Math.min(x, window.innerWidth - 180)),
    top: Math.max(4, Math.min(y, window.innerHeight - menuHeight)),
  };
  const run = (fn: (bt: string, p: BCPProfile) => void) => {
    setMenu(null);
    fn(bt, p);
  };

  return (
    <div className="ctx-menu" style={menuStyle} onContextMenu={e => e.preventDefault()}>
      {ctxIsDefault ? (
        <>
          <button
            className="ctx-item"
            onClick={() => run(onOpen)}
            title={`正常启动「${p.name}」（不带调试端口）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            启动
          </button>
          <button
            className="ctx-item danger"
            onClick={() => run(onKillAll)}
            title={`全部终止「${p.name}」所属浏览器（关闭全部窗口与进程，含独立目录实例）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            全部终止
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onShowCommand)}
            title="获取启动命令（复制 / 启动）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M8 3H3v5M3 16v5h5M16 21h5v-5" /><path d="M21 3l-7 7M3 21l7-7" /></svg>
            命令
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onShortcut)}
            title="创建桌面快捷方式"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            快捷方式
          </button>
        </>
      ) : (
        <>
          <button
            className="ctx-item"
            onClick={() => run(onOpen)}
            title={`正常启动「${p.name}」（不带调试端口）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            打开
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onDebugOpen)}
            title={`以随机可用端口调试启动（--remote-debugging-port）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
            调试打开
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onClose)}
            title={`关闭「${p.name}」（只关闭该配置自己的进程）`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            关闭
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onShowCommand)}
            title="获取启动命令（复制 / 启动）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M8 3H3v5M3 16v5h5M16 21h5v-5" /><path d="M21 3l-7 7M3 21l7-7" /></svg>
            命令
          </button>
          <button
            className="ctx-item"
            onClick={() => run(onShortcut)}
            title="创建桌面快捷方式"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            快捷方式
          </button>
        </>
      )}
    </div>
  );
});
