# Agent Note：不依赖打包框架的可分享桌面构建

Status: implemented

[English](2026-08-16-shareable-desktop-package.md) | 中文

## 问题

桌面 shell 此前只能从源码检出运行（`pnpm run dsh:electron`）；没有仓库的人无从分享。可分享的构建必须携带完整插件闭包与 web dist（shell 从接收者自己的 `$DSH_HOME` 启动 `electron` profile，并像源码检出一样从随包安装 heal 出 `profiles/node_modules`）、zip 解压后即可运行，并且 exe 上保留鲸鱼图标。

## 决策

`scripts/package-desktop.mjs`（`pnpm run package:desktop`，仅 win32 宿主）不依赖 electron-builder/electron-forge，在 `apps/electron/release` 下产出一个便携目录加 zip：`node_modules/electron/dist` 的预构建 Electron 运行时，exe 改名为 `DeepSeek Harness.exe`（图标与版本元数据经 rcedit 打上，这是唯一新增的 devDependency），应用本体放在经典的 `resources/app` 位置。

`resources/app` 来自 `pnpm deploy --prod --legacy --config.node-linker=hoisted`。hoisted linker 产出扁平真实文件、没有 `.pnpm` 符号链接库，zip 在任何机器上解压即得可运行副本；这也正是 profile 已在使用的单 cordis 实例布局。web dist 无需打包特判：`@deepseek-ai/dsh-web-frontend` 是 app 的生产依赖且 `files` 包含 `dist`，所以 `DIST_ROOT` 的 `require.resolve` 在部署闭包内原样工作。

## 修复遍历

第一次打包启动以 `ERR_MODULE_NOT_FOUND: @deepseek-ai/cordis-plugin-group` 失败——`dsh-app-boot`（以及闭包中另外 27 个包）把构建产物 `lib/` 在运行时导入的包归类在 **devDependencies**。这在 workspace 里不可见（每个包的开发依赖总是全量安装），在 `--prod` deploy 下致命。`repairClosure` 遍历每个已部署清单的 `dependencies`/`devDependencies`/`peerDependencies`，把缺失的 `@deepseek-ai/*` 名字从 workspace 补拷进来（通过扫描 `packages/`、`vendor/`、`apps/`、`native/` 的清单定位——vendored 的 cosmokit 这类 peer 从任何单一锚点都解析不到），迭代到不动点；遇到不是 workspace 包的名字会大声失败。

## 备选方案

**electron-builder 或 electron-forge。** 否决：两者都要与 pnpm workspace 链接的 `node_modules` 缠斗，而 profile 体系已经拥有自己的部署形态（`resources/app` + heal 出的闭包），框架只会增加重量与故障面。

**去掉 `--prod` 代替修复遍历。** 否决：无论目标端是否带 prod 标志，依赖自身的 devDependencies 都不会进入 deploy，缺失的包一个不少。

**把 28 个包的运行时导入重新归类为真实依赖。** 这是上游的正解，但有意不并入本次改动：它要一次动 28 个清单及其使用方的预期；修复遍历让打包自包含，并在底层分类发生变化时大声失败。

## 测试

对成品 exe（隔离 `$DSH_HOME`）跑 `--dsh-smoke`：五项检查全部 PASS、exit 0——包括 IPC 载体往返和打包布局内渲染器的 boot graph。

## 暂缓事项

- macOS/Linux 打包（exe 改名与 rcedit 步骤都是 Windows 形态）。
- 安装器与代码签名；未签名 exe 首次运行接收者会看到 SmartScreen 警告。
- 裁掉非宿主平台的 `node-pty` 预编译（约 60 MB）。

## 后果

构建现在以一个 207 MB 的 zip 分享，解压即用；代价是一个打包侧的修复遍历暂代逐包的依赖分类债务：新出现的"运行时导入归类为 devDependency"会被不动点遍历静默收进闭包，而不是在包测试里失败，所以这笔债还清之前该遍历必须保留。win32-x64 是唯一交付平台；其他平台的决策一并暂缓。
