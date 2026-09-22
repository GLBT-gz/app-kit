# app-kit — 中性共享框架（AGENTS.md）

## 这是什么

**业务无关**的中性框架层，跨仓库共享：`glbt-apps`（公司层）与个人层应用均通过精确相对路径引用。改动会波及其它所有引用方。

## 🤖 AI 会话开局指纹（必输出，2026-09-22 立）

AI 接到任务**第一句回复**必须粘贴并填充以下指纹；未输出 = 未读本文件 = 暂停接活等用户确认。

```
[机器]: <LINYANZHI-HOST 家里 / DESKTOP-2638SM0 公司>
[影响面]: <本仓改动会影响 glbt-apps / 个人层应用等所有引用方>
[已读纪律]: <保持业务无关 / 讨论先行 / cargo check / 多人 worktree 事故教训>
[本次预期产出 + 验收标准]: <用户原话 1-3 行>
[自查红线]: <列 3 条，如：不引入业务概念 / 不擅自合并跨仓库改动 / 改后同步验证引用方构建>
```

用户看到指纹后才能继续；指纹缺失或不完整 = 任务暂停。

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
- **协作纪律总则（2026-09-22 立，覆盖多 AI 并行 / 多工具 / 多机器）**：本条目是「动手前」纪律，全局版在 [`../my-skills/docs/AI协作纪律.md`](../my-skills/docs/AI协作纪律.md)——核心两点：**未提交改动 = 必须 commit 再 pull，禁止静默覆盖**；**多 AI 并行时看到非自己改动 → 停下问用户**。
