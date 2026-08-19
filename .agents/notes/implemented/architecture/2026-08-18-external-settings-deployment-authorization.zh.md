# Agent Note: 外部 settings namespace 的部署授权

Status: implemented

[English](2026-08-18-external-settings-deployment-authorization.md) | 中文

## 问题

一个拥有浏览器 settings 的外部插件此前必须改动 API gateway 的产品 allowlist。只有插件声明会让已组装代码扩大部署的浏览器配置访问权；只有部署列表则可能暴露一个属主从未审阅其 client 用途的插件。现有值脱敏器也无法证明一个藏在任意 schemastery 结构后的 secret 在 descriptor 跨越协议前已经被移除。

## 决策

`SettingsRegisterOptions.exposeToClients` 是属主 opt-in，默认 `false`；`ctx.settings.isExposedToClients(ns)` 只在属主注册仍然存活时返回它。`ApiProxyService.Config.exposedSettingsNamespaces` 是部署列表，默认 `[]`，校验小写 kebab-case namespace，去重时不要求插件已在启动期挂载。

外部 namespace 只有在已注册、属主 opt-in、部署已列出，且 `ctx.settings.describeForWire()` 返回 descriptor 时才能到达浏览器。现有产品 namespace 规则与 LLM 可配置提供方目录独立于此额外列表。每一种被拒绝的外部读写都回答 `settings-not-exposed`，包括未注册名称，因此 API gateway 不会提供注册表探测。

`describeForWire()` 是浏览器 descriptor 路径。它脱敏全部值层，从 secret schema 节点移除默认值，并在 schema 无法证明每个 secret 都有受支持的结构化脱敏路径时省略 namespace。对于 lazy schema，它不会执行 builder，而是直接拒绝，因为证明安全时无法从可检查图取得其目标。`redactSecrets()` 仍是通用值辅助函数，不足以授权浏览器响应。网关在每次外部写入前获取安全 descriptor，并在返回结果前再次获取，因此不安全 schema 既不能读取，也不接受浏览器写入。

协议 schema envelope 还必须可被 JSON 序列化；环引用和其他 fetch 载体无法编码的值都会 fail-closed 地被省略。

## 曾考虑的替代方案

- **只有插件 opt-in**——被部署加载的插件可以在没有明确部署决定时自行变得可在浏览器中配置。
- **只有部署列表**——部署可以暴露一个作者未批准 client 访问、也未为其设计 settings 的插件。
- **在 gateway 配置校验时要求列出的插件已加载**——profile 层可以命名稍后才挂载的插件，因此在加载期解析会拒绝有效组装。
- **把 `redactSecrets()` 用作协议响应实现**——其结构化 walker 刻意不覆盖全部 schemastery 节点类型，无法证明任意 secret 已被移除。

## 影响

外部插件不再需要修改 API gateway 源码：其 Host 半侧声明 `exposeToClients: true`，profile 列出 namespace，其 Client 半侧绑定 `ctx.settingsScope` 并贡献自己的 `settings.plugin.item` 卡片。部署可以移除 profile 条目来撤销浏览器访问而不卸载插件；插件卸载则无需改动部署文件便会撤销其声明。

外部浏览器 settings 必须使用其 secret 字段可被 `describeForWire()` 结构化安全处理的 schema，或暴露 credential 引用。Web profile 与 Electron IPC 都消费 `ctx.apiProxy`，因此复用同一 API gateway 行为。

## 验证

Settings 测试覆盖 opt-in 默认值、注册生命周期、脱敏 descriptor、secret schema 默认值与不受支持的 secret 结构。API gateway 测试覆盖格式错误和重复的部署条目、两类授权失败、外部 update/replace/mutate 的 revision 行为，以及已授权 union-secret namespace 的拒绝。
