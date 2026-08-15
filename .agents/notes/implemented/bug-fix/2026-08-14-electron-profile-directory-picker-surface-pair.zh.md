# Agent Note：electron profile 必须完整重述目录选择交互的两个半边

Status: implemented

[English](2026-08-14-electron-profile-directory-picker-surface-pair.md) | 中文

## 问题

收起后的桌面端侧边栏在搜索图标上方留出一格 36px 空白，展开的侧边栏则完全没有"添加工作区"动作。两个症状同源：`sidebar.workspaces.directoryFlow` 与 `conversation.hero.workspace.directoryFlow` 两个 hole 无人占用，`WorkspaceBrowser`/`WorkspacePicker` 因此撤掉添加入口，而 rail 中常驻的 section header 行仍保留几何空间（`directoryFlowAvailable === false`）。

占用 hole 的是一个客户端 surface 插件（`dsh-client-ui-directory-picker-native` / `-browse`），而在已发布的 web profile 里这个 surface 是间接到位的：自适应的 `directory-picker` 宿主行（[dsh-host-directory-picker-auto](../../../../packages/host/directory-picker-auto/README.md)）在启动时解析交互，把**后端与 surface 作为一对** loader 条目挂载。`dsh-electron-app` 组合包的 patch 禁用了这条自适应行，却只重新插回了 Electron 的**宿主**后端（`dsh-host-directory-picker-electron`）。禁用自适应行时客户端 surface 被连带丢弃，patch 里没有任何文字说明这条行拥有两个半边——组合包 README 甚至写着桌面 surface "keeps every `dsh.client` browser row mounted"，这对 web-app 层的 roster 是事实，对 chooser 运行时挂载的 surface 毫无意义。

## 修复

`packages/bundle/electron-app/cordis.patch.yml` 现在在 Electron 宿主后端旁边插入 `ui-directory-picker-native`（并在 bundle 依赖中声明），把被禁用的自适应行原本成对挂载的交互补齐。surface 是载体中立的——它通过组合中实际挂载的载体（这里是 IPC 载体）调用 `workspaces.pickDirectory()`——因此不需要任何桌面专属客户端代码。composition spec 现在断言 surface 行存在且启用，再次丢掉配对的一半会直接挂测试。

## 为何是这个形态

任何禁用 auto-chooser 行的 bundle 都继承"完整重述该行**动态挂载的所有内容**"的义务，而不只是行里点名的那一个插件。一条行的运行时挂载面（它创建的 loader 条目）对 patch 作者"这条行给我什么"的心智模型不可见——这正是 README 里那句关于 `dsh.client` 行的话没能拦住它的原因：surface 从来就不是 roster 行。
