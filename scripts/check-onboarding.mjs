#!/usr/bin/env node
/**
 * 框架接入骨架校验（onboarding check）
 *
 * 按 `app-kit/docs/框架接入指南.md` 6 步硬性骨架自动校验每个项目，
 * 让"AI 接手新项目时漏掉某一步"立刻可见（可挂 CI / pre-commit）。
 *
 * ## 适用对象
 *
 * 启发式：src-tauri/Cargo.toml 引了 `platform-ziniao` 或 `platform-edecker` 的项目。
 * （注意：用 `@glbt/ui` workspace 依赖不能作为判定——店小秘 / Temu 等 M3 平台也用
 * `@glbt/ui`，但不是紫鸟项目。）
 *
 * ## 检查项（任一不满足即报错）
 *
 * 1. `src/main.tsx` 调 `registerZiniaoFramework()`（一站式 4 项注册）
 * 2. `src/main.tsx` 有 `import "@glbt/ui/styles"`（紫鸟专用 CSS）
 * 3. `src/vite-env.d.ts` `declare module "@glbt/ui/styles"`
 * 4. `src-tauri/src/lib.rs` `.setup` 块调 `platform_ziniao::registry::register()`
 * 5. `src-tauri/Cargo.toml` 引 `platform-ziniao` 且 `features = ["plugin"]` → lib.rs
 *    必须用 plugin helper / 手动展开 plugin 函数（M2-A / M2-B）
 *    否则必须有项目自有 #[tauri::command] 函数调 `platform_ziniao::` 内部模块（M2-C）
 * 6. `src-tauri/Cargo.toml` 引 `platform-edecker` → lib.rs 必须调
 *    `platform_edecker::registry::register()`
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-onboarding.mjs                       # 默认扫 ../glbt-apps/projects
 * node scripts/check-onboarding.mjs --root <path>          # 自定义根
 * node scripts/check-onboarding.mjs --project 008-xxx      # 只查一个项目
 * node scripts/check-onboarding.mjs --json                 # 输出 JSON
 * ```
 *
 * 退出码：0 = 全部通过；1 = 有错误（CI 可挂）
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const projIdx = args.indexOf("--project");
const PROJECT_ROOT =
  rootIdx >= 0 ? resolve(args[rootIdx + 1]) : resolve(ROOT, "../glbt-apps/projects");
const ONLY_PROJECT = projIdx >= 0 ? args[projIdx + 1] : null;
const AS_JSON = args.includes("--json");

/** @type {{ project: string; errors: string[]; warnings: string[] }[]} */
const results = [];

function readIfExists(p) {
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

/** 递归读目录所有 .rs 文件内容拼接 */
function readAllRs(dir) {
  if (!existsSync(dir)) return "";
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(readAllRs(p));
    else if (e.isFile() && p.endsWith(".rs")) out.push(readFileSync(p, "utf8"));
  }
  return out.join("\n");
}

// 去掉单行 // 注释和 /* ... */ 多行注释，避免误判注释里的代码
function stripComments(src, lang) {
  if (lang === "rust") {
    // Rust 多行注释 /* ... */ + 行尾 // 注释
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  }
  // JS/TS 单行 // + 多行块注释
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** 判定项目是否"调紫鸟"——只认 Rust 端 platform-ziniao / platform-edecker 依赖。
 *  不能用 @glbt/ui 判定（店小秘/Temu/海多客 等 M3 平台也用 @glbt/ui）。
 */
function isZiniaoProject(pkg, cargo) {
  if (/platform-ziniao\b/.test(cargo)) return true;
  if (/platform-edecker\b/.test(cargo)) return true;
  return false;
}

/** 检查项目骨架 */
function checkProject(projDir) {
  const project = projDir.replace(/\\/g, "/").split("/").pop();
  const errors = [];
  const warnings = [];

  const pkgPath = join(projDir, "package.json");
  const mainPath = join(projDir, "src/main.tsx");
  const viteEnvPath = join(projDir, "src/vite-env.d.ts");
  const cargoPath = join(projDir, "src-tauri/Cargo.toml");
  const libRsPath = join(projDir, "src-tauri/src/lib.rs");

  if (!existsSync(pkgPath)) {
    warnings.push("package.json 不存在，跳过");
    return { project, errors, warnings };
  }
  const pkg = readIfExists(pkgPath);
  const cargo = readIfExists(cargoPath);
  const main = readIfExists(mainPath);
  const viteEnv = readIfExists(viteEnvPath);
  const libRs = readIfExists(libRsPath);
  // 扫描所有 src-tauri/src/**/*.rs（014 紫鸟命令在 ziniao.rs 子模块，不在 lib.rs）
  const allRs = readAllRs(join(projDir, "src-tauri/src"));
  // 去除注释，避免误判注释里的代码
  const mainClean = stripComments(main, "js");
  const libRsClean = stripComments(libRs, "rust");
  const allRsClean = stripComments(allRs, "rust");

  if (!isZiniaoProject(pkg, cargo)) {
    return { project, errors, warnings: ["非紫鸟业务项目，跳过骨架检查"] };
  }

  // 检查 1: main.tsx 调 registerZiniaoFramework()
  if (!/registerZiniaoFramework\s*\(/.test(mainClean)) {
    errors.push(
      `src/main.tsx 缺 registerZiniaoFramework() 调用（紫鸟一站式注册 4 项：数据项 + transform + 浏览器适配器 + UI 扩展）。` +
        `\n    修法：见 app-kit/docs/框架接入指南.md §2. 常见错误：只调单项 registerZiniaoUIExtension()（缺 3 项）`,
    );
  }
  if (!/import\s+["']@glbt\/ui\/styles["']/.test(mainClean)) {
    errors.push(
      `src/main.tsx 缺 import "@glbt/ui/styles"（紫鸟专用 CSS 模块）。` +
        `\n    修法：见 app-kit/docs/框架接入指南.md §2.`,
    );
  }

  // 检查 2: vite-env.d.ts declare "@glbt/ui/styles"
  if (!/declare\s+module\s+["']@glbt\/ui\/styles["']/.test(viteEnv)) {
    errors.push(
      `src/vite-env.d.ts 缺 declare module "@glbt/ui/styles"。` +
        `\n    修法：在 vite-env.d.ts 末尾加：declare module "@glbt/ui/styles";`,
    );
  }

  // 检查 3+4+5: 紫鸟 Rust 端接入模式（3 种合法实现）
  if (/platform-ziniao\s*=/.test(cargo)) {
    // 3 模式分支：M2-A plugin helper / M2-B 手动展开 plugin 函数 / M2-C 项目自有命令
    const usesPluginFeature = /platform-ziniao\s*=[^[\n]*(\[[^\]]*\])?/g.test(cargo) &&
      /features\s*=\s*\[[^\]]*["']plugin["']/.test(cargo);

    if (usesPluginFeature) {
      // M2-A 或 M2-B：plugin feature 已开，命令注册要么用 helper 要么手动展开
      const usesHelper = /\.invoke_handler\s*\(\s*platform_ziniao::plugin::commands\s*\(\s*\)\s*\)/.test(libRsClean);
      const usesManualExpansion = /tauri::generate_handler![\s\S]*?platform_ziniao::plugin::ziniao_/.test(libRsClean);
      if (!usesHelper && !usesManualExpansion) {
        errors.push(
          `src-tauri/Cargo.toml 的 platform-ziniao 已开 features=["plugin"]，但 src-tauri/src/lib.rs 缺紫鸟命令注册：` +
            `\n    • 模式 M2-A（推荐）：在 .invoke_handler 里加 platform_ziniao::plugin::commands()` +
            `\n    • 模式 M2-B：在 .invoke_handler(tauri::generate_handler![..., platform_ziniao::plugin::ziniao_xxx, ...]) 里逐条展开 33 个命令`,
        );
      }
    } else {
      // M2-C：未开 plugin feature，命令由项目自有 #[tauri::command] 函数调 platform_ziniao 内部模块
      const hasOwnCommands = /#\[tauri::command\][\s\S]*?platform_ziniao::/.test(allRsClean);
      if (!hasOwnCommands) {
        errors.push(
          `src-tauri/Cargo.toml 的 platform-ziniao 未开 features=["plugin"]（M2-C 模式），但 src-tauri/src/**/*.rs 没找到项目自有的 #[tauri::command] 函数调用 platform_ziniao::内部模块。` +
            `\n    修法一（M2-C 老模式）：在项目 src-tauri/src/ 某模块手写 33 个 #[tauri::command] 函数，每个内部调 platform_ziniao::对应函数（参照 008 / 014）。` +
            `\n    修法二（M2-A 新模式，推荐新项目）：Cargo.toml 改 platform-ziniao = { ..., features = ["plugin"] }，lib.rs 调 platform_ziniao::plugin::commands()。`,
        );
      }
    }

    // 检查 6: lib.rs .setup 块调 platform_ziniao::registry::register()
    if (!/platform_ziniao::registry::register\s*\(\s*\)/.test(libRsClean)) {
      errors.push(
        `src-tauri/src/lib.rs .setup 块缺 platform_ziniao::registry::register() 调用。` +
          `\n    修法：在 .setup(|app| { ... }) 块内调用，否则 detect_browsers 不会返回紫鸟。` +
          `\n    参照 app-kit/docs/框架接入指南.md §6.1。`,
      );
    }
  }

  // 检查 7: lib.rs .setup 块调 platform_edecker::registry::register()（如果引了 platform-edecker）
  if (/platform-edecker\s*=/.test(cargo) && !/platform_edecker::registry::register\s*\(\s*\)/.test(libRsClean)) {
    errors.push(
      `src-tauri/src/lib.rs .setup 块缺 platform_edecker::registry::register() 调用。` +
        `\n    修法：在 .setup(|app| { ... }) 块内调用，否则 detect_browsers 不会返回易得客。`,
    );
  }

  return { project, errors, warnings };
}

function main() {
  if (!existsSync(PROJECT_ROOT)) {
    console.error(`项目根目录不存在: ${PROJECT_ROOT}`);
    process.exit(1);
  }

  let dirs = readdirSync(PROJECT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(PROJECT_ROOT, e.name));

  if (ONLY_PROJECT) {
    dirs = dirs.filter((d) => d.endsWith(ONLY_PROJECT));
    if (dirs.length === 0) {
      console.error(`未找到项目: ${ONLY_PROJECT}`);
      process.exit(1);
    }
  }

  for (const d of dirs) {
    results.push(checkProject(d));
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const r of results) {
    if (r.errors.length > 0) totalErrors += r.errors.length;
    if (r.warnings.length > 0) totalWarnings += r.warnings.length;
  }

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          summary: { errors: totalErrors, warnings: totalWarnings, projects: results.length },
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\n📋 框架接入骨架校验（${results.length} 个项目，${totalErrors} 错 ${totalWarnings} 警）\n` +
        "=".repeat(70),
    );
    for (const r of results) {
      if (r.errors.length === 0 && r.warnings.length === 0) continue;
      console.log(`\n${r.project}`);
      for (const w of r.warnings) console.log(`  ⚠️  ${w}`);
      for (const e of r.errors) {
        console.log(`  ❌ ${e}`);
      }
    }
    if (totalErrors === 0 && totalWarnings === 0) {
      console.log("\n✅ 全部通过\n");
    } else if (totalErrors === 0) {
      console.log("\n🟡 仅警告，无错误\n");
    } else {
      console.log(`\n❌ ${totalErrors} 个错误需要修复（详见 app-kit/docs/框架接入指南.md）\n`);
    }
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();