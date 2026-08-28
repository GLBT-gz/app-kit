// ============================================================
//  展示名排序比较（浏览器选项下拉等用）
//
//  `localeCompare("zh-Hans-CN")` 的 ICU 拼音 collation 会把汉字排在
//  拉丁字母之前（'马' < 'T'），导致「马来本土01」排在「TK马来」前，
//  观感不符直觉。本比较器：ASCII/拉丁/数字 优先于汉字，汉字内按拼音。
// ============================================================

/** 浏览器选项展示名比较：ASCII 优先，汉字按拼音（zh-Hans-CN）；短串在前 */
export function compareBrowserDisplayName(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ca = a[i] ?? "";
    const cb = b[i] ?? "";
    if (ca === cb) continue;
    if (ca === "") return -1; // a 已结束 → 短串在前
    if (cb === "") return 1;
    const aAscii = ca.charCodeAt(0) < 128;
    const bAscii = cb.charCodeAt(0) < 128;
    // 一个 ASCII 一个汉字 → ASCII 在前
    if (aAscii !== bAscii) return aAscii ? -1 : 1;
    // 同为 ASCII → 直接按码点/大小写比较（保持稳定）；同为汉字 → 拼音
    return ca.localeCompare(cb, "zh-Hans-CN");
  }
  return 0;
}
