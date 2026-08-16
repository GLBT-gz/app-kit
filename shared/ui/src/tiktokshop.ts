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

/** 查询目标菜单项是否可见（展开动画完成后才可点击） */
export async function isTiktokShopLinkVisible(cdp: number, href: string): Promise<boolean> {
  const js = `(() => {
    let target = null;
    document.querySelectorAll("a.sidebar-item-link").forEach((a) => {
      if (!target && (a.getAttribute("href") || "") === ${JSON.stringify(href)}) target = a;
    });
    if (!target) return false;
    const st = getComputedStyle(target);
    return st.visibility !== "hidden" && st.display !== "none";
  })()`;
  const v = await ziniaoEval(cdp, js);
  return v === true;
}

/** 切换失败诊断：当前 URL / 选中菜单 / 目标项可见性与选中态（定位点击未生效或跳转被重定向） */
async function getTiktokShopSwitchDiagnose(cdp: number, href: string): Promise<string> {
  const js = `(() => {
    const sel = document.querySelector(".p-menu-item-selected");
    let target = null;
    document.querySelectorAll("a.sidebar-item-link").forEach((a) => {
      if (!target && (a.getAttribute("href") || "") === ${JSON.stringify(href)}) target = a;
    });
    const st = target ? getComputedStyle(target) : null;
    return JSON.stringify({
      url: location.href,
      selected: sel && sel.querySelector ? (sel.querySelector(".p-menu-item-title-txt").textContent || "").trim() : "",
      targetVisible: st ? st.visibility !== "hidden" && st.display !== "none" : false,
      targetSelected: target ? !!target.querySelector(".p-menu-item-selected") : false,
    });
  })()`;
  const v = await ziniaoEval(cdp, js);
  if (typeof v !== "string") return "诊断失败: " + JSON.stringify(v);
  try {
    const d = JSON.parse(v) as { url: string; selected: string; targetVisible: boolean; targetSelected: boolean };
    return `当前 ${d.url}，选中菜单「${d.selected}」，目标项可见=${d.targetVisible} 选中=${d.targetSelected}`;
  } catch (e) {
    return "诊断解析失败: " + e;
  }
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

  // 1. 展开父分组（若未展开），并以「目标项可见」作为展开完成的信号
  if (groupId) {
    const st = await expandTiktokShopGroup(cdp, groupId);
    if (st === "no_group") return `分组「${groupId}」不存在，菜单可能已改版`;
    if (st === "no_header") return `分组「${groupId}」缺少展开标题`;
    if (st === "clicked") log?.("  展开分组中…", "step");
    // 轮询目标链接可见（覆盖展开动画），最多 3s
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      if (await isTiktokShopLinkVisible(cdp, item.href)) break;
    }
    if (!(await isTiktokShopLinkVisible(cdp, item.href))) {
      return `展开超时：分组「${groupId}」3s 内菜单项「${item.name}」仍不可见（菜单可能已改版或页面被拦截）`;
    }
  }

  // 2. 点击目标菜单项
  const ck = await clickTiktokShopLink(cdp, item.href);
  if (ck === "no_target") return `未找到菜单项「${item.name}」（${item.href}）`;

  // 3. 轮询验证：SPA 跳转后 pathname 应与目标一致（最多 6s）
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    try {
      const url = await getTiktokShopLocation(cdp);
      if (pathOf(url, url) === targetPath) return `切换成功 ${item.name} → ${url}`;
    } catch {
      /* CDP 偶发连接错误时继续轮询 */
    }
  }

  // 4. 失败诊断：区分「点击未生效」与「跳转后被重定向」
  const diag = await getTiktokShopSwitchDiagnose(cdp, item.href);
  return `切换未生效：${item.name} → ${diag}（期望 ${targetPath}）`;
}
