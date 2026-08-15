# @deepseek-ai/dsh-host-connection-electron

English | [中文](README.zh.md)

The **Electron IPC carrier** of the [Connection host service](../../client/connection/README.md): running inside Electron main, it claims the Host half's single carrier seat as `electron-ipc` and binds it to ipcMain. `dsh:fetch` validates the renderer's invoke payload at the process boundary, caps the body at `maxRequestBodyBytes`, rebuilds a standard Request at `http://dsh.internal`, and serializes the Response back to `{ status, headers, body }`; its `/api` fallback is composed with `privilegedTrusted: true` — the channel is unreachable from the network and serves only the app's own renderer, so the privileged method set (native dialogs plus the whole configuration plane) is admitted where the HTTP carrier would answer 403. `dsh:openStream`/`dsh:closeStream` start and stop one pump per (sender, channel) that forwards `events.mux`/`events.host` frames as `{ channel, frame }` pushes on `dsh:server-request`, mirroring the WebSocket downlinks' ServerRequest envelope and stream/error failure discipline; sender loss (`once('destroyed')`), re-opening a live channel, and plugin disposal each end exactly the affected pump — aborting its source, detaching its loss listener, and releasing its seat. The carrier claim is per-profile and holds for the tree's life: re-applying this same carrier is tolerated, a different carrier (`http-webserver`) throws at apply, and disposal releases nothing — a composition never switches carriers mid-life. Composed only by the electron profile; the other endpoint of the wire is the preload-injected `window.__DSH_IPC__` and `IpcApiClient` in `dsh-client-connection`.

## Model Experience

None, as the IPC carrier moves already-composed messages between renderer and host; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No invoke cancellation leg** — `dsh:fetch` cannot abort an in-flight handler; the renderer's `IpcApiClient.doFetch` races the caller's signal instead and drops the invoke's late answer, as the web carrier drops an abandoned connection's.
- **The body cap counts string length, not bytes** — `maxRequestBodyBytes` compares `body.length` (UTF-16 code units), so a non-ASCII body may residently occupy up to roughly three times the cap in bytes; the HTTP carrier's byte-based bridge does not share this looseness.
