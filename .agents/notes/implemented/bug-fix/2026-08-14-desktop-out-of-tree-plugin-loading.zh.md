# Agent Note：挡住桌面端 out-of-tree 插件的两个缺口

Status: implemented

[English](2026-08-14-desktop-out-of-tree-plugin-loading.md) | 中文

## 问题

按文档流程（[发布教程](../../../../docs/user/develop/basic/publish.md)：`dsh plugin --profile <name> add <package>`，任意包名）安装的插件在 Electron 桌面 shell 中以 `ERR_MODULE_NOT_FOUND` 启动失败，而同一 profile 在纯 Node CLI 下正常。这条路径有两个独立缺陷：Electron 内嵌的 Node 把失败的插件导入锚定在自身包位置，而 `initProfile` 让每个 profile 都成为单包 pnpm workspace，其清单变更命令需要 `--workspace-root`。

## 决策

`apps/electron/src/main.ts` 中的 `installProfileResolutionRetry` 会从已启动的 profile 目录重试失败的裸包说明符。相对路径、绝对路径、`node:` 说明符和 `#` import 不会重试，因此该 hook 复现 profile 在纯 Node 下的包解析，不改变其他导入失败的语义。

`runPlugin` 在 profile 存在 `pnpm-workspace.yaml` 且 pnpm 命令属于 `add`、`remove`、`update` 或 `unlink` 时注入 `-w`。`withWorkspaceRootFlag` 会在原始 pnpm 参数中跳过已识别的全局选项及其独立值，支持 `--option=value` 形式，并保持原始参数顺序。没有 workspace 文件的 profile 不会接收 `-w`。

Electron window E2E 会创建隔离 profile，通过 `dsh plugin add` 安装一个未 scope 的 fixture bundle，并从主进程断言 fixture 的 `apply()` 标志。测试初始化会经过内测声明和 API Key 对话框的无 key 配置稍后路径，因为这些模态遮罩会拦截浏览器驱动检查中的指针事件。

## 考虑过的替代方案

**只重试 `@deepseek-ai/` 说明符。** 拒绝，因为 out-of-tree 插件可以使用任意包名；识别解析锚点的依据是安装 profile，而不是包的 scope。

**始终向 pnpm 传入 `-w`。** 拒绝，因为没有 `pnpm-workspace.yaml` 的 profile 是普通包 root，此时 `--workspace-root` 无效。

**假设命令始终是 `args[0]`。** 拒绝，因为 pnpm 允许在命令前放置全局选项。参数扫描器会跳过已知的带值选项，因此 `--filter add` 中的 `add` 不会被误认为命令。

## 后果

安装在 profile 中的未 scope 包可以在 Electron shell 中加载；新建的 workspace profile 即使在命令前带有已识别的 pnpm 全局选项，也能执行清单变更型插件命令。普通包 profile 保持原有调用语义。相对路径说明符仍以用户发起调用的目录为锚点，其他 pnpm 参数保持不变。

CLI 单元测试覆盖命令位于首位、带独立值的全局选项、等号形式选项、非变更命令和没有 workspace 文件的 profile。Electron E2E 覆盖组装后的 profile 路径与未 scope fixture。解析重试仍只处理从 loader 默认锚点已经失败的导入。
