// ============================================================
// TikTok Shop 商家后台自动化公共组件（侧边栏菜单解析 + 路由切换）
//
// 基于紫鸟 CDP（ziniaoEval）在店铺环境内执行注入 JS：
// - 解析：读取 .p-menu-inner 侧边栏 → 顶层直达链接 + 可展开分组/子项
// - 切换：展开父分组 → 原生 click 目标菜单项 → 前端轮询 URL 验证生效
//
// 关键约束（踩坑记录）：
// - runtime_evaluate 未启用 awaitPromise，注入 JS 只能同步执行，
//   展开/跳转的等待验证一律在前端轮询完成。
// - 点击一律用原生 element.click()（isTrusted=true，React 才响应）。
// - 选择器用 :scope > 限定父级范围（全局匹配可能命中不可见元素）。
// ============================================================

import { ziniaoEval } from "./ziniao-api";

/** 菜单项（顶层直达链接或分组内子项） */
export interface TiktokShopMenuItem {
  name: string;
  href: string;
  key: string;
  selected: boolean;
}

/** 可展开分组（订单/商品/物流…，data-expose-id / data-tid 为稳定 ID） */
export interface TiktokShopMenuGroup {
  id: string;
  name: string;
  expanded: boolean;
  items: TiktokShopMenuItem[];
}

/** 侧边栏解析结果 */
export interface TiktokShopMenu {
  ok: boolean;
  error?: string;
  path: string; // 解析时的 location.pathname + search
  links: TiktokShopMenuItem[]; // 顶层直达链接（首页/联盟等）
  groups: TiktokShopMenuGroup[];
}

/** 日志回调（与 useLog 的 log 签名对齐） */
export type TtsLogFn = (msg: string, level?: "info" | "success" | "error" | "warn" | "step" | "debug") => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 提取 href 的 pathname（忽略 query/hash，用于 URL 匹配） */
function pathOf(href: string, base: string): string {
  try {
    return new URL(href, base).pathname;
  } catch {
    return href;
  }
}

// ────────────────────────────────────────────────────────────
//  注入 JS
// ────────────────────────────────────────────────────────────

/** 解析侧边栏菜单（返回 JSON 字符串，前端 JSON.parse） */
export const TTS_PARSE_MENU_JS = `(() => {
  const inner = document.querySelector(".p-menu-inner");
  if (!inner) return JSON.stringify({ ok: false, error: "未找到侧边栏 .p-menu-inner（未登录或不在商家后台）" });
  const title = (el) => {
    const t = el && el.querySelector ? el.querySelector(".p-menu-item-title-txt") : null;
    return t ? (t.textContent || "").trim() : "";
  };
  const toItem = (a) => ({
    name: title(a),
    href: (a.getAttribute("href") || "").trim(),
    key: (a.getAttribute("_key") || "").trim(),
    selected: !!a.querySelector(".p-menu-item-selected"),
  });
  const result = { ok: true, path: location.pathname + location.search, links: [], groups: [] };
  inner.querySelectorAll(":scope > a.sidebar-item-link").forEach((a) => result.links.push(toItem(a)));
  inner.querySelectorAll(":scope > div.p-menu-inline").forEach((g) => {
    const header = g.querySelector(":scope > .p-menu-item-header");
    const items = [];
    g.querySelectorAll(":scope > .p-menu-inline-content > a.sidebar-item-link").forEach((a) => items.push(toItem(a)));
    result.groups.push({
      id: (g.getAttribute("data-expose-id") || g.getAttribute("data-tid") || "").trim(),
      name: title(header),
      expanded: header ? header.getAttribute("aria-expanded") === "true" : false,
      items,
    });
  });
  return JSON.stringify(result);
})()`;

/** 展开指定分组（返回 clicked / already / no_group / no_header） */
export async function expandTiktokShopGroup(cdp: number, groupId: string): Promise<string> {
  const js = `(() => {
    const g = document.querySelector('.p-menu-inline[data-expose-id="${groupId}"]') || document.querySelector('.p-menu-inline[data-tid="${groupId}"]');
    if (!g) return "no_group";
    const header = g.querySelector(":scope > .p-menu-item-header");
    if (!header) return "no_header";
    if (header.getAttribute("aria-expanded") === "true") return "already";
    header.click();
    return "clicked";
  })()`;
  const v = await ziniaoEval(cdp, js);
  return typeof v === "string" ? v : String(v);
}

/** 查询分组是否已展开 */
export async function isTiktokShopGroupExpanded(cdp: number, groupId: string): Promise<boolean> {
  const js = `(() => {
    const g = document.querySelector('.p-menu-inline[data-expose-id="${groupId}"]') || document.querySelector('.p-menu-inline[data-tid="${groupId}"]');
    const h = g && g.querySelector(":scope > .p-menu-item-header");
    return h ? h.getAttribute("aria-expanded") === "true" : false;
  })()`;
  const v = await ziniaoEval(cdp, js);
  return v === true;
}

/** 点击指定 href 的菜单项（返回 clicked / no_target） */
export async function clickTiktokShopLink(cdp: number, href: string): Promise<string> {
  const js = `(() => {
    const href = ${JSON.stringify(href)};
    let target = null;
    document.querySelectorAll("a.sidebar-item-link").forEach((a) => {
      if (!target && (a.getAttribute("href") || "") === href) target = a;
    });
    if (!target) return "no_target";
    target.click();
    return "clicked";
  })()`;
  const v = await ziniaoEval(cdp, js);
  return typeof v === "string" ? v : String(v);
}

/** 当前页面 URL */
export async function getTiktokShopLocation(cdp: number): Promise<string> {
  const v = await ziniaoEval(cdp, "location.href");
  return typeof v === "string" ? v : String(v);
}

/** 解析侧边栏菜单 */
export async function parseTiktokShopMenu(cdp: number): Promise<TiktokShopMenu> {
  const v = await ziniaoEval(cdp, TTS_PARSE_MENU_JS);
  if (typeof v !== "string") throw new Error("解析结果不是字符串: " + JSON.stringify(v));
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch (e) {
    throw new Error("解析结果 JSON 解析失败: " + e);
  }
  return parsed as TiktokShopMenu;
}

/**
 * 切换到指定菜单项：展开父分组（可选）→ 点击目标 → 轮询 URL 验证生效。
 *
 * @param item 目标菜单项（href 必填）
 * @param groupId 目标所在分组 id（顶层直达链接无需传）
 * @param log 可选日志回调
 * @returns 结果消息（成功 / 失败原因）
 */
export async function navigateTiktokShopRoute(
  cdp: number,
  item: TiktokShopMenuItem,
  groupId?: string,
  log?: TtsLogFn,
): Promise<string> {
  const targetPath = pathOf(item.href, "https://seller-local.tiktok.com/");

  // 1. 展开父分组（若未展开）
  if (groupId) {
    const st = await expandTiktokShopGroup(cdp, groupId);
    if (st === "no_group") return `分组「${groupId}」不存在，菜单可能已改版`;
    if (st === "no_header") return `分组「${groupId}」缺少展开标题`;
    if (st === "clicked") {
      log?.("  展开分组中…", "step");
      for (let i = 0; i < 15; i++) {
        await sleep(300);
        if (await isTiktokShopGroupExpanded(cdp, groupId)) break;
      }
    }
  }

  // 2. 点击目标菜单项
  const ck = await clickTiktokShopLink(cdp, item.href);
  if (ck === "no_target") return `未找到菜单项「${item.name}」（${item.href}）`;

  // 3. 轮询验证：SPA 跳转后 pathname 应与目标一致
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const url = await getTiktokShopLocation(cdp);
      if (pathOf(url, url) === targetPath) return `切换成功 ${item.name} → ${url}`;
    } catch {
      /* CDP 偶发连接错误时继续轮询 */
    }
  }
  const cur = await getTiktokShopLocation(cdp).catch(() => "获取失败");
  return `切换未生效：${item.name} → 当前 ${cur}（期望 ${targetPath}）`;
}
