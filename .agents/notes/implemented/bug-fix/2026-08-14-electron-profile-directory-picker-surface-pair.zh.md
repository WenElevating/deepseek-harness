# Agent Note：electron profile 必须完整重述目录选择交互的两个半边

Status: implemented

[English](2026-08-14-electron-profile-directory-picker-surface-pair.md) | 中文

## 问题

收起后的桌面端侧边栏在搜索图标上方留出一格 36px 空白，展开的侧边栏则没有添加工作区动作。两个症状都来自 `sidebar.workspaces.directoryFlow` 与 `conversation.hero.workspace.directoryFlow` 这两个 hole 无人占用：`WorkspaceBrowser` 和 `WorkspacePicker` 撤掉添加入口，而 rail 中常驻的 section-header 行仍保留其几何空间（`directoryFlowAvailable === false`）。

自适应的 `directory-picker` 宿主行会把目录交互的后端与客户端 surface 作为一对挂载。Electron profile 需要 Electron 宿主对话框后端，因此其组合包 patch 禁用这条自适应行，并且必须显式重述两个半边。

## 决策

`packages/bundle/electron-app/cordis.patch.yml` 禁用自适应的 `directory-picker` 行，并同时插入 `directory-picker-electron` 与 `ui-directory-picker-native`。组合包把 native surface 声明为依赖。该 surface 与载体无关，会通过 Electron profile 挂载的 IPC 载体调用 `workspaces.pickDirectory()`。

组合测试断言自适应行已禁用，Electron 宿主与 native surface 行存在且启用，同时 IPC connection 行保持活动。

## 考虑过的替代方案

**保留自适应的 `directory-picker` 行。** 拒绝，因为 Electron profile 必须用 native Electron 对话框实现替换通用宿主后端。

**只插入 `directory-picker-electron`。** 拒绝，因为自适应行同时拥有客户端 surface 与后端；遗漏 surface 会让两个 directory-flow hole 都无人占用。

**创建桌面专用客户端 surface。** 拒绝，因为 `ui-directory-picker-native` 与载体无关，已经能通过 IPC 驱动共享的 `workspaces.pickDirectory()` capability。

## 后果

Electron profile 以完整的一对提供目录选择后端与客户端 surface，因此没有 web server 时，收起侧栏与展开侧栏仍保留添加工作区入口。组合包显式携带 surface 依赖；任一半边被移除或禁用时，组合测试都会失败。
