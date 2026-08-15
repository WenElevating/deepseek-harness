# `@deepseek-ai/dsh-electron-app`

[English](README.md) | 中文

dsh 桌面 surface 组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-web-app`](../web-app/README.md) 之上，作为 `electron` profile 模板的第三层：它禁用 HTTP 载体家族（[`dsh-host-webserver`](../../host/webserver/README.md) 与重载链 [`dsh-client-hmr`](../../client/hmr/README.md)——没有 HTTP surface 可服务时它们只是死重）和自适应的 [`directory-picker`](../../host/directory-picker-auto/README.md) 条目，插入 Electron 替代品——[`dsh-host-directory-picker-electron`](../../host/directory-picker-electron/README.md)（harness 运行在 Electron 主进程内，OS 对话框无需跨进程跳转）与 [`dsh-host-connection-electron`](../../host/connection-electron/README.md)（IPC 载体，认领载体中立的 `connection` 宿主半边并绑定到 `ipcMain`/`webContents`）——并保留全部 `dsh.client` 浏览器条目，因为桌面 shell 通过 Electron 的 renderer 加载同一前端。本包没有运行时 API；profile 组合器通过 `dsh.bundle.patch` 清单字段解析 patch，从不经过代码。

`web-runtime` 条目保持挂载，配置为 `printUrl: false, surfaceContext: false`：web-app 的 `connection` 条目注入其 `webRuntime` 服务，而 Loader patch 无法改写条目的 `inject`，禁用该条目会让浏览器 roster 的信任围栏悬空。`printUrl` 为 false 时不打印 URL 行——桌面 shell 没有规范 URL；`surfaceContext` 为 false 时不注册 web-surface 提示词小节，也不注册 `DSH_WEB_URL` bash 变量；未挂载 webServer 条目时它仍以空信任快照提供 `webRuntime`，因此 renderer 的 `dsh:fetch` 桥完全不需要 HTTP 信任。

## 模型体验

间接影响，经由组合的条目：本组合包禁用 web 层注册的模型可见 surface，自身不挂载任何模型可见文本。

#### KV Cache 影响

无直接影响；每个组合条目的包各自负责其影响。

## 已知限制与暂缓事项

- **patch 替换整个条目 config**：`web-runtime` 覆盖在改动两个开关的同时丢弃了 `trustedHosts`，之所以安全，仅因为 schema 默认值加上无服务器时的空信任快照使该值在此无关紧要；将来重新启用 HTTP 家族时必须完整重述 config。
- **尚未发布桌面启动器**：`electron` profile 可以初始化和组合，但挂载它的 Electron 主进程入口随桌面 shell 交付；在那之前该 profile 的启动效果等同 `web` 减去 HTTP 家族。
