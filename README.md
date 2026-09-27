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

6. **`<LogPanel>` / `<SheetTable>` 集成必须在 flex 容器直接子级**（016-自动提现 2026-09-24 实战教训）。
   这两个组件内部用 `position: absolute; inset: 0` 撑满父级（`.log-panel-list` / `.sheet-table-scroll`），
   依赖父级 chain `.log-panel-body` / `.log-panel` / `LogPanel` 都是 `flex: 1; min-height: 0`。
   **禁止在父级与 LogPanel/SheetTable 之间包 `<div style="flex:1;min-height:0;overflow:auto">` 中间层**——
   该中间层会打断 flex chain 导致子元素高度坍塌到 3px。
   正确做法：LogPanel/SheetTable 直接放在外层 flex column 容器的子级，由 `.xxx-container > .log-panel` CSS
   提供 `flex: 1; min-height: 0`。**排查指南**：日志/表格不可见时 DevTools 看 `.log-panel-list` 高度——
   不是 0 / 满容器，而是 3px ~ 10px，几乎肯定是中间层 div 干扰。

7. **`<LogPanel>` 的 `titleExtra` 与 `hideHeader` 互斥——`hideHeader=true` 时 `titleExtra` 被静默吞掉**（016-自动提现 2026-09-27 实战教训）。
   LogPanel 内部（`shared/ui/src/components/LogPanel.tsx:312`）：
   ```tsx
   {!hideHeader && (
     <div className="log-panel-header">
       ...
       {titleExtra}   ← line 335：titleExtra 在 !hideHeader 块内
       ...
     </div>
   )}
   ```
   `hideHeader=true` 时整块标题栏 JSX 被跳过，**titleExtra 静默不渲染**——无报错无提示。
   开发模式下 LogPanel 会 `console.warn` 提示此互斥，但**不阻止渲染**（不破坏现有调用）。
   **正确模式**：`hideHeader=true` + 外层自渲染 header（含 count + 清除按钮）：
   ```tsx
   <div className="schedule-log-header">
     <span>{logCtx.count}条日志</span>
     <Button onClick={() => logCtx.clear()}>清除日志</Button>
   </div>
   <LogPanel log={logCtx} hideHeader />
   ```
   参考：016 `schedule.tsx:577-585` / `shopee.tsx:152-160`。
   **产品级硬规则 R-LOG-1**：任何「日志面板」必须有「清除日志」按钮（用 `logCtx.clear()`）。

8. **跨项目一致性检查命令**——排查上述两条坑点的系统性 bug：
   ```bash
   # 找所有用 hideHeader 的 LogPanel 调用，看外层是否有清除按钮
   grep -rn '<LogPanel .* hideHeader' glbt-apps/projects --include='*.tsx' | \
     xargs -I {} sh -c 'echo "=== {} ===; grep -E "logCtx\.clear\(\)|log-panel-clear-btn" $(echo {} | cut -d: -f1) || echo MISSING'
   ```
   已知漏点（2026-09-27 调研）：015 shops/auto-reply, 013 waybill, 007 kdocs,
   008 weekly-data/sample, 001 App, 004 App, 002 weekly/measure/weee/settlement/billing,
   003 多个, 010 listing。**修复时按项目拆 commit，仿 schedule.tsx 模式**。

## 命令一致性校验

```bash
node scripts/check-commands.mjs
```

同时解析 `tauri_bridge.rs` 的注册列表、`shared/ui/src/api.ts` 的调用、`glbt-apps` 各项目
`build.rs` 与 `Cargo.toml`，输出不一致项。退出码 0 = 全部一致，1 = 有错误（可挂 CI）。
