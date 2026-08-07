# app-kit

中性框架层，与业务无关。跨仓库共享：`glbt-apps`（公司层）与 `my-apps`（个人层）均通过精确相对路径引用。

## 目录结构

```
shared/
├── core/           appkit-core：通用能力库（config/encoding/store/browser/system）
│   └── src/
│       ├── tauri_bridge.rs   Tauri 插件桥接（命令注册的唯一入口）
│       └── browser/          浏览器检测/配置（仅 cmd-browser 启用时编译）
├── automation/     appkit-automation：浏览器自动化
└── ui/             @appkit/ui：前端共享组件与命令封装（api.ts）
scripts/
└── check-commands.mjs   命令一致性校验脚本
```

## appkit-core 命令体系

命令按 feature 分组门控，**未启用的命令不参与编译**：

| feature | 命令数 | 内容 |
|---|---|---|
| `cmd-browser` | 11 | 浏览器检测/配置/进程管理 |
| `cmd-files` | 4 | 数据文件管理 |
| `cmd-utils` | 3 | 通用工具（打开目录/路径检查/保存文件） |
| `cmd-db` | 2 | SQLite 表管理（rusqlite 为 optional 依赖，仅启用时编译） |
| `cmd-full` | 18 | 组合：`cmd-browser`+`cmd-files`+`cmd-utils`（多数业务项目） |
| `cmd-lite` | 7 | 组合：`cmd-files`+`cmd-utils`（纯数据类项目，如 005） |

项目用法（在项目 `src-tauri/Cargo.toml`）：

```toml
appkit-core = { path = "../../../../app-kit/shared/core", features = ["bridge", "cmd-full"] }
# 需要数据库表管理时追加：features = ["bridge", "cmd-full", "cmd-db"]
```

同时在项目 `build.rs` 的 `InlinedPlugin::commands(&[...])` 中注册所需命令。

## 关键坑点（务必阅读）

1. **`plugin::Builder::invoke_handler` 是替换语义，不是追加**。
   多次调用 `invoke_handler` 只有最后一次生效。注册多条命令必须在**一次**
   `generate_handler!` 中完成（参见 `tauri_bridge.rs::init`）。

2. **`generate_handler!` 支持每条命令前的 `#[cfg(feature)]` 属性**。
   feature 门控应写在命令前，而不是用链式调用分组。

3. **改 browser 模块代码只会触发启用 `cmd-browser` 的项目重编译**。
   新增/修改底层模块时，注意其 feature 归属（`browser` 与 `system::port/process` 属于 `cmd-browser`）。

4. **三处必须同步**：新增一条命令需要改
   ① `tauri_bridge.rs`（函数 + `init()` 列表）、② 各项目 `build.rs`、③ 前端 `api.ts`。
   改完跑校验脚本（见下）确认一致。

5. **前端 `plugin:appkit-core|xxx` 调用找不到命令 = not found**，编译期不报错。
   常见原因：命令未注册 / build.rs 未列出 / feature 未启用。

## 命令一致性校验

```bash
node scripts/check-commands.mjs
```

同时解析 `tauri_bridge.rs` 的注册列表、`shared/ui/src/api.ts` 的调用、`glbt-apps` 各项目
`build.rs` 与 `Cargo.toml`，输出不一致项。退出码 0 = 全部一致，1 = 有错误（可挂 CI）。
