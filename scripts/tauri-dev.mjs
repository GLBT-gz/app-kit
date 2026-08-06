#!/usr/bin/env node
/**
 * Tauri 开发启动器：自动挑选空闲端口，彻底告别固定端口冲突。
 *
 * 用法（在各项目目录下）：
 *   npm run tauri dev      或  pnpm tauri dev
 *   node <app-kit>/scripts/tauri-dev.mjs dev
 *
 * 原理：
 *   1. 探测一个空闲端口
 *   2. 生成临时 tauri 配置片段（覆盖 build.devUrl 为该端口）
 *   3. 以 PORT 环境变量 + `tauri dev --config <临时文件>` 启动
 *   4. vite 从 PORT 环境变量读取端口（见 shared/ui 的 createViteConfig 工厂）
 *
 * 非 dev 子命令（build 等）直接透传，不注入端口（生产模式走 frontendDist，无需端口）。
 */
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const subcommand = args[0] && !args[0].startsWith("-") ? args[0] : "dev";

let tmpConfig;

// 首选固定端口：优先从当前项目 src-tauri/tauri.conf.json 的 build.devUrl 解析端口
// （各项目已在自己配置里固定端口，如 006 为 5176），不再硬编码默认端口。
// 固定端口保证 dev 多次启动 origin 一致，localStorage 缓存不因端口变化丢失。
let preferredPort;
try {
  const conf = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"));
  const devUrl = conf.build?.devUrl;
  if (typeof devUrl === "string") {
    const m = devUrl.match(/:(\d+)\/?$/);
    if (m) preferredPort = Number(m[1]);
  }
} catch {
  /* 读不到时使用随机端口 */
}
// package.json 显式声明 tauri-dev-port 时覆盖（个别需要强制端口时使用）
try {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  if (typeof pkg["tauri-dev-port"] === "number" && pkg["tauri-dev-port"] > 0) {
    preferredPort = pkg["tauri-dev-port"];
  }
} catch {
  /* 忽略 */
}

/**
 * 探测一个空闲端口（优先项目固定端口，被占用时退回随机端口）
 *
 * 项目固定端口空闲 → 用固定端口；被占用或未配置 → 随机端口。
 */
function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const tryListen = (port) => {
      const srv = createServer();
      srv.unref();
      srv.on("error", (err) => {
        if (err.code === "EADDRINUSE" && port === preferredPort) {
          tryListen(0); // 固定端口被占用，退回随机端口
        } else {
          reject(err);
        }
      });
      srv.listen(port, "127.0.0.1", () => {
        const used = srv.address().port;
        srv.close(() => resolvePort(used));
      });
    };
    if (preferredPort) {
      tryListen(preferredPort);
    } else {
      tryListen(0); // 项目未配置固定端口：随机端口
    }
  });
}

/**
 * 结束正在运行的旧实例：Windows 下 debug 版 exe 被运行中的实例锁住时，
 * cargo 无法覆盖（拒绝访问 / os error 5），导致 tauri dev 启动失败。
 * 按当前项目 package.json 的 name（即 target/debug/<name>.exe）结束旧实例。
 */
function killRunningInstance() {
  let pkgName = "";
  try {
    pkgName = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).name ?? "";
  } catch {
    return;
  }
  if (!pkgName) return;
  try {
    if (process.platform === "win32") {
      const r = spawnSync("taskkill", ["/IM", `${pkgName}.exe`, "/F", "/T"], { stdio: "ignore" });
      if (r.status === 0) console.log(`[tauri-dev] 已结束旧实例 ${pkgName}.exe`);
    } else {
      spawnSync("pkill", ["-x", pkgName], { stdio: "ignore" });
    }
  } catch {
    /* 无旧实例或权限不足时忽略 */
  }
}

/** 定位 tauri CLI：优先本地 @tauri-apps/cli，退回 npx */
function resolveTauriCommand() {
  const local = resolve(process.cwd(), "node_modules/@tauri-apps/cli/tauri.js");
  if (existsSync(local)) {
    return { cmd: process.execPath, prefixArgs: [local] };
  }
  return { cmd: "npx", prefixArgs: ["--no-install", "tauri"] };
}

function cleanup() {
  if (tmpConfig) {
    try {
      unlinkSync(tmpConfig);
    } catch {
      /* 忽略清理失败 */
    }
    tmpConfig = undefined;
  }
}

async function main() {
  const isDev = subcommand === "dev";

  const env = { ...process.env };
  if (isDev) {
    const port = await getFreePort();
    tmpConfig = join(tmpdir(), `tauri-dev-${process.pid}.json`);
    writeFileSync(
      tmpConfig,
      JSON.stringify({ build: { devUrl: `http://localhost:${port}` } })
    );
    env.PORT = String(port);
    console.log(`[tauri-dev] 动态端口 = ${port}（devUrl=http://localhost:${port}）`);
    // 先结束旧实例，避免 debug exe 被锁导致 cargo 无法覆盖（拒绝访问）
    killRunningInstance();
  }

  const { cmd, prefixArgs } = resolveTauriCommand();
  // dev 子命令归一化：默认 subcommand 也需显式注入，否则 clap 将 --config 当顶层参数报错
  const fullArgs = isDev
    ? [...prefixArgs, subcommand, ...(tmpConfig ? ["--config", tmpConfig] : [])]
    : [...prefixArgs, ...args];
  const child = spawn(cmd, fullArgs, {
    env,
    stdio: "inherit",
    // Windows 下 npx 是 .cmd，需要经 shell 解析
    shell: cmd === "npx",
  });

  child.on("error", (err) => {
    console.error(`[tauri-dev] 启动失败: ${err.message}`);
    cleanup();
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    cleanup();
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

// Ctrl+C / 退出时清理临时配置
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("exit", cleanup);

main();
