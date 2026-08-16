// ============================================================
// TikTok Shop 商家后台自动化公共组件（侧边栏菜单解析 + 路由切换）
//
// 基于紫鸟 CDP（ziniaoEval）在店铺环境内执行注入 JS：
// - 解析：读取 .p-menu-inner 侧边栏 → 顶层直达链接 + 可展开分组/子项
// - 切换：展开父分组 → 真实鼠标点击目标菜单项 → 前端轮询 URL 验证生效
//
// 关键约束（踩坑记录）：
// - runtime_evaluate 未启用 awaitPromise，注入 JS 只能同步执行，
//   展开/跳转的等待验证一律在前端轮询完成。
// - 点击必须走 CDP Input.dispatchMouseEvent 真实鼠标点击（isTrusted=true）：
//   `element.click()` 派发的事件 isTrusted=false，商家后台菜单组件会用
//   isTrusted 守卫忽略程序化点击（已踩坑）。
// - 选择器用 :scope > 限定父级范围（全局匹配可能命中不可见元素）。
// ============================================================

import { ziniaoEval, ziniaoMouseClick } from "./ziniao-api";

/** 菜单项（顶层直达链接或分组内子项） */
export interface TiktokShopMenuItem {
  name: string;
  href: string;
  key: string;
  selected: boolean;
}

/** 可展开分组（订单/商品/物流…）。注意：data-expose-id/data-tid 在 SPA 路由切换后会重新分配，
 *  只能用于本次解析展示，不可用于跨页面定位（定位目标项一律按 href 查找 + 向上找父分组展开） */
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

/**
 * 真实鼠标点击指定 href 的菜单项（isTrusted=true，绕过商家后台 isTrusted 守卫）。
 *
 * - 目标不可见（折叠在分组内）时：自动向上找 `.p-menu-inline` 父分组，真实点击 header 展开，
 *   返回 "expanding"（已点击 header，需等目标可见后重试）。
 * - 找不到目标时：内部轮询等待出现（菜单懒加载/路由切换后重渲染），约 2s 后仍无返回 "no_target"。
 *
 * 返回 clicked / expanding / already_expanded / no_target / covered / no_expander / eval_failed
 */
export async function clickTiktokShopLink(cdp: number, href: string): Promise<string> {
  const js = `(() => {
    const href = ${JSON.stringify(href)};
    const findTarget = () => {
      let t = null;
      document.querySelectorAll("a.sidebar-item-link").forEach((a) => {
        if (!t && (a.getAttribute("href") || "") === href) t = a;
      });
      return t;
    };
    const target = findTarget();
    if (!target) return JSON.stringify({ status: "no_target" });
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      // 不可见：向上找折叠分组，点 header 展开
      const group = target.closest(".p-menu-inline");
      const header = group && group.querySelector(":scope > .p-menu-item-header");
      if (!header) return JSON.stringify({ status: "no_expander" });
      if (header.getAttribute("aria-expanded") === "true") return JSON.stringify({ status: "already_expanded" });
      const hr = header.getBoundingClientRect();
      if (hr.width === 0 || hr.height === 0) return JSON.stringify({ status: "no_expander" });
      const hx = hr.x + hr.width / 2;
      const hy = hr.y + hr.height / 2;
      const hhit = document.elementFromPoint(hx, hy);
      if (hhit && hhit !== header && !header.contains(hhit) && !hhit.contains(header)) {
        return JSON.stringify({ status: "covered" });
      }
      return JSON.stringify({ status: "expanding", x: hx, y: hy });
    }
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit !== target && !target.contains(hit) && !hit.contains(target)) {
      return JSON.stringify({ status: "covered" });
    }
    return JSON.stringify({ status: "clicked", x: cx, y: cy });
  })()`;
  // 找不到目标时轮询等待（菜单懒加载/重渲染），最多约 2s
  for (let i = 0; i < 7; i++) {
    const v = await ziniaoEval(cdp, js);
    const d = typeof v === "string" ? (JSON.parse(v) as { status: string; x?: number; y?: number }) : null;
    if (!d) return "eval_failed";
    if (d.status === "no_target") {
      await sleep(300);
      continue;
    }
    if (d.status === "clicked" || d.status === "expanding") {
      if (typeof d.x === "number" && typeof d.y === "number") await ziniaoMouseClick(cdp, d.x, d.y);
    }
    return d.status;
  }
  return "no_target";
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
 * 切换到指定菜单项：点击目标（不可见时自动展开父分组）→ 轮询 URL 验证生效。
 *
 * 定位完全基于 href（不依赖 data-expose-id，SPA 路由切换后分组 id 会重新分配）。
 *
 * @param item 目标菜单项（href 必填）
 * @param log 可选日志回调
 * @returns 结果消息（成功 / 失败原因）
 */
export async function navigateTiktokShopRoute(
  cdp: number,
  item: TiktokShopMenuItem,
  log?: TtsLogFn,
): Promise<string> {
  const targetPath = pathOf(item.href, "https://seller-local.tiktok.com/");

  // 1. 点击目标；不可见时自动展开父分组后重试（最多 3 轮：展开 → 等可见 → 再点）
  let clicked = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ck = await clickTiktokShopLink(cdp, item.href);
    if (ck === "clicked") {
      clicked = true;
      break;
    }
    if (ck === "expanding") {
      log?.("  展开分组中…", "step");
      // 等目标可见（展开动画完成），最多 5s
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        if (await isTiktokShopLinkVisible(cdp, item.href)) break;
      }
      if (!(await isTiktokShopLinkVisible(cdp, item.href))) {
        return `展开超时：展开父分组后 5s 内菜单项「${item.name}」仍不可见`;
      }
      continue; // 已展开，重新点击目标
    }
    if (ck === "no_target") return `未找到菜单项「${item.name}」（${item.href}）`;
    if (ck === "covered") return `菜单项「${item.name}」被其他元素遮挡（页面可能有弹层/遮罩）`;
    if (ck === "no_expander") return `菜单项「${item.name}」不可见且找不到可展开的父分组`;
    if (ck === "already_expanded") {
      // header 已展开但目标仍不可见（渲染异常），再等一次
      await sleep(500);
      continue;
    }
    return `点击失败：${item.name}（${ck}）`;
  }
  if (!clicked) return `点击失败：${item.name}（展开重试超限）`;

  // 2. 轮询验证：SPA 跳转后 pathname 应与目标一致（最多 6s）
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    try {
      const url = await getTiktokShopLocation(cdp);
      if (pathOf(url, url) === targetPath) return `切换成功 ${item.name} → ${url}`;
    } catch {
      /* CDP 偶发连接错误时继续轮询 */
    }
  }

  // 3. 失败诊断：区分「点击未生效」与「跳转后被重定向」
  const diag = await getTiktokShopSwitchDiagnose(cdp, item.href);
  return `切换未生效：${item.name} → ${diag}（期望 ${targetPath}）`;
}
