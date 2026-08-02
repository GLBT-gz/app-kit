/**
 * 共享 Vite 配置工厂函数
 *
 * 统一各子项目的 vite.config.ts，消除配置不一致问题。
 * 用法：
 *   import { createViteConfig } from "@appkit/ui/vite-config";
 *   export default createViteConfig({ port: 5173 });
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { realpathSync, rmSync } from "fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import type { Plugin } from "vite";

// ── copyFontsPlugin（从原 vite-plugins.ts 抽取，保持向后兼容） ──

import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync, readFileSync } from "fs";
import { resolve as pathResolve, extname } from "path";

// 以本文件自身位置（shared/ui/src/vite-config.ts）定位 shared/ui 根目录，
// 无论被哪个目录下的项目引用，路径都正确。
const UI_ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");

function copyFontsPlugin(): Plugin {
  return {
    name: "appkit-copy-fonts",
    closeBundle() {
      const projectRoot = realpathSync(process.cwd());
      const fontsSrc = pathResolve(UI_ROOT, "public/fonts");
      const fontsDest = pathResolve(projectRoot, "dist/fonts");

      if (!existsSync(fontsSrc)) {
        console.warn(`[copy-fonts] 字体源目录不存在: ${fontsSrc}`);
        return;
      }

      if (!existsSync(fontsDest)) {
        mkdirSync(fontsDest, { recursive: true });
      }

      for (const file of readdirSync(fontsSrc)) {
        copyFileSync(pathResolve(fontsSrc, file), pathResolve(fontsDest, file));
      }
      console.log(`[copy-fonts] ✓ 已复制 ${fontsSrc} -> ${fontsDest}`);
    },
  };
}

// ── extraPublicDirsPlugin（外部目录构建时复制到 dist / 开发时中间件服务） ──

export interface ExtraPublicDir {
  /** 源目录，相对项目根目录，如 "../../../app-icons/icons" */
  src: string;
  /** URL 访问前缀，如 "/icons"，构建时复制到 dist/<前缀>，开发时按 /<前缀>/* 提供静态服务 */
  prefix: string;
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function copyDirRecursive(src: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = pathResolve(src, entry.name);
    const destPath = pathResolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function extraPublicDirsPlugin(root: string, extraDirs: ExtraPublicDir[]): Plugin {
  const dirs = extraDirs.map((d) => ({
    src: pathResolve(root, d.src),
    prefix: d.prefix.startsWith("/") ? d.prefix : `/${d.prefix}`,
  }));

  return {
    name: "appkit-extra-public-dirs",
    configureServer(server) {
      for (const { src, prefix } of dirs) {
        if (!existsSync(src)) {
          console.warn(`[extra-dirs] 源目录不存在: ${src}`);
          continue;
        }
        const srcRoot = pathResolve(src);
        server.middlewares.use((req, res, next) => {
          const rawUrl = (req.url || "").split("?")[0];
          if (!rawUrl.startsWith(prefix)) return next();
          const relPath = decodeURIComponent(rawUrl.slice(prefix.length)).replace(/^[/\\]+/, "");
          if (!relPath) return next();
          const filePath = pathResolve(srcRoot, relPath);
          if (!filePath.startsWith(srcRoot)) return next();
          let stat;
          try {
            stat = statSync(filePath);
          } catch {
            return next();
          }
          if (!stat.isFile()) return next();
          res.statusCode = 200;
          res.setHeader("Content-Type", MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream");
          res.end(readFileSync(filePath));
        });
      }
    },
    closeBundle() {
      const projectRoot = realpathSync(process.cwd());
      for (const { src, prefix } of dirs) {
        if (!existsSync(src)) {
          console.warn(`[extra-dirs] 源目录不存在: ${src}`);
          continue;
        }
        const dest = pathResolve(projectRoot, "dist", prefix.replace(/^\/+/, ""));
        // 先清空目标再复制（同步语义），避免删除/移动的图标残留在 dist
        rmSync(dest, { recursive: true, force: true });
        copyDirRecursive(src, dest);
        console.log(`[extra-dirs] ✓ 已复制 ${src} -> ${dest}`);
      }
    },
  };
}

// ── 工厂函数 ──

export interface ViteConfigOptions {
  /** 开发服务器端口 */
  port: number;
  /** 是否启用 Tailwind CSS（默认 true） */
  enableTailwind?: boolean;
  /** 是否启用共享字体复制（默认 true） */
  enableFonts?: boolean;
  /** 是否使用 strictPort（默认 true） */
  strictPort?: boolean;
  /** 是否监听 src-tauri 目录变更（默认 false） */
  watchSrcTauri?: boolean;
  /** 额外的 Vite 插件 */
  extraPlugins?: Plugin[];
  /** 额外的 Vite resolve alias */
  extraAliases?: Record<string, string>;
  /** 额外的 public 目录（如 app-icons 图标库），构建时复制到 dist、开发时中间件服务 */
  extraPublicDirs?: ExtraPublicDir[];
  /**
   * 预打包（optimizeDeps）排除的依赖。
   * 用于需要 vite 插件处理（如 new Worker(new URL(...)) 的 worker 打包）的库，
   * 例如 jassub（ESM 多文件 worker + wasm），排除后由 vite 即时转换。
   */
  optimizeDepsExclude?: string[];
}

export function createViteConfig(options: ViteConfigOptions) {
  const {
    port: defaultPort,
    enableTailwind = true,
    enableFonts = true,
    strictPort = true,
    watchSrcTauri = false,
    extraPlugins = [],
    extraAliases = {},
    extraPublicDirs = [],
    optimizeDepsExclude = [],
  } = options;

  // 动态端口：由 app-kit/scripts/tauri-dev.mjs 注入 PORT 时优先使用，
  // 并强制 strictPort，避免 vite 静默换端口导致 tauri devUrl 失配。
  const injectedPort = Number(process.env.PORT);
  const port = Number.isInteger(injectedPort) && injectedPort > 0 ? injectedPort : defaultPort;
  const effectiveStrictPort = process.env.PORT ? true : strictPort;

  const root = realpathSync(process.cwd());
  const host = process.env.TAURI_DEV_HOST || false;

  const plugins: any[] = [react(), ...extraPlugins];
  if (enableFonts) plugins.push(copyFontsPlugin());
  if (extraPublicDirs.length > 0) plugins.push(extraPublicDirsPlugin(root, extraPublicDirs));

  return defineConfig({
    root,
    plugins,
    resolve: {
      alias: {
        "@appkit/ui": resolve(UI_ROOT, "src"),
        ...extraAliases,
      },
      dedupe: ["react", "react-dom"],
    },
    css: enableTailwind
      ? {
          postcss: {
            plugins: [
              tailwindcss({
                config: resolve(UI_ROOT, "tailwind.config.js"),
              }),
              autoprefixer(),
            ],
          },
        }
      : undefined,
    server: {
      port,
      strictPort: effectiveStrictPort,
      host,
      fs: {
        allow: [root, resolve(root, ".."), resolve(root, "../..")],
      },
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: port + 100,
          }
        : undefined,
      watch: watchSrcTauri
        ? undefined
        : { ignored: ["**/src-tauri/**"] },
    },
    optimizeDeps: {
      exclude: optimizeDepsExclude,
    },
    build: {
      outDir: resolve(root, "dist"),
    },
    clearScreen: false,
  });
}
