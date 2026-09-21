# app-kit — 中性共享框架（AGENTS.md）

## 这是什么

**业务无关**的中性框架层，跨仓库共享：`glbt-apps`（公司层）与个人层应用均通过精确相对路径引用。改动会波及其它所有引用方。

## 结构

```
shared/core/        appkit-core：通用能力库（config/encoding/store/browser/system）
                    └─ src/tauri_bridge.rs  Tauri 插件桥接（命令注册唯一入口）
shared/automation/  appkit-automation：浏览器自动化（CDP）
shared/ui/          @appkit/ui：前端共享组件与命令封装（api.ts）
scripts/            构建/工具脚本
```

## 纪律

- **保持业务无关**：不引入具体业务概念；新能力先讨论归属（core / automation / ui）再实现。
- 改动影响面大（glbt-apps 等引用方）：**讨论先行**，改后同步验证引用方构建。
- git 规范：`<type>(<scope>): 中文`；改 Rust 必须 `cargo check` 通过。
- **多人共用 worktree 协作纪律**（2026-09-21 真实事故教训）：commit 前**必看** `git status` + `git diff --cached --stat`，确认 staged 只含自己的改动——`git checkout HEAD -- <file>` / `git restore <file>` 会**静默覆盖** worktree 里**任何人未提交的本地修改**（git 不可逆）。详细 → `../my-skills/git-工作流/references/多人协作-worktree事故教训.md`。
