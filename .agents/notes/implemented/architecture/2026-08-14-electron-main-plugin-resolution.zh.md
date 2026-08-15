# Agent Note: Electron 主进程的插件解析与 HMR 降级

Status: implemented

[English](2026-08-14-electron-main-plugin-resolution.md) | 中文

## 问题

桌面外壳（`apps/electron`）通过 CLI 使用的同一 `runProfile` 启动器引导 `electron` profile，该入口以 `@deepseek-ai/dsh/profile-boot` 导出。在 Electron 内嵌的 Node 之下，这条路径的两个纯 Node 假设失效：vendored Loader 无法触达 Node 的内部 ESM loader，而 vendored HMR 服务在没有它的情况下拒绝构造。

## 决策

Electron 39 主进程对 `node-addon-require-builtin` 隐藏了内部 ESM loader（其 realm 探测找不到兼容的 `GetAlignedPointerFromEmbedderData` 符号），因此 `ModuleLoader.fromInternal()` 返回 `undefined`，`EntryTree.import` 退回到从 vendored loader 自身的包导入插件说明符——那里解析不到任何工作区依赖。桌面主进程在引导前安装一个进程级 `module.registerHooks` 解析钩子：每个失败的 `@deepseek-ai/` 导入以引导的 profile 目录为父 URL 重试，其向上遍历同时到达 profile 自身的 `node_modules` 和启动器维护的 `$DSH_HOME/profiles/node_modules` 平铺回退。这与内部 loader 路径在纯 Node 下提供的解析相同；钩子位于 `apps/electron/src/main.ts`，不触及任何 vendored 或共享包。

`runProfile` 为 `cordis.patch.yml` 实时编辑挂载的 watch-only HMR 实例在此环境无法存在：vendored HMR 构造器在没有内部 loader 时抛出。`runProfile` 现在仅在 `ctx.loader.internal` 有定义时挂载 timer + watch-only HMR 对，否则通过树 logger 告警并跳过两个 `watchUserPatches` 注册（它们要求 HMR 服务）。桌面外壳在自己的控制台重复该告警，因为没有桌面行导出树 logger。桌面的 `cordis.patch.yml` 编辑在重启后生效；纯 Node 表面的实时重载保持不变。

## 影响

桌面主进程的插件解析依赖启动器维护的平铺回退持续作为 in-box 插件的解析面；未来移除或迁移 `$DSH_HOME/profiles/node_modules` 的改动必须同步更新钩子的锚点。重试只作用于失败的 `@deepseek-ai/` 说明符，应用自身的依赖树在每次导入中仍优先解析。实时 patch-layer 重载在桌面外壳不可用：profile 的 `cordis.patch.yml` 与 `$DSH_HOME/cordis.patch.yml` 编辑在该表面需要重启应用，而每个纯 Node 表面保留热重载。`--dsh-smoke` 标志作为机器可校验的引导门禁提交，供自动化与后续 e2e 使用。

## 备选方案

**给 vendored Loader 打 `import.meta.resolve` 回退补丁。** 对 Electron 正确，但改变了每个运行时的解析行为；在应用侧钩子已足够时，vendored 修改的同步流程负担不合理。

**用解析加导入的垫片伪造 `internal` 字段。** HMR 服务还使用内部 API 做模块失效；一个不完整的伪造会构造出在 Electron 下未测试生命周期的服务。

**向 Electron 主进程传入 `--expose-internals`。** 该标志只在嵌入器数据槽与纯 Node 匹配的构建中暴露 `require('internal/…')`；无论是否带标志，addon 探测在 Electron 下都已失败。

## 验证

`electron . --dsh-smoke` 引导真实 profile 并断言渲染进程看到了 `window.__DSH_BOOT__` 与四成员 `window.__DSH_IPC__` 桥、一个请求穿过了 `dsh:fetch` IPC 通道、且未挂载任何 `webServer` 服务；任一失败即非零退出。`apps/electron/tests/protocol.spec.ts` 钉住 `dsh://` 处理器（引导图注入顺序、MIME 映射、编码遍历拒绝、bundle 与导出路由）。
