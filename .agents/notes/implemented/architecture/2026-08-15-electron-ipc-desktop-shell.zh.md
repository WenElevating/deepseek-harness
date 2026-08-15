# Agent Note: Electron 桌面外壳 —— 载体中立的连接、dsh:// 协议与受信 IPC 载体

Status: implemented

[English](2026-08-15-electron-ipc-desktop-shell.md) | 中文

> 分工：本笔记拥有桌面外壳的载体架构——载体中立的 Connection 宿主半边、渲染进程 IPC 接缝、`dsh://` 协议与桌面组合。[Electron 主进程插件解析与 HMR 降级](2026-08-14-electron-main-plugin-resolution.md)拥有 Electron loader 缺口与实时 patch 重载缺失；[profile 快照与窗口 e2e 笔记](../testing/2026-08-14-electron-profile-snapshot-and-window-e2e.md)拥有测试覆盖与协议处理器在 dispose 后的瑕疵；[GUI 分层笔记](2026-07-19-gui-layering-and-rpc-protocol.md)拥有分层模型与两个载体共同承载的 RPC 协议。

## 问题

`dsh` 需要一个复用 web client 树且不监听端口的桌面外壳。web 组合中有三处以活跃 webServer 为前提：`dsh-web-app` 的运行时粘合（LAN 信任快照、URL 行、web 表层提示段）、Connection 宿主半边（其 `/api` 路由与两个 WebSocket upgrade 直接注册在 `ctx.webServer` 上）、以及渲染进程（从 web 服务器的 origin 加载）。原样复用该组合会让单用户桌面应用持有一个监听端口——可从局域网到达的 `/api`、端口冲突、以及没有面向用户 URL 的 URL 行——而复制一份 client 树会让每个对象层修复出现分叉。

## 决策

### 载体中立的 Connection 宿主半边

`dsh-client-connection` 的宿主半边在不要求任何服务的情况下提供 `ctx.connection`：`HostConnectionService`（`packages/client/connection/src/rpc-host.ts`）持有 `/api` 拦截器注册表与一个物理载体席位。`createSharedFetchHandler('/api', fallback)` 组合拦截器或回退的派发，每个请求恰好选择一个目标；`claimCarrier(carrier)` 记录席位；`assertCarried()` 在席位为空时抛出。`/api` 回退载体中立（`createApiFallbackHandler(ctx, { privilegedTrusted })`，`packages/client/connection/src/api-fallback.ts`）：特权方法闸门、事件路径 426 应答，然后派发到 API Proxy。两个载体经包根的再导出共享 wire 常量；`./api-path` 子路径额外为外部消费者发布它们。

每个组合恰好一个物理载体认领。HTTP 载体（`http-webserver`）在其 `ctx.inject(['webServer'])` 纤维内认领，该纤维在服务器 listen 落定时触发，因此认领与路由注册不会与绑定中的纤维竞态；webServer 重启会重跑纤维并以同一身份重复认领，席位接受这一重复。Electron 载体（`electron-ipc`）在 apply 时认领。席位被占时由另一个载体认领即抛出。vendored cordis 未定义就绪事件，因此 Loader 落定即就绪信号：树落定后，无人认领的宿主半边以未处理拒绝的形式在 `assertCarried()` 处失败，app-boot 守卫将其转为致命退出；该检查在引导途中被销毁的树上（早到的 SIGTERM）与引导失败时保持安静——后者由 Loader 报告（`packages/client/connection/src/index.ts`）。

通用 `rpc.handle` 通道保持 HTTP 专属：注册读取 `ctx.webServer`，缺席即抛出。生产代码只使用 `intercept('/api')`，其拦截器经任一载体的共享处理器派发——Electron profile 的 remote 端点经 IPC 载体承载，无需额外注册。

### 无服务器的 web 组合

没有 webServer 行时，`dsh-web-app` 以空信任快照提供 `webRuntime` 服务，且不挂载任何 HTTP 绑定粘合——没有 frontend-static 回退占有者、没有 web 表层提示段、没有 URL 行——因此 `connection` 行的 `inject: [webRuntime]` 仍然可解析。一个仅在 Loader 落定后才可见的 webServer 意味着本行已在活跃服务器旁提交了无服务器路径；这种行序错组合抛出（`packages/bundle/web-app/src/index.ts`）。`dsh-client-modules` 仅在 webServer 之下绑定其 HTTP bundle 路由与 index tap；无服务器宿主直接经 `ctx.clientModules.graph()` 读取引导图。

### 渲染进程载体接缝

preload（`apps/electron/src/preload.ts`）注入的 `window.__DSH_IPC__` 恰有四个成员：`fetch`（每个 HTTP 风格请求一次 `dsh:fetch` invoke）、`openStream`/`closeStream`（`dsh:openStream`/`dsh:closeStream`）、`onServerRequest`（`dsh:server-request` 推送）。`readIpcBridge()`（`packages/client/connection/src/client/ipc-bridge.ts`）返回桥、在桌面外壳之外返回 undefined，并在该全局存在但畸形时抛出——半注入的桥会大声失败，而不是回退到 HTTP 去撞一个不存在的 origin。client 插件按 fixture（`?fixture`）→ IPC（桥存在）→ HTTP（`WebApiClient`）选择；`packages/client/connection/src/client/index.ts` 拥有该顺序。

`IpcApiClient`（`packages/client/connection/src/client/ipc-api-client.ts`）继承 `AbstractApiClient`，只替换基类保留的传输切面：`doFetch`（fetch 形态经一次 invoke 桥接）与两个流开启器（推送通道泵）。wire 信封、rpcId 纪律、zod 解析与基类的超时机制不变——即 [GUI 分层笔记](2026-07-19-gui-layering-and-rpc-protocol.md)子类表中的 IPC 行。主进程侧，`IpcStreamPumps`（`packages/host/connection-electron/src/ipc-streams.ts`）为每个（sender, channel）持有一个泵，将每帧包进 WebSocket 下行链路发送的同一 `ServerRequest` 信封，并在 sender 丢失（`once('destroyed')`）、通道重开与插件销毁时恰好中止受影响的来源。

### `dsh://` 特权协议

渲染进程加载 `dsh://app/`，而非 `file://`。`file://` 页面得到不透明 origin，而 vite 构建产出根绝对资产路径（`/assets/...`），在 `file://` 下会解析到文件系统根，因此需要一份迁移过的构建；fetch 与流式响应在那里也受限。`dsh` scheme 在 app ready 之前注册为特权（`standard`、`secure`、`supportFetchAPI`、`stream`）（`apps/electron/src/main.ts`）。处理器（`apps/electron/src/protocol.ts`）服务构建好的 `apps/web` dist，复用 `dsh-client-modules` 的 `injectBootManifest`——与 HTTP 载体 `tapIndex` 路径应用的同一函数——因此渲染进程脚本发现机制不变，外壳的 `BootSeams` 自定义 bundle 加载参数保持未用。`/plugins/<id>/client.js[.map]` 以与 `ClientModuleRegistry.serveBundle` 相同的映射从 `ctx.clientModules` 服务。`/api/session.export` 是协议处理器服务的唯一 `/api` 路由：导出下载把渲染进程导航到 `dsh://` URL，因此处理器把这一个请求经 `toFetchHandler(apiProxy)` 转发以产出附件响应；其余所有 `/api` 请求经 IPC 载体承载。

### 载体信任与 `isLoopback`

特权方法闸门保留在载体中立的回退中。HTTP 载体传入 `privilegedTrusted: false` 并依赖 loopback/`trustedHosts` 围栏；IPC 载体传入 `privilegedTrusted: true`——一个显式的载体信任属性，而不是被移除的检查。IPC 通道从网络不可达，只服务应用自己的渲染进程；后者以 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false` 运行，导航锁定在 `dsh://app`，新窗口一律拒绝：该通道的信任强度不低于 loopback HTTP origin——正是围栏对浏览器载体所表达的。`maxRequestBodyBytes` 为每个 `dsh:fetch` 请求体设上限。

桥存在时 client 句柄报告 `isLoopback: true`。桌面渲染进程的授权是 `dsh://app`，不是 loopback 主机名；没有这个源自桥的值，`openPath` 与 host 范围的设置项可用性会静默降级。

### 桌面组合

`electron` profile 模板叠放 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-electron-app`（`packages/boot/app-boot/src/profile.ts`）。`dsh-electron-app` 组合包是一个 patch 层（`packages/bundle/electron-app/cordis.patch.yml`）：禁用 `webserver`、`client-hmr`、`directory-picker` 行，插入 `connection-electron` 与 `directory-picker-electron`，并保持 `web-runtime` 挂载且 `printUrl: false`、`surfaceContext: false`——该行保留是因为 `connection` 行注入 `webRuntime`，而 patch 无法改写另一行的 `inject`；没有 webServer 时该行提供空快照。`packages/bundle/electron-app/tests/composition.spec.ts` 经真实 `loadProfile`/`composeEntries` 路径钉住行集。

`apps/electron` 主进程经 `runProfile`（CLI 的启动器入口，`@deepseek-ai/dsh/profile-boot`）引导 profile，注册 `dsh://`，打开一个沙箱窗口，以带因果链的错误框呈现引导失败，并在每条退出路径上恰好一次地销毁树；`--dsh-smoke` 以机器可校验的断言替换对话框与交互生命周期。`ElectronDirectoryPicker`（`packages/host/directory-picker-electron/src/index.ts`）在主进程内注册 `native` 能力——没有跨进程跳转——并替换 `-native` 行；两者都注册 `native` 能力，因此恰好一个后端行可以加载。

### 无边框标题栏

窗口以 `frame: false` 打开：页面本身就是标题栏。preload 暴露第二个四成员桥 `window.__DSH_WINDOW__`（`minimize`、`toggleMaximize`、`close`、`onStateChange`），走 `ipcMain.handle('dsh:window:operate')`——op 字符串跨线传输，在此对照联合类型校验——`dsh:window:state` 推送最大化状态，preload 缓冲并向迟到的订阅者重放（`did-finish-load` 时的首次推送早于 React 挂载）。ui-layout 的 WindowBand 仅在该桥存在时渲染：一条 36px 拖拽带载着配色一致的最小化/最大化/关闭按钮浮在中列与详情列之上（左缘 = `--dsh-frame-sidebar`，与 grid 轨道同帧写入并按同曲线缓动），两列经 `--dsh-caption-height` 预留带高，文档根标记 `data-dsh-window-frame`——同一标记也让侧栏 logo 行成为拖拽区（ui-sidebar），其按钮除外。纯浏览器不渲染其中任何一项，布局逐字节不变。

### 原生模块：不需要 electron-rebuild

仓库的原生模块——`node-pty`（在 `dsh-subprocess-local` 之下）与 `koffi`——是 N-API 模块，其 prebuild 无需重编译即可在 Electron 内嵌 Node 中加载。`@electron/rebuild` 曾为工具链评估后被移除：桌面外壳与纯 Node 运行在同一批 prebuild 上，不存在需要维护的重编译步骤。对 `node-pty` 运行 `@electron/rebuild --force` 会覆盖其预构建二进制并删除 Windows `conpty` 支持文件，破坏终端后端；不要在本仓库运行它。

## 备选方案

**桌面外壳内监听 loopback webServer。** 零代码复用 HTTP 载体，但把单用户桌面应用变成持端口的本地服务器——端口冲突、`0.0.0.0` 误配置即暴露的 `/api`、以及没有面向用户 URL 的 URL 行。载体拆分花费三个包与一个载体接缝；服务器花费的是永久的安全与运维面。

**并行的桌面 client 树。** 第二份 client 树让宿主保持不动，但让每个对象层修复在两个渲染进程间分叉。IPC 载体原样复用 web client 包；只有传输切面不同。

**`file://` 加载。** 不透明 origin、根绝对 vite 资产路径与受限的 fetch／流式响应，使它是构建与 API 的绕行方案而非加载机制；`dsh://` 处理器约 120 行，并保持 dist 与 web 构建逐字节相同。

**原生 IPC RPC 面（不经 fetch 形态）。** 协议不变量——信封解析、rpcId 回显校验、超时——位于 `doFetch` 之上的基类中；每通道一个原生面会重复实现它们并分叉 wire 约定。经 invoke 桥接 fetch 形态让两个载体共享同一约定。

**以服务身份检测载体（IPC 提供者同时提供 `ctx.connection`）。** 同一服务的两个提供者在 cordis 注册表中冲突，且服务在场无法区分 HTTP 载体与 IPC 载体。认领席位记录载体身份，因此同时挂载两个载体的树在第二次认领处以两个名字失败，而不是静默丢失路由。

**IPC 专属的特权方法清单。** 第二道围栏会偏离 `PRIVILEGED_METHODS`。`privilegedTrusted` 一次性陈述载体信任；唯一一道围栏对两个载体保持权威。

## 影响

web profile 未从载体拆分获得任何新行为：其快照输出将该重构钉为行为保持。`host/` 组持有一个导入 `electron` 的包——纯 Node profile 从不加载它，其组合被限定在 `electron` profile 模板内。已知限制：`dsh://` 响应尚未携带 CSP 头（渲染进程会记录警告；该头将来加在 `apps/electron/src/protocol.ts`）；协议处理器对 dist 未命中应答 404，而 `frontend-static` 以 200 应答 SPA 回退，因此仅能经回退解析的客户端路由在 `dsh://` 下不加载。实时 patch-layer 重载在桌面外壳保持不可用（重启应用 `cordis.patch.yml` 编辑；[loader 笔记](2026-08-14-electron-main-plugin-resolution.md)）；处理器在 dispose 后抛出而非应答 503（[测试笔记](../testing/2026-08-14-electron-profile-snapshot-and-window-e2e.md)）；connection-electron README 拥有 wire 级上限（invoke 无取消腿；请求体上限按字符串长度计数）。

## 验证

`packages/client/connection/tests/node-half.host.spec.ts` 钉住认领语义（同载体重复认领被接受、异载体抛出、落定大声失败、引导途中销毁守卫），`ipc-api-client.client.spec.ts` 钉住渲染进程载体（流开启失败遏制、预中止顺序）；`packages/bundle/web-app/tests/web-server-optional.spec.ts` 钉住无服务器路径与迟到 webServer 失败；`packages/bundle/electron-app/tests/composition.spec.ts` 钉住组合后的行集；`packages/client/ui-layout/tests/window-band.client.spec.tsx` 钉住标题栏控制带（桥门控、文档标记生命周期、三个操作、缓冲状态重放）；`apps/electron/tests/protocol.spec.ts` 钉住 `dsh://` 处理器（引导图注入顺序、MIME 映射、编码遍历拒绝、bundle 与导出路由）。`electron . --dsh-smoke` 引导真实 profile 并断言渲染进程的引导图、两座四成员桥、一次 `dsh:fetch` 往返、以及未挂载任何 `webServer` 服务，任一失败即非零退出；无密钥 profile 快照与 Playwright 窗口 e2e（同样驱动标题栏：拖拽区已解析、经桥切换最大化、关闭即退出应用）由[测试笔记](../testing/2026-08-14-electron-profile-snapshot-and-window-e2e.md)拥有。
