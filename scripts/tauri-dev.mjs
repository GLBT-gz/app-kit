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
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const subcommand = args[0] && !args[0].startsWith("-") ? args[0] : "dev";

let tmpConfig;

/** 探测一个空闲端口 */
function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
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
  }

  const { cmd, prefixArgs } = resolveTauriCommand();
  const fullArgs = [...prefixArgs, ...args, ...(tmpConfig ? ["--config", tmpConfig] : [])];
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
