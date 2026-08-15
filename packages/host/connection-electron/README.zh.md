# @deepseek-ai/dsh-host-connection-electron

[English](README.md) | 中文

[Connection 宿主服务](../../client/connection/README.md)的 **Electron IPC 载体**：运行于 Electron 主进程内，以 `electron-ipc` 认领宿主侧唯一的载体席位并绑定到 ipcMain。`dsh:fetch` 在进程边界校验渲染端的 invoke 载荷，将请求体限制在 `maxRequestBodyBytes` 以内，在 `http://dsh.internal` 上重建标准 Request，并把 Response 序列化为 `{ status, headers, body }` 返回；其 `/api` 回退以 `privilegedTrusted: true` 组合——该信道无法从网络抵达、只服务应用自己的渲染进程，因此特权方法集（原生对话框与整个配置面）在此放行，而 HTTP 载体会答复 403。`dsh:openStream`/`dsh:closeStream` 按 (sender, channel) 启停各自的泵，把 `events.mux`/`events.host` 帧以 `{ channel, frame }` 推送到 `dsh:server-request`，沿用 WebSocket 下行的 ServerRequest 信封与 stream/error 失败纪律；sender 失联（`once('destroyed')`）、重开在跑的信道、插件卸载各自恰好终结受影响的泵——中止其来源、摘除其失联监听器并释放其席位。载体认领按 profile 生效并保持整棵树的生命期：同载体重复 apply 被容忍，不同载体（`http-webserver`）在 apply 时抛出，卸载不释放认领——组合从不中途切换载体。仅由 electron profile 组合；线路的另一端是 `dsh-client-connection` 中预注入的 `window.__DSH_IPC__` 与 `IpcApiClient`。

## 模型体验

无。IPC 载体只在渲染进程与宿主之间搬运已组装的消息；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

- **invoke 无取消腿**——`dsh:fetch` 无法中止在途的处理器；渲染端的 `IpcApiClient.doFetch` 转而与调用方信号竞速，并丢弃 invoke 迟到的应答，与 web 载体丢弃被放弃连接的应答一致。
- **请求体上限按字符串长度而非字节计数**——`maxRequestBodyBytes` 比较的是 `body.length`（UTF-16 码元），非 ASCII 请求体的驻留字节占用最高可达上限的三倍左右；HTTP 载体按字节计的桥接没有这一宽松度。
