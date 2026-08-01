#!/usr/bin/env node
/**
 * appkit-core 命令一致性校验脚本
 *
 * 对比三处命令清单，发现前后端/注册不一致：
 *   1. appkit-core 的 tauri_bridge.rs  init() 注册的命令（按 feature 分组）
 *   2. shared/ui 的 api.ts 中 pluginInvoke 调用的命令
 *   3. glbt-apps 各项目 build.rs 注册的命令 + Cargo.toml 启用的 feature
 *
 * 用法：node scripts/check-commands.mjs
 * 退出码：有错误返回 1，否则 0（可挂 CI）
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_BRIDGE = join(ROOT, "shared/core/src/tauri_bridge.rs");
const API_TS = join(ROOT, "shared/ui/src/api.ts");
const PROJECTS = resolve(ROOT, "../glbt-apps/projects");

let errors = 0;
let warnings = 0;

/** 解析 tauri_bridge.rs 的 init()：返回 { feature组: [命令名...] } */
function parseCoreCommands() {
  const src = readFileSync(CORE_BRIDGE, "utf8");
  const m = src.match(/pub fn init[\s\S]*?\.build\(\)/);
  if (!m) throw new Error("未找到 init() 函数");
  const block = m[0];
  const groups = {};
  const re = /#\[cfg\(feature = "(cmd-[a-z-]+)"\)\]\s*\n\s*([a-z_]+),/g;
  let hit;
  while ((hit = re.exec(block))) (groups[hit[1]] ??= []).push(hit[2]);
  return groups;
}

/** 解析 api.ts 中 pluginInvoke 调用的命令名 */
function parseApiCommands() {
  const src = readFileSync(API_TS, "utf8");
  const cmds = new Set();
  const re = /pluginInvoke\("([a-z_]+)"/g;
  let hit;
  while ((hit = re.exec(src))) cmds.add(hit[1]);
  return cmds;
}

/** 解析 build.rs 的 commands 列表 */
function parseBuildCommands(file) {
  const src = readFileSync(file, "utf8");
  const m = src.match(/\.commands\(&\[([\s\S]*?)\]\)/);
  if (!m) return [];
  const cmds = [];
  const re = /"([a-z_]+)"/g;
  let hit;
  while ((hit = re.exec(m[1]))) cmds.push(hit[1]);
  return cmds;
}

/** 解析项目 Cargo.toml 中 appkit-core 依赖启用的 feature */
function parseProjectFeatures(file) {
  const src = readFileSync(file, "utf8");
  const m = src.match(/appkit-core = \{[^}]*features\s*=\s*\[([^\]]*)\]\s*\}/);
  if (!m) return [];
  return m[1].match(/cmd-[a-z-]+/g) ?? [];
}

/** feature 组合展开：组合名 -> 基础组列表 */
const FEATURE_EXPAND = {
  "cmd-browser": "cmd-browser",
  "cmd-files": "cmd-files",
  "cmd-utils": "cmd-utils",
  "cmd-db": "cmd-db",
  "cmd-full": "cmd-browser,cmd-files,cmd-utils",
  "cmd-lite": "cmd-files,cmd-utils",
};

function expandFeatures(features) {
  const set = new Set();
  for (const f of features) {
    for (const sub of (FEATURE_EXPAND[f] ?? "").split(",")) if (sub) set.add(sub);
  }
  return set;
}

function log(level, msg) {
  console.log(`  ${level === "error" ? "[错误]" : "[警告]"} ${msg}`);
  if (level === "error") errors++;
  else warnings++;
}

console.log("========== appkit-core 命令一致性检查 ==========");

const groups = parseCoreCommands();
const coreAll = new Set(Object.values(groups).flat());
console.log(
  `core 注册命令：${coreAll.size} 个（${Object.entries(groups)
    .map(([g, c]) => `${g}:${c.length}`)
    .join(" ")}）`,
);

// [1] 前端调用 vs core 注册
const apiCmds = parseApiCommands();
console.log("\n[1] 前端 api.ts 调用 vs core 注册");
for (const c of apiCmds) {
  if (!coreAll.has(c))
    log("error", `前端调用 "${c}" 但 appkit-core 未注册（plugin:appkit-core|${c} 将 not found）`);
}
for (const c of coreAll) {
  if (!apiCmds.has(c)) log("warning", `core 命令 "${c}" 前端 api.ts 未封装（预留命令？）`);
}

// [2] 各项目 build.rs vs core / feature
console.log("\n[2] 各项目 build.rs 注册 vs core 定义 / Cargo.toml feature");
for (const name of readdirSync(PROJECTS)) {
  const dir = join(PROJECTS, name);
  const buildRs = join(dir, "src-tauri/build.rs");
  const cargoToml = join(dir, "src-tauri/Cargo.toml");
  if (!existsSync(buildRs) || !existsSync(cargoToml)) continue;

  const buildCmds = parseBuildCommands(buildRs);
  const features = parseProjectFeatures(cargoToml);
  const expectedGroups = expandFeatures(features);
  const expected = new Set([...expectedGroups].flatMap((g) => groups[g] ?? []));

  console.log(`\n[${name}] features=${features.join("+") || "无"} build.rs=${buildCmds.length} 条`);
  for (const c of buildCmds) {
    if (!coreAll.has(c))
      log("error", `build.rs 注册 "${c}" 但 core 未定义（对应命令被删/改名？）`);
  }
  if (expected.size > 0) {
    for (const c of expected) {
      if (!buildCmds.includes(c))
        log(
          "error",
          `feature 应包含 "${c}"（组：${[...expectedGroups].find((g) => (groups[g] ?? []).includes(c))}），但 build.rs 未注册`,
        );
    }
    for (const c of buildCmds) {
      if (!expected.has(c))
        log("error", `build.rs 注册 "${c}" 但项目 feature 未启用其命令组（运行时会 not found）`);
    }
  }
}

console.log(`\n========== 结果：${errors} 错误 / ${warnings} 警告 ==========`);
process.exit(errors > 0 ? 1 : 0);
