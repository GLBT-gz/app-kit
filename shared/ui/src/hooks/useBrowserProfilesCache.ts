import { useState, useEffect, useRef } from "react";
import type { BCPBrowser, BCPProfile } from "../components/BrowserConfigPanel";
import { detectCustomProfiles } from "../api";

/**
 * 缓存所有浏览器的 profiles 详情（含 user_name / email）。
 * 会随 configExePaths / configUserDataDirs 变化自动重新加载。
 */
export function useBrowserProfilesCache(
  browsers: BCPBrowser[],
  configExePaths: Record<string, string>,
  configUserDataDirs: Record<string, string[]>,
) {
  const [cachedProfiles, setCachedProfiles] = useState<Record<string, BCPProfile[]>>({});
  // 记录已加载的 dirs hash，变化时重新加载
  const lastDirHash = useRef("");

  useEffect(() => {
    if (browsers.length === 0) return;

    // 构建 dirs + exe path hash，变化时重新加载
    const dirHash = JSON.stringify(
      browsers.map(b => ({
        bt: b.browser_type,
        exe: configExePaths[b.browser_type] || null,
        dirs: configUserDataDirs[b.browser_type] || b.user_data_dirs || [],
      }))
    );
    if (dirHash === lastDirHash.current && Object.keys(cachedProfiles).length > 0) return;
    lastDirHash.current = dirHash;

    let cancelled = false;

    async function loadAll() {
      const result: Record<string, BCPProfile[]> = {};
      for (const b of browsers) {
        if (cancelled) return;
        const bt = b.browser_type;
        // 优先使用用户配置的目录列表（非空），只有确实未配置时才回退到浏览器检测默认值
        const cachedDirs = configUserDataDirs[bt];
        const dirs = (cachedDirs && cachedDirs.length > 0)
          ? cachedDirs
          : (b.user_data_dirs || []);
        if (dirs.length === 0) continue;
        try {
          const r = await detectCustomProfiles(bt, configExePaths[bt] || null, dirs);
          if (cancelled) return;
          result[bt] = (r.profiles || []).map(p => ({
            id: p.id,
            name: p.name,
            user_data_dir: p.user_data_dir,
            avatar_base64: p.avatar_base64 || null,
            email: p.email || null,
            user_name: p.user_name || undefined,
          }));
        } catch { /* ignore */ }
      }
      if (!cancelled) setCachedProfiles(result);
    }
    loadAll();

    return () => { cancelled = true; };
  }, [browsers, configExePaths, configUserDataDirs]);

  return cachedProfiles;
}
