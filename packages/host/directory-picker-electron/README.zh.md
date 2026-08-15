# @deepseek-ai/dsh-host-directory-picker-electron

[English](README.md) | 中文

[目录选择 seam](../directory-picker/README.md) 的 **Electron 后端**：`ElectronDirectoryPicker` 在 Electron 主进程内以 `native` 能力注册 `ctx.directoryPicker`，因此 `pick(signal)` 直接调用 `dialog.showOpenDialog`——对话框附着于获得焦点的 `BrowserWindow`，无焦点时回退到第一个已打开窗口，无窗口时以无宿主窗口方式打开——不存在跨进程跳转。每次 pick 解析出所选绝对路径（取消或无路径关闭时为 `null`）。harness 运行于主进程，`electron` peer 依赖由该宿主进程满足。桌面 shell 在 electron profile 中以一行组合此后端，取代 [`-native`](../directory-picker-native/README.md)：两者都注册 `native` 能力，因此至多加载一个后端行——第二个会在加载期抛出，即 cordis 标准的重复服务行为。

## 模型体验

无。该后端服务于桌面 shell 的目录选择；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

- **中止无法关闭对话框**——Electron 没有解除模态 `showOpenDialog` 的 API，因此对话框打开期间到达的中止信号会丢弃迟到的应答（pick 解析为 `null`）而非关闭对话框；可中止的选择器需要渲染进程侧的自定义对话框。
