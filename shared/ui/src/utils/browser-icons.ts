// ============================================================
// 浏览器图标内存注册表
//
// 图标 base64 数据由 Rust 编译时嵌入，通过 detectBrowsers()
// 返回。为避免在 localStorage 中重复存储大的 base64 字符串，
// 本模块维护一个模块级 Map 作为内存缓存。
//
// 用法：
//   - 后端检测完成后调用 populateBrowserIcons(browsers) 填充
//   - 渲染图标时调用 getBrowserIcon(browserType) 获取
// ============================================================

const iconCache = new Map<string, string>();

/**
 * 从检测到的浏览器列表中提取图标到内存缓存。
 * 应在 detectBrowsers() / detectCustomProfiles() 返回后调用。
 */
export function populateBrowserIcons(browsers: { browser_type: string; browser_icon_base64?: string | null }[]): void {
  for (const b of browsers) {
    if (b.browser_icon_base64) {
      iconCache.set(b.browser_type, b.browser_icon_base64);
    }
  }
}

/**
 * 获取指定浏览器类型的图标 base64 URL。
 * 返回 undefined 表示图标尚未加载。
 */
export function getBrowserIcon(browserType: string): string | undefined {
  return iconCache.get(browserType);
}

/**
 * 从浏览器列表中剔除所有 base64 大字段（Profile 头像），
 * 用于写入 localStorage 缓存前瘦身。
 *
 * Profile 头像是运行时从磁盘读取的动态数据，不应缓存在 localStorage 中。
 * 浏览器图标（browser_icon_base64，Rust 编译时嵌入、体积小）保留，
 * 以便应用启动无需后端检测即可直接渲染侧边栏图标。
 *
 * 返回类型使用 Record<string, unknown>[] 避免与具体接口的 index-signature 冲突。
 */
export function stripBrowserCache<T>(browsers: T[]): T[] {
  return browsers.map(b => {
    const { profiles, ...rest } = b as Record<string, unknown>;
    const strippedProfiles = profiles ? (profiles as Record<string, unknown>[]).map(p => {
      const { avatar_base64: _, ...pRest } = p as Record<string, unknown>;
      return pRest;
    }) : undefined;
    return { ...rest, ...(strippedProfiles ? { profiles: strippedProfiles } : {}) } as unknown as T;
  });
}
