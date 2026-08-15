# `@deepseek-ai/dsh-electron`

[English](README.md) | 中文

dsh 桌面外壳：运行在 `electron` profile 之上的 Electron 主进程/preload 对。主进程用 `runProfile`（CLI 使用的同一启动入口，经 `@deepseek-ai/dsh/profile-boot` 导出）引导 profile，把特权 `dsh://` 协议注册到构建好的 web 前端 dist 之上，并打开一个沙箱窗口。所有面向模型或会话的流量都经由引导树内部的 [`dsh-host-connection-electron`](../../packages/host/connection-electron/README.md) IPC 载体——协议处理器只服务页面、插件 client bundle 和会话导出下载。

## 运行

```sh
pnpm run build:lib && pnpm run build:web   # workspace packages + web dist (once, and after changes)
pnpm run dsh:electron                      # builds the app, then `electron .`
```

窗口加载 `dsh://app/`；`Ctrl+Shift+I` / `F12` 打开 DevTools。离开 `dsh://app` 表面的导航会被拒绝，新窗口一律拒绝。

## `--dsh-smoke`

`electron . --dsh-smoke` 用机器可校验的断言替代交互式生命周期：渲染进程必须看到注入的 `window.__DSH_BOOT__` 图和 preload 的 `window.__DSH_IPC__` 桥，一个请求必须穿过 `dsh:fetch` IPC 通道，引导的 profile 必须未挂载 `webServer` 服务。进程为每个断言输出一行 `PASS`/`FAIL`，仅在全部通过时以 0 退出；对话框被抑制，自动化不会卡在模态框上。

两个无 key 测试套件与之互补：`apps/electron/tests/electron-profile.snapshot.ts`（`pnpm run test:snapshot`）在纯 Node 中以 stub 的 `electron` 无头启动 profile 并固定一轮 transcript；`apps/electron/tests/window.e2e.ts`（web dist 构建后随 `pnpm run test:web`）经 Playwright 驱动真实窗口——解析后的 `webPreferences`、挂载的 `#root`、`window.__DSH_BOOT__`、被拒绝的外部导航；无显示环境自动跳过。

## 布局

| 路径 | 职责 |
|---|---|
| `src/main.ts` | 应用生命周期：profile 引导、`dsh://` 注册、窗口偏好、导航锁、一次性树销毁。 |
| `src/protocol.ts` | `dsh://` 请求处理器：注入引导图的 dist 文件、`/plugins/<id>/client.js[.map]` bundle、`/api/session.export` 透传。 |
| `src/preload.ts` | 渲染进程桥——与 `dsh-client-connection` 读取的 `window.__DSH_IPC__` 形状逐字一致。 |
| `build-preload.mjs` | 把 preload 用 esbuild 打成单个经典 CJS 文件（`preload/index.cjs`）。 |

## 窗口姿态

窗口以 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false` 运行；页面唯一的特权表面是四成员 IPC 桥。preload 是唯一的线上端点，`dsh://` 在 app ready 之前注册为特权 scheme（`standard`、`secure`、`supportFetchAPI`、`stream`）。
