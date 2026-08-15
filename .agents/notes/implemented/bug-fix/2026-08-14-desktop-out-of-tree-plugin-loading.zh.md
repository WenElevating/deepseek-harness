# Agent Note：挡住桌面端 out-of-tree 插件的两个缺口

Status: implemented

[English](2026-08-14-desktop-out-of-tree-plugin-loading.md) | 中文

## 问题

按文档流程（[发布教程](../../../../docs/user/develop/basic/publish.md)：`dsh plugin --profile <name> add <package>`，任意包名）安装的插件在 Electron 桌面 shell 里以 `ERR_MODULE_NOT_FOUND` 启动失败，而同一 profile 在纯 Node CLI 下正常。这条路径上叠着两个独立缺陷：

1. **解析。** Electron 内嵌的 Node 无法承载内部 ESM loader，vendored Loader 只能以自身包位置为锚点导入插件说明符——从那里够不到 pnpm 链接进 profile 的任何包。`apps/electron/src/main.ts` 的 `installProfileResolutionRetry` 会把失败的导入改锚到所启动 profile 的目录重试，但只对 `@deepseek-ai/` 开头的说明符生效。仓库内建行全带这个 scope，于是在第一个未 scope 的 out-of-tree 行到来之前，这道门一直隐形。
2. **安装。** `initProfile` 给每个 profile 写入 `pnpm-workspace.yaml`（承载 pnpm ≥10 从该文件读取的 hoisted linker 设置），这使 profile 成为一个单包 pnpm workspace——而 pnpm 在 workspace root 内拒绝不带 `--workspace-root` 的清单变更动词（`ERR_PNPM_ADDING_TO_ROOT`）。因此 `dsh plugin add` 在全新 profile 上直接失败；受影响的用户手写了 profile 清单并自行运行 pnpm 才绕过去。

## 修复

- 重试 hook 现在对**任意裸包名说明符**重新锚定（`isBarePackageSpecifier`：非相对、非绝对、非 `node:`、非 `#imports`）；其余照旧失败。重试只会拯救一个本来就要失败的导入，不可能掩盖应用代码的真实导入错误——它至多解析出一个确实存在于 profile 安装中的名字，而这正是该 hook 要复现的纯 Node 语义。
- `runPlugin` 在 profile 带有 `pnpm-workspace.yaml` 时（且仅当时）为受 root 检查的动词（`add`/`remove`/`update`/`unlink`）注入 `-w`（`withWorkspaceRootFlag`）；没有该文件的 profile 是普通包 root，传这个 flag 反而失败。单测见 `apps/cli/tests/plugin.spec.ts`。
- `window.e2e.ts` 启动前用 `dsh plugin add` 向隔离 home 安装一个真实的未 scope fixture bundle，并从主进程断言 fixture `apply()` 设置的标志——这是两个修复共同的验收路径。

## e2e 为何要处理引导弹窗

全新隔离 home 必然走两步 GUI 引导（内测声明、然后 API Key 对话框；两者都在本套件上次全绿之后合入）。每一步的模态遮罩拦截页面上所有指针事件——这与插件工作无关，但打断了靠点击驱动的测试；`beforeAll` 现在以无 key 的"稍后配置"路径穿过两个对话框。

## 为何是这个形态

重试 hook 的前缀门原本是"安装自有包"的代理条件，而 profile 恰恰是*用户自有*包的所在——正确的边界是说明符的**形态**（裸包名），而不是名字的 **scope**。`-w` 注入以 workspace 文件是否存在为键，而不是恒传该 flag，因为这个 flag 自身的有效性取决于同一个事实。
