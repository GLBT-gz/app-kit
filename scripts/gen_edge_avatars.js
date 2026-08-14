// 生成 shared/core/src/browser/edge_avatars.rs：从 edge-avatars/final/idx_*.png 生成 Rust 预设头像资源表
//
// 输入：edge-avatars/final/ 下的 idx_<index>.png + list.json（Edge 设置页头像选择器数据）
//   重新提取方法（Edge 更新头像后）：
//   1. headless 启动 Edge 打开 edge://settings/profiles
//   2. 读取设置页 avatar 选择器元素 settings-avatar-select 的 list 属性
//      （21 项，每项含 index/label/url/selected），按 url 把每张图存为 final/idx_<index>.png
//   3. 运行本脚本
//
// index 0 是微软账户照片（isGaiaAvatar），不属预设；index 23 为空槽位，均跳过
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "edge-avatars", "final");
const OUT = path.join(__dirname, "..", "shared", "core", "src", "browser", "edge_avatars.rs");
const SKIP = new Set([0, 23]);
const LABELS = {
  20: "默认虚拟形象", 21: "狗", 22: "猫", 24: "刺猬", 25: "宇航员",
  26: "忍者", 27: "雪人", 28: "恐龙", 29: "咖啡", 30: "西瓜",
  31: "同心圆", 32: "寿司", 33: "披萨", 34: "市/县", 35: "篮球",
  36: "足球", 37: "计算器", 38: "铅笔", 39: "仙人掌", 40: "绿色植物",
};

const header = `// ============================================================
// Edge 预设头像资源表（由 scripts/gen_edge_avatars.js 生成，勿手工编辑）
// 来源：Edge 设置页（edge://settings/profiles）头像选择器 list 数据，
//   提取自 Edge headless 实例的 settings-avatar-select.list（2026-08-14）。
// index -> 图案 完整映射：
//   20=默认虚拟形象 21=狗 22=猫 24=刺猬 25=宇航员 26=忍者 27=雪人
//   28=恐龙 29=咖啡 30=西瓜 31=同心圆 32=寿司 33=披萨 34=市/县
//   35=篮球 36=足球 37=计算器 38=铅笔 39=仙人掌 40=绿色植物
//   （index 23 为空槽位，无预设图；index 0 为微软账户照片，非预设）
// 用途：Edge 未登录但手动设置了预设头像的 profile（Local State
//   info_cache.avatar_icon=chrome://theme/IDR_PROFILE_AVATAR_N）由此恢复。
//   Edge 没有 Chrome 的 {User Data}\\Avatars 缓存目录，只能内嵌资源。
// Edge 更新头像后：重新提取 final/idx_*.png 并运行本脚本再生成。
// ============================================================

/// Edge 预设头像（index -> PNG base64）
pub const EDGE_AVATAR_INDEX_FILES: &[(usize, &str)] = &[
`;

const footer = `];

/// 按 avatar_icon（chrome://theme/IDR_PROFILE_AVATAR_N）读取 Edge 预设头像原始 PNG 字节。
/// 找不到（非预设 index / 未设置头像）返回 None；未覆盖的 index 会打印日志提示
/// Edge 头像列表可能已更新（可运行 scripts/gen_edge_avatars.js 重新生成资源表）。
pub fn read_edge_preset_avatar(avatar_icon: &str) -> Option<Vec<u8>> {
    let marker = "IDR_PROFILE_AVATAR_";
    let idx = avatar_icon.rfind(marker)?;
    let tail = &avatar_icon[idx + marker.len()..];
    let n: usize = match tail.parse() {
        Ok(n) => n,
        Err(_) => {
            eprintln!(
                "[edge_avatars] 无法解析预设头像 index: {:?}（可能 Edge 改变了 avatar_icon 格式）",
                tail
            );
            return None;
        }
    };
    let b64 = match EDGE_AVATAR_INDEX_FILES.iter().find(|(i, _)| *i == n) {
        Some((_, b)) => *b,
        None => {
            eprintln!(
                "[edge_avatars] 未覆盖的预设头像 index {}（可能 Edge 新增了头像；可运行 scripts/gen_edge_avatars.js 重新生成资源表）",
                n
            );
            return None;
        }
    };
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(b64).ok()
}
`;

let body = "";
const files = fs.readdirSync(DIR).filter(f => /^idx_\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
for (const f of files) {
  const idx = parseInt(f.slice(4));
  if (SKIP.has(idx)) continue;
  const b64 = fs.readFileSync(path.join(DIR, f)).toString("base64");
  const label = LABELS[idx] || "?";
  body += `    (${idx}, // ${label}\n        "${b64}"),\n`;
}

const out = header + body + footer;
fs.writeFileSync(OUT, out, "utf8");
console.log("written:", OUT, "size:", (out.length / 1024).toFixed(1) + "KB");
