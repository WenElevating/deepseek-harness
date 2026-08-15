# Agent Note：electron profile 快照与窗口 e2e

Status: implemented

[English](2026-08-14-electron-profile-snapshot-and-window-e2e.md) | 中文

## 问题

桌面通道在收尾 PR3 的组装时留下两处覆盖缺口：`electron` profile 没有固定其无头组合（无 `webServer`、IPC 承载连接、一轮 transcript）的无 key 快照；shell 窗口也没有测试证明只有真实渲染进程才能展示的事实——解析后的 webPreferences、挂载完成的 `#root` 文档、以及被拒绝的外部导航。此外最初的 Playwright 收尾在 Windows 上会把整套测试挂起最长四分钟。

## 决策

无头快照（`apps/electron/tests/electron-profile.snapshot.ts` 与 `fixtures/electron-profile/` fixture）在纯 Node 子进程里通过 `runProfile` 启动真实的 `electron` profile，并经 `module.registerHooks` 把 `electron` 内建替换为 fixture 模块：stub 只暴露树上两个桌面行导入的面（`ipcMain`、`dialog`、`BrowserWindow`），其余任何 `electron` 导入都会在链接步骤大声失败。fixture 断言 boots 在无 `webServer` 服务下 settle、`ctx.connection.assertCarried()` 成立、三个 `dsh:*` IPC 通道已注册、一次 `/api/host.describe` 请求在 stub 的 carrier handler 上完整往返，并输出一行 JSON 供快照按 `apps/web` 同类方式 tokenize（仅 `cwd`）。

窗口 e2e（`apps/electron/tests/window.e2e.ts`，vitest web lane）通过 Playwright `_electron` 在临时 `$DSH_HOME` 下启动构建后的应用，固定 `getLastWebPreferences()` 的 `contextIsolation`/`sandbox`/`nodeIntegration: false`、`dsh://app/` URL、非空 `#root`、`window.__DSH_BOOT__`，以及被拒绝的 `window.open('https://example.com')` 使 `document.location.origin` 停留在 `dsh://app`。URL 采用整体比较：Node 的 WHATWG 解析器给自定义 scheme 不透明 origin（`"null"`），而 Chromium 对已注册 standard scheme 的 `document.location.origin` 读作 `dsh://app` —— 两种 origin 语义不一致，各自在各自一侧断言。

收尾先关页面再关应用。先退应用会让渲染进程在整棵树 dispose 期间存活，随后它会对已 dispose 的 `dsh://` handler（在 dispose 后解引用 `ctx.clientModules` 并抛 `TypeError`）循环重试 `/plugins/*/client.js` 拉取，这场重试风暴在 Windows 上把 Electron 进程退出拖长数秒到数分钟不等。先关窗口即用户退出路径（`window-all-closed` → quit → 无存活渲染进程下 dispose），数秒完成。已提交的 `--dsh-smoke` 标志仍是本地自动化门（boot graph、bridge、carrier、退出码）；无头 profile 快照才是 CI 信号，e2e 只补充真实窗口才能证明的事实，并在无显示环境或 `DSH_ELECTRON_E2E=0` 时自跳过。

## 后果

e2e 在自己的 `beforeAll` 里构建桌面 shell（web lane 构建 lib 与 web dist 但不构建 `apps/electron`），因此直接跑 `test:web:built` 的有显示机器也能通过；web dist 缺失则大声失败。Vitest 4 的逐 hook 超时参数优先于配置 `hookTimeout`（探针验证），因此 `beforeAll` 声明的 180 s 对冷 `tsc -b` 仍然有效，web lane 的 120 s 配置默认覆盖其余场景。快照 fixture 在 `vitest.snapshot.config.ts` 的登记是无条件的，与 `apps/cli` 套件一致，因此 `src`（tsx）与 `lib`（纯 Node 类型剥离）两种模式都会跑。

一个产品瑕疵由此显形并留作后续：`dsh://` protocol handler 在树 dispose 后仍解引用 `ctx.clientModules`，迟到的渲染请求以未处理 `TypeError` 显形而不是应答 503；用户可见的退出路径不会踩到（用户先关窗口），但持有打开窗口调用 `app.quit()` 的自动化客户端会看到这些噪声。

## 备选方案

**按计划草案把 e2e 挂到 Playwright 自带测试运行器。** 仓库的浏览器 e2e 全部在 vitest 下以 `fileParallelism: false` 运行；为单个文件引入第二运行器会新增配置、lockfile 面与 CI lane。

**用 `page.url()` 轮询或 `did-finish-load` 等导航锁定。** `waitForURL('dsh://app/')` 是内建等价物，无需自定义谓词；基于 origin 的谓词永远匹配不上，因为 Node 侧 `URL.origin` 对 `dsh://` 不透明。

**调高 `vitest.web.config.ts` 的 `hookTimeout`。** 观察到的 `Hook timed out in 120000ms` 来自未声明超时的 `afterAll` 等待收尾重试风暴，而非逐 hook 参数失效；修正收尾顺序后等待消失。

## 验证

`pnpm exec vitest run --config vitest.snapshot.config.ts apps/electron/tests/electron-profile.snapshot.ts` 两次通过且内联快照输出一致（确定性）；`pnpm exec vitest run --config vitest.web.config.ts apps/electron/tests/window.e2e.ts` 在本台有显示的 Windows 主机上反复以个位数秒通过；完整 `pnpm run test:snapshot` 套件保持既有 Windows 失败不变且新快照为绿；`pnpm run typecheck` 与 `apps/electron` 的 oxlint 干净。
