import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import type { BCPBrowser, BCPProfile } from "./BrowserConfigPanel";
import { safeGetJSON, safeSetJSON } from "../localStorageKeys";
import { getBrowserIcon } from "../utils/browser-icons";
import { launchBrowserProfile, killBrowserProfileProcess, killAllBrowserProcesses, getLaunchCommand, createDesktopShortcut } from "../api";
import {
  useProfileStatusSnapshot,
  useRegisterProfileStatusInterest,
  type ProfileStatusItem,
} from "../data/profileStatusStore";
import { useBrowserStore, refreshBrowserData } from "../data/browserStore";
import { mkKey, isDefaultUserDir, isMultiUserDir, getSortGroup } from "../utils/profile-rules";
import { debugLaunchWithLockCheck } from "./browserLaunch";
import { CommandModal, type LaunchCommandInfo } from "./BrowserConfigPanel/CommandModal";

// ── 浏览器状态（两个独立维度：是否启动 + 是否可连） ──
// 类型与轮询调度器见 data/profileStatusStore.ts（全局单例，多实例共享）

export type { LaunchStatus, ConnectionStatus } from "../data/profileStatusStore";
export { LAUNCH_LABELS, CONNECTION_LABELS } from "./current-browser/labels";
import { ProfileCard } from "./current-browser/ProfileCard";
import { ProfileContextMenu } from "./current-browser/ProfileContextMenu";

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
// 单个 Profile 卡片见 current-browser/ProfileCard.tsx，右键菜单见 current-browser/ProfileContextMenu.tsx

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

  // ── 容器可见性控制 ──
  const containerRef = useRef<HTMLDivElement>(null);

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

  // ── 浏览器运行状态：共享轮询 store（全局单调度器，多实例不重复轮询） ──
  const profileStatus = useProfileStatusSnapshot();
  const statusItems = useMemo(() => {
    const items: ProfileStatusItem[] = [];
    for (const [bt, ps] of Object.entries(profilesByBrowser)) {
      for (const p of ps) items.push({ bt, dir: p.user_data_dir, id: p.id });
    }
    return items;
  }, [profilesByBrowser]);
  useRegisterProfileStatusInterest(statusItems, containerRef);

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
      const key = mkKey(bt, p);
      // 共享实例：该配置无独立进程，无法单独关闭（同目录其它配置共享同一主进程）
      if (profileStatus.kind[key] === "shared") {
        showToast("该配置与同目录其它配置共享同一浏览器实例，无法单独关闭", "warning");
        return;
      }
      const msg = await killBrowserProfileProcess(bt, p.id, p.user_data_dir);
      showToast(`「${p.name}」已关闭${msg ? ` (${msg})` : ""}`, "success");
    } catch (e) {
      const err = String(e);
      // 后端在未匹配到进程时返回“未找到匹配的浏览器进程”
      showToast(err.includes("未找到匹配") ? `「${p.name}」未在运行` : `关闭失败: ${e}`, "warning");
    }
  }, [showToast, profileStatus]);

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
                  launchStatus={profileStatus.launch[key]}
                  connStatus={profileStatus.conn[key]}
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
