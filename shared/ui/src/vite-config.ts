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
import { realpathSync } from "fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import type { Plugin } from "vite";

// ── copyFontsPlugin（从原 vite-plugins.ts 抽取，保持向后兼容） ──

import { copyFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";

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
}

export function createViteConfig(options: ViteConfigOptions) {
  const {
    port,
    enableTailwind = true,
    enableFonts = true,
    strictPort = true,
    watchSrcTauri = false,
    extraPlugins = [],
    extraAliases = {},
  } = options;

  const root = realpathSync(process.cwd());
  const host = process.env.TAURI_DEV_HOST || false;

  const plugins: any[] = [react(), ...extraPlugins];
  if (enableFonts) plugins.push(copyFontsPlugin());

  return defineConfig({
    root,
    publicDir: (enableFonts
      ? [resolve(root, "public"), resolve(UI_ROOT, "public")]
      : resolve(root, "public")) as unknown as string | false | undefined,
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
      strictPort,
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
    build: {
      outDir: resolve(root, "dist"),
    },
    clearScreen: false,
  });
}
