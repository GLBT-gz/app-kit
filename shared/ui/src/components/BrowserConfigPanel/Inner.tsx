import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { safeGetJSON, safeSetJSON } from "../../localStorageKeys";
import { getBrowserIcon } from "../../utils/browser-icons";
import { killAllBrowserProcesses } from "../../api";
import { debugLaunchWithLockCheck } from "../browserLaunch";
import { ziniaoPatchStatus, ziniaoPatchApply } from "../../ziniao-api";
import { Button } from "../controls/Button";
import type { BCPBrowser, BCPProfile } from "./types";
import { ProfileCard } from "./ProfileCard";
import { ZiniaoPatchCard, type ZiniaoPatchState } from "./ZiniaoPatchCard";
import { ChildWindows } from "./ChildWindows";
import { CommandModal, type LaunchCommandInfo } from "./CommandModal";
import { NewUserModal } from "./NewUserModal";

// ════════════════════════════════════════════
//  浏览器配置详情（内部组件）
// ════════════════════════════════════════════

export function BrowserConfigInner({
  browser, exePath: exePathProp, onExePathChange, userDirs, onUserDirsChange,
  onCheckPath, onOpenDir, onBrowseFile, onBrowseDirectory,
  onDetectProfiles, onLaunchProfile, onGetLaunchCommand, onCreateUserDataDir, onCreateShortcut,
  onProfilesChange,
  visible,
}: {
  browser: BCPBrowser;
  exePath: string;
  onExePathChange: (v: string) => void;
  userDirs: string[];
  onUserDirsChange: (dirs: string[]) => void;
  onCheckPath?: (path: string) => Promise<boolean>;
  onOpenDir?: (path: string) => Promise<string>;
  onBrowseFile?: () => Promise<string | string[] | null>;
  onBrowseDirectory?: () => Promise<string | string[] | null>;
  onDetectProfiles?: (browserType: string, exePath: string | null, userDirs: string[]) => Promise<BCPBrowser>;
  onLaunchProfile?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<string>;
  onGetLaunchCommand?: (browserType: string, profileId: string, userDataDir: string, debugPort: number) => Promise<LaunchCommandInfo>;
  onCreateUserDataDir?: (browserType: string, parentDir: string, dirName: string) => Promise<string>;
  onCreateShortcut?: (browserType: string, profileId: string, userDataDir: string, profileName: string, avatarPath: string, debugPort: number) => Promise<string>;
  onProfilesChange?: (profiles: BCPProfile[]) => void;
  visible?: boolean;
}) {
  // ── exePath 局部状态：输入时不触发父组件重渲染，blur 时统一提交 ──
  const [localExePath, setLocalExePath] = useState(exePathProp);
  const prevExePathRef = useRef(exePathProp);
  useEffect(() => {
    if (exePathProp !== prevExePathRef.current) {
      prevExePathRef.current = exePathProp;
      setLocalExePath(exePathProp);
    }
  }, [exePathProp]);

  // ── userDirs 输入局部编辑状态：键入时不触发父组件重渲染 ──
  const [localDirEdits, setLocalDirEdits] = useState<Record<number, string>>({});
  const prevUserDirsRef = useRef(userDirs);
  useEffect(() => {
    if (userDirs !== prevUserDirsRef.current) {
      prevUserDirsRef.current = userDirs;
      setLocalDirEdits({});
    }
  }, [userDirs]);
  const commitDirEdit = useCallback((idx: number) => {
    const edited = localDirEdits[idx];
    if (edited === undefined) return;
    const newDirs = userDirs.map((d, j) => j === idx ? edited : d);
    onUserDirsChange(newDirs);
    setLocalDirEdits(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }, [localDirEdits, userDirs, onUserDirsChange]);

  const [newDir, setNewDir] = useState("");
  // 使用本地 state 存储检测结果，避免直接修改 prop 导致不更新 UI
  const [localProfiles, setLocalProfiles] = useState<BCPProfile[]>(() => browser.profiles || []);
  const [localSuggestedDirs, setLocalSuggestedDirs] = useState<string[]>(() => browser.suggested_user_data_dirs || []);
  const [_profilesDetected, setProfilesDetected] = useState(false);

  // ── 单一数据源：profiles 由 browserStore 统一检测提供 ──
  // store 检测完成（refreshBrowserData）后 browser.profiles 更新，同步到本地显示；
  // 不在此处自动重复 detectCustomProfiles（否则同一批目录被扫两遍 + 全量卡片渲染，卡顿根因）
  useEffect(() => {
    setLocalProfiles(browser.profiles || []);
  }, [browser.profiles]);

  // 当 profiles 检测结果更新时，通知父组件持久化
  // 用 ref 持有 onProfilesChange，避免因闭包变化导致 useEffect 死循环
  const onProfilesChangeRef = useRef(onProfilesChange);
  onProfilesChangeRef.current = onProfilesChange;
  useEffect(() => {
    if (onProfilesChangeRef.current && localProfiles.length > 0) {
      onProfilesChangeRef.current(localProfiles);
    }
  }, [localProfiles]);
  const filterDirs = useMemo(() => [...new Set(userDirs.filter(Boolean))], [userDirs]);
  // 目录显示名称：同名时显示 父目录\目录名，避免混淆
  const dirDisplayNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const dir of filterDirs) {
      const baseName = dir.replace(/^.*[\\\/]/, '');
      const hasDuplicate = filterDirs.some(d => d !== dir && d.replace(/^.*[\\\/]/, '') === baseName);
      if (hasDuplicate) {
        const parent = dir.replace(/[\\\/][^\\\/]*$/, '').replace(/^.*[\\\/]/, '');
        map[dir] = parent ? `${parent}\\${baseName}` : baseName;
      } else {
        map[dir] = baseName;
      }
    }
    return map;
  }, [filterDirs]);
  const [selectedDirs, setSelectedDirs] = useState<string[]>(() => {
    // 1) 优先从独立 key 恢复（core-visible-dirs-{browser_type}）
    const cached = safeGetJSON<string[]>("core-visible-dirs-" + browser.browser_type);
    if (cached) {
      const valid = cached.filter(d => filterDirs.includes(d));
      if (valid.length > 0) return valid;
    }
    // 2) 否则默认全选
    return [...filterDirs];
  });
  const prevFilterDirsRef = useRef(filterDirs);
  // 同步 selectedDirs 与 filterDirs 的变化（新增/移除目录时自动更新选中状态）
  useEffect(() => {
    const prev = prevFilterDirsRef.current;
    prevFilterDirsRef.current = filterDirs;
    const added = filterDirs.filter(d => !prev.includes(d));
    const removed = prev.filter(d => !filterDirs.includes(d));
    if (added.length === 0 && removed.length === 0) return;
    setSelectedDirs(prevSelected => {
      let next = prevSelected;
      if (removed.length > 0) next = next.filter(d => filterDirs.includes(d));
      if (added.length > 0) next = [...next, ...added];
      return next;
    });
  }, [filterDirs]);

  // selectedDirs 持久化到独立 key
  useEffect(() => {
    safeSetJSON("core-visible-dirs-" + browser.browser_type, selectedDirs);
  }, [selectedDirs, browser.browser_type]);

  const [pathStatus, setPathStatus] = useState<Record<string, '' | 'valid' | 'invalid'>>({});
  const [cmdModal, setCmdModal] = useState<{
    profile: BCPProfile; info: LaunchCommandInfo; portStr: string;
  } | null>(null);
  /** 正在启动的 profile（user_data_dir|id），用于按钮禁用防连点 */
  const [launching, setLaunching] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; type: "success" | "error" | "info" | "warning" }>>([]);
  const [newUserModal, setNewUserModal] = useState(false);

  const showToast = useCallback((text: string, type: "success" | "error" | "info" | "warning" = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // ── 紫鸟 CDP patch 状态（无痕化集成；仅 ziniao 且命令可用时展示） ──
  const [ziniaoPatch, setZiniaoPatch] = useState<ZiniaoPatchState>({ supported: false, loading: false, patching: false, patched: false, v109: false, arch: "", detail: "" });
  const checkZiniaoPatch = useCallback(async () => {
    if (browser.browser_type !== "ziniao") return;
    setZiniaoPatch(prev => ({ ...prev, loading: true }));
    try {
      const st = await ziniaoPatchStatus();
      setZiniaoPatch({
        supported: true,
        loading: false,
        patching: false,
        patched: st.patched,
        v109: st.v109,
        arch: st.arch,
        detail: st.detail,
      });
    } catch {
      // 命令不可用（其他项目未注册）→ 隐藏入口
      setZiniaoPatch(prev => ({ ...prev, supported: false, loading: false }));
    }
  }, [browser.browser_type]);
  useEffect(() => {
    if (browser.browser_type !== "ziniao") return;
    checkZiniaoPatch();
  }, [browser.browser_type, checkZiniaoPatch]);

  // 紫鸟一键 patch（showToast 定义之后；弹 UAC 提权）
  const applyZiniaoPatch = useCallback(async () => {
    setZiniaoPatch(prev => ({ ...prev, patching: true }));
    try {
      const msg = await ziniaoPatchApply();
      showToast(msg, "info");
      await checkZiniaoPatch();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setZiniaoPatch(prev => ({ ...prev, patching: false }));
    }
  }, [checkZiniaoPatch, showToast]);

  // ── 路径有效性检查（300ms 防抖后并行检查，单次 setState 批量更新） ──
  useEffect(() => {
    if (!onCheckPath) return;
    if (!visible) return;
    const allPaths = [exePathProp, ...userDirs].filter(Boolean);
    if (allPaths.length === 0) return;
    const timer = setTimeout(async () => {
      // 并行执行所有 IPC 检查，然后单次 batch 更新状态
      const results = await Promise.all(
        allPaths.map(async (p) => {
          if (!p.trim()) return null;
          const exists = await onCheckPath(p);
          return { path: p, valid: exists };
        })
      );
      setPathStatus(prev => {
        const next = { ...prev };
        for (const r of results) {
          if (r) next[r.path] = r.valid ? 'valid' : 'invalid';
        }
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [exePathProp, JSON.stringify(userDirs), onCheckPath, visible]);

  // ── 自动检测 Profiles ──
  const detectProfiles = useCallback(async (dirs: string[], showToastOnSuccess?: boolean) => {
    if (!onDetectProfiles) return;
    if (!dirs.some(d => d.trim())) {
      setLocalProfiles([]);
      setLocalSuggestedDirs([]);
      setProfilesDetected(true);
      return;
    }
    try {
      const result = await onDetectProfiles(browser.browser_type, exePathProp || null, dirs.filter(d => d.trim() !== ""));
      setLocalProfiles(result.profiles || []);
      setLocalSuggestedDirs(result.suggested_user_data_dirs || []);
      setProfilesDetected(true);
      if (showToastOnSuccess) showToast("检测完成", "success");
    } catch (e) {
      if (showToastOnSuccess) showToast(`检测失败: ${e}`, "error");
      setProfilesDetected(true);
    }
  }, [onDetectProfiles, browser.browser_type, exePathProp]);

  // ── 不再自动检测 profiles：由 browserStore 统一检测（单一数据源），
  // 避免同一批目录被 detectCustomProfiles 重复扫描 + 全量卡片渲染（卡顿根因）。
  // 手动检测保留：doDetect（「重新检测」按钮 / 新增用户后 500ms 自动触发）

  const doDetect = async () => {
    await detectProfiles(userDirs, true);
  };

  // 与后端 sanitize_dir_name 保持一致，用于预览显示
  const sanitizeDirName = useCallback((name: string) => {
    return name.replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
  }, []);

  const defaultNewUserParentDir = useMemo(() => {
    if (userDirs[0]) return userDirs[0].replace(/[^\\/]+$/, '');
    if (browser.default_user_data_dir) return browser.default_user_data_dir.replace(/[^\\/]+$/, '');
    return '';
  }, [userDirs, browser.default_user_data_dir]);

  // 新增用户（NewUserModal 调用；成功/失败均以 toast 反馈，失败时抛出）
  const handleCreateUser = async (name: string, parentDir: string) => {
    if (!onCreateUserDataDir) return;
    const clean = sanitizeDirName(name);
    if (!clean) { showToast("请输入用户目录名称", "error"); throw new Error("empty-name"); }
    const target = parentDir || defaultNewUserParentDir;
    if (!target) { showToast("未找到目标目录，请先配置或手动选择", "error"); throw new Error("no-parent"); }
    showToast("正在创建目录并启动浏览器初始化，请稍候...", "info");
    const newDir = await onCreateUserDataDir(browser.browser_type, target, clean);
    showToast("用户数据目录创建并初始化成功!", "success");
    if (!userDirs.includes(newDir)) onUserDirsChange([...userDirs, newDir]);
    setTimeout(() => doDetect(), 500);
  };

  const profiles = localProfiles;
  const hasProfiles = profiles.length > 0;
  const filteredProfiles = profiles.filter(p => selectedDirs.includes(p.user_data_dir));

  const addDir = (dir?: string) => {
    const d = dir?.trim() || newDir.trim();
    if (!d || userDirs.includes(d)) return;
    onUserDirsChange([...userDirs, d]);
    setNewDir("");
  };
  const removeDir = (idx: number) => onUserDirsChange(userDirs.filter((_, i) => i !== idx));

  const browseExePath = async () => {
    if (!onBrowseFile) return;
    const selected = await onBrowseFile();
    if (selected) {
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) {
        setLocalExePath(path);
        onExePathChange(path);
      }
    }
  };

  const openExeFolder = async (exe: string) => {
    if (!onOpenDir) return;
    if (!exe.trim()) { showToast("路径为空", "error"); return; }
    const lastSep = exe.trim().lastIndexOf("\\");
    if (lastSep === -1) { showToast("无法解析目录路径", "error"); return; }
    try { await onOpenDir(exe.trim().substring(0, lastSep)); } catch (e) { showToast(`打开失败: ${e}`, "error"); }
  };

  const browseDirectories = async () => {
    if (!onBrowseDirectory) return;
    const selected = await onBrowseDirectory();
    if (selected?.length) {
      const dirs = Array.isArray(selected) ? selected : [selected];
      const merged = [...userDirs];
      for (const dir of dirs) { if (!merged.includes(dir)) merged.push(dir); }
      onUserDirsChange(merged);
    }
  };

  const doLaunch = async (p: BCPProfile, portStr: string) => {
    if (!onLaunchProfile) return;
    const key = `${p.user_data_dir}|${p.id}`;
    setLaunching(key);
    showToast("启动中...", "info");
    try {
      const portNum = Number(portStr) || 0;
      const msg = await onLaunchProfile(browser.browser_type, p.id, p.user_data_dir, portNum);
      const pid = msg.replace("PID:", "");
      showToast(`${browser.browser_name}「${p.name}」已启动 (PID: ${pid})`, "success");
    } catch (e) { showToast(`启动失败: ${e}`, "error"); }
    finally { setLaunching(null); }
  };

  const doShowCommand = async (p: BCPProfile, portStr: string) => {
    if (!onGetLaunchCommand) return;
    try {
      const portNum = Number(portStr) || 0;
      const info = await onGetLaunchCommand(browser.browser_type, p.id, p.user_data_dir, portNum);
      setCmdModal({ profile: p, info, portStr });
    } catch (e) { showToast(`获取命令失败: ${e}`, "error"); }
  };

  /** 调试启动：复用共享 util（锁检查 + 杀旧进程 + 找端口 + 启动），与当前配置行为一致 */
  const doDebugLaunch = async (p: BCPProfile) => {
    if (!onLaunchProfile) return;
    const key = `${p.user_data_dir}|${p.id}`;
    setLaunching(key);
    try {
      const result = await debugLaunchWithLockCheck({
        browserType: browser.browser_type,
        profiles: browser.profiles || [],
        profile: p,
        launch: onLaunchProfile,
        log: (msg, level) => showToast(msg, level),
      });
      if (!result) return; // 用户取消关闭确认
      showToast(`${browser.browser_name}「${p.name}」已启动 (PID: ${result.pid}) 调试端口: ${result.port}`, "success");
    } catch (e) { showToast(`调试启动失败: ${e}`, "error"); }
    finally { setLaunching(null); }
  };

  const handleShortcut = async (p: BCPProfile) => {
    if (!onCreateShortcut) return;
    try {
      const msg = await onCreateShortcut(browser.browser_type, p.id, p.user_data_dir, p.name, p.avatar_base64 ?? "", 0);
      if (msg.startsWith("overwrite:")) {
        showToast(`已覆盖桌面快捷方式: ${p.name}`, "warning");
      } else {
        showToast(`已创建桌面快捷方式: ${msg}`, "success");
      }
    } catch (e) { showToast(`创建快捷方式失败: ${e}`, "error"); }
  };

  const versionDisplay = browser.version || "";

  return (
    <>
      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.text}</div>)}
      </div>
      <div className="browser-view">
        <div className="browser-header">
          <div className="bh-left">
            <span className="bh-icon">{getBrowserIcon(browser.browser_type) && <img src={getBrowserIcon(browser.browser_type)!} alt="" />}</span>
            <div>
              <h2 className="bh-title">{browser.browser_name}</h2>
              {versionDisplay && <div className="bh-meta">v{versionDisplay}</div>}
            </div>
          </div>
        </div>

        <div className="browser-config">
          <div className="config-field">
            <label>可执行文件路径</label>
            <div className="config-field-row">
              <div className="config-dir-input-wrap">
                <input
                  type="text" className="config-input"
                  value={localExePath}
                  onChange={e => setLocalExePath(e.target.value)}
                  onBlur={() => onExePathChange(localExePath)}
                  onKeyDown={(e) => {
                    // 回车即提交（失焦触发 onBlur）
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  placeholder="例如: C:\Program Files...\msedge.exe"
                />
                {onCheckPath && pathStatus[exePathProp] === 'valid' && <span className="path-status-icon path-valid">✓</span>}
                {onCheckPath && pathStatus[exePathProp] === 'invalid' && <span className="path-status-icon path-invalid">✕</span>}
              </div>
              {onBrowseFile && (
                <button className="config-btn-browse" onClick={browseExePath} title="选择文件">
                  <span className="icon-with-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="4" x2="12" y2="20" /><line x1="4" y1="12" x2="20" y2="12" /></svg>
                  </span>
                </button>
              )}
              {onOpenDir && (
                <button className="config-btn-folder" onClick={() => openExeFolder(exePathProp)} title="打开目录">
                  <span className="icon-with-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="config-field">
            <label>用户数据目录</label>
            {userDirs.map((dir, i) => (
              <div key={i} className="config-dir-row">
                <div className="config-dir-input-wrap">
                  <input
                    type="text" className="config-input"
                    value={i in localDirEdits ? localDirEdits[i] : dir}
                    readOnly={dir === browser.default_user_data_dir}
                    onChange={e => setLocalDirEdits(prev => ({ ...prev, [i]: e.target.value }))}
                    onBlur={() => commitDirEdit(i)}
                  />
                  {dir === browser.default_user_data_dir && <span className="config-dir-badge-inside">默认</span>}
                  {onCheckPath && pathStatus[dir] === 'valid' && <span className="path-status-icon path-valid">✓</span>}
                  {onCheckPath && pathStatus[dir] === 'invalid' && <span className="path-status-icon path-invalid">✕</span>}
                </div>
                {onOpenDir && (
                  <button className="config-btn-folder" onClick={async () => { try { await onOpenDir(dir); } catch {} }} title="打开目录">
                    <span className="icon-with-badge">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                      <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    </span>
                  </button>
                )}
                {dir !== browser.default_user_data_dir ? (
                  <button className="config-btn-remove" onClick={() => removeDir(i)} title="移除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                ) : <div className="config-btn-spacer" />}
              </div>
            ))}
            {browser.browser_type !== 'edecker' && (localSuggestedDirs.filter(d => !userDirs.includes(d)).length ?? 0) > 0 && (
              <div className="config-suggested-dirs">
                {localSuggestedDirs.filter(d => !userDirs.includes(d)).map(d => (
                  <div key={d} className="config-suggested-dir" onClick={() => addDir(d)} title="点击添加">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    <span>{d}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="config-add-dir">
              <input
                type="text" className="config-input config-input-sm"
                value={newDir}
                onChange={e => setNewDir(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addDir()}
                placeholder="添加目录..."
              />
              <button className="config-btn-browse" onClick={() => addDir()} title="添加">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              {onBrowseDirectory && (
                <button className="config-btn-folder" onClick={browseDirectories} title="选择目录">
                  <span className="icon-with-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="4" x2="12" y2="20" /><line x1="4" y1="12" x2="20" y2="12" /></svg>
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* ── 易得客专属：配置目录（店铺实际路径 {UserData的父目录}\Profiles，只读） ── */}
          {browser.browser_type === 'edecker' && browser.default_user_data_dir && (() => {
            const profilesPath = browser.default_user_data_dir!.replace(/\\User Data$/i, '') + '\\Profiles';
            return (
              <div className="config-field">
                <label>配置目录</label>
                <div className="config-dir-row">
                  <div className="config-dir-input-wrap">
                    <input
                      type="text" className="config-input"
                      value={profilesPath}
                      readOnly
                    />
                    <span className="config-dir-badge-inside">店铺目录</span>
                    {onCheckPath && pathStatus[profilesPath] === 'valid' && <span className="path-status-icon path-valid">✓</span>}
                    {onCheckPath && pathStatus[profilesPath] === 'invalid' && <span className="path-status-icon path-invalid">✕</span>}
                  </div>
                  {onOpenDir && (
                      <button className="config-btn-folder" onClick={async () => { try { await onOpenDir(profilesPath); } catch {} }} title="打开目录">
                        <span className="icon-with-badge">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                          <svg className="icon-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                        </span>
                      </button>
                    )}
                    <div className="config-btn-spacer" />
                </div>
              </div>
            );
          })()}

          {onCreateUserDataDir && (
            <div className="config-actions">
              <Button variant="primary" onClick={() => setNewUserModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
                新增用户
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (!window.confirm(`确定要关闭所有 ${browser.browser_name} 进程吗？`)) return;
                  try {
                    const msg = await killAllBrowserProcesses(browser.browser_type);
                    showToast(msg, "success");
                  } catch (e) {
                    showToast(`清空进程失败: ${e}`, "error");
                  }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4" y1="4" x2="20" y2="20"/><line x1="4" y1="20" x2="20" y2="4"/></svg>
                清空进程
              </Button>
            </div>
          )}
        </div>

        {hasProfiles && filterDirs.length > 1 && (
          <div className="dir-filter-bar">
            <div className="dir-filter-pills">
              <span className="dir-filter-label">显示目录：</span>
              {filterDirs.map(dir => (
                <button
                  key={dir}
                  className={`dir-filter-pill ${selectedDirs.includes(dir) ? 'active' : ''}`}
                  onClick={() => {
                    const next = selectedDirs.includes(dir) ? selectedDirs.filter(d => d !== dir) : [...selectedDirs, dir];
                    setSelectedDirs(next);
                  }}
                >
                  {dirDisplayNames[dir]}
                  <span className="dir-filter-count">{profiles.filter(p => p.user_data_dir === dir).length}</span>
                </button>
              ))}
            </div>
            {selectedDirs.length < filterDirs.length && (
              <button className="dir-filter-clear" onClick={() => setSelectedDirs([...filterDirs])}>显示全部</button>
            )}
          </div>
        )}

        {/* ── 紫鸟 CDP patch 状态卡片（应用内无痕化） ── */}
        {browser.browser_type === 'ziniao' && ziniaoPatch.supported && (
          <ZiniaoPatchCard state={ziniaoPatch} onApply={applyZiniaoPatch} />
        )}

        {/* ── 子浏览器窗口列表（易得客店铺窗口 / 紫鸟环境窗口） ── */}
        <ChildWindows browser={browser} />

        {hasProfiles && filteredProfiles.length > 0 && (
          <>
            <div className="profiles-section-title">
              用户配置 ({filteredProfiles.length}{selectedDirs.length < filterDirs.length ? ` / ${profiles.length}` : ''})
            </div>
            <div className="profiles-grid">
              {filteredProfiles.map(p => (
                <ProfileCard
                  key={`${p.user_data_dir}|${p.id}`}
                  profile={p}
                  isDefault={p.user_data_dir === browser.default_user_data_dir}
                  dirTag={dirDisplayNames[p.user_data_dir]}
                  showDirTag={filterDirs.length > 1}
                  canLaunch={!!onLaunchProfile}
                  canCommand={!!onGetLaunchCommand}
                  canShortcut={!!onCreateShortcut}
                  isLaunching={launching === `${p.user_data_dir}|${p.id}`}
                  onLaunch={doLaunch}
                  onDebugLaunch={doDebugLaunch}
                  onShowCommand={doShowCommand}
                  onShortcut={handleShortcut}
                />
              ))}
            </div>
          </>
        )}
        {hasProfiles && profiles.length > 0 && filteredProfiles.length === 0 && (
          <div className="empty-filter-state">当前没有选中的目录</div>
        )}
      </div>

      {/* ── 命令 Modal ── */}
      {cmdModal && (
        <CommandModal
          profile={cmdModal.profile}
          info={cmdModal.info}
          portStr={cmdModal.portStr}
          canLaunch={!!onLaunchProfile}
          onClose={() => setCmdModal(null)}
          onLaunch={doLaunch}
        />
      )}

      {/* ── 新增用户 Modal ── */}
      {newUserModal && onCreateUserDataDir && (
        <NewUserModal
          browserName={browser.browser_name}
          defaultParentDir={defaultNewUserParentDir}
          onBrowseDirectory={onBrowseDirectory}
          onSubmitted={handleCreateUser}
          onClose={() => setNewUserModal(false)}
        />
      )}
    </>
  );
}
