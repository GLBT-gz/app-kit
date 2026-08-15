import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { BCPProfile, BrowserConfigItemProps } from "./types";
import { BrowserConfigInner } from "./Inner";

// ════════════════════════════════════════════
//  单个浏览器配置项（React.memo 避免隐藏时重渲染）
// ════════════════════════════════════════════

export const BrowserConfigItem = memo(function BrowserConfigItem({
  browser, isActive, exePath, onExePathsChange, userDirs, onUserDataDirsChange,
  onCheckPath, onOpenDir, onBrowseFile, onBrowseDirectory,
  onDetectProfiles, onLaunchProfile, onGetLaunchCommand, onCreateUserDataDir, onCreateShortcut,
  onProfilesChange,
}: BrowserConfigItemProps) {
  // ── 懒挂载：记录该浏览器是否曾被激活过 ──
  const everActiveRef = useRef(isActive);
  if (isActive) {
    everActiveRef.current = true;
  }

  // ── 首帧延迟渲染：激活时不立即挂载 BrowserConfigInner，让出主线程给侧栏交互 ──
  const [showContent, setShowContent] = useState(!isActive);
  const deferRafRef = useRef<number | null>(null);
  const deferDoneRef = useRef(false);
  useEffect(() => {
    if (!isActive) {
      // 非激活时不触发延迟（激活后 effect 重新执行）
      return;
    }
    if (deferDoneRef.current) {
      // 之前已经完成过延迟激活 → 立即显示
      setShowContent(true);
      return;
    }
    deferDoneRef.current = true;
    // 延迟一帧再挂载 BrowserConfigInner，首帧主线程完全留给侧栏交互和滚动
    deferRafRef.current = requestAnimationFrame(() => {
      deferRafRef.current = null;
      setShowContent(true);
    });
    return () => {
      if (deferRafRef.current !== null) cancelAnimationFrame(deferRafRef.current);
    };
  }, [isActive]);

  const handleExePathChange = useCallback((v: string) => {
    onExePathsChange(prev => ({ ...prev, [browser.browser_type]: v }));
  }, [browser.browser_type, onExePathsChange]);

  const handleUserDirsChange = useCallback((dirs: string[]) => {
    onUserDataDirsChange(prev => ({ ...prev, [browser.browser_type]: dirs }));
  }, [browser.browser_type, onUserDataDirsChange]);

  const handleProfilesChange = useCallback((profs: BCPProfile[]) => {
    onProfilesChange?.(browser.browser_type, profs);
  }, [browser.browser_type, onProfilesChange]);

  if (!everActiveRef.current) return null;

  return (
    <div style={{ display: isActive ? "" : "none" }}>
      {showContent ? (
        <BrowserConfigInner
          browser={browser}
          visible={isActive}
          exePath={exePath}
          onExePathChange={handleExePathChange}
          userDirs={userDirs}
          onUserDirsChange={handleUserDirsChange}
          onCheckPath={onCheckPath}
          onOpenDir={onOpenDir}
          onBrowseFile={onBrowseFile}
          onBrowseDirectory={onBrowseDirectory}
          onDetectProfiles={onDetectProfiles}
          onLaunchProfile={onLaunchProfile}
          onGetLaunchCommand={onGetLaunchCommand}
          onCreateUserDataDir={onCreateUserDataDir}
          onCreateShortcut={onCreateShortcut}
          onProfilesChange={handleProfilesChange}
        />
      ) : null}
    </div>
  );
});
