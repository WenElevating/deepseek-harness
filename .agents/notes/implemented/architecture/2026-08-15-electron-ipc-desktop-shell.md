# Agent Note: Electron desktop shell — carrier-neutral connection, the dsh:// protocol, and the trusted IPC carrier

Status: implemented

English | [中文](2026-08-15-electron-ipc-desktop-shell.zh.md)

> Division of labor: this note owns the desktop shell's carrier architecture — the carrier-neutral Connection host half, the renderer IPC seam, the `dsh://` protocol, and the desktop composition. [Electron main plugin resolution and HMR degradation](2026-08-14-electron-main-plugin-resolution.md) owns the Electron loader gap and the live patch-reload loss; the [profile snapshot and window e2e note](../testing/2026-08-14-electron-profile-snapshot-and-window-e2e.md) owns test coverage and the post-dispose protocol wart; the [GUI layering note](2026-07-19-gui-layering-and-rpc-protocol.md) owns the layering model and the RPC protocol both carriers carry.

## Problem

`dsh` needed a desktop shell that reuses the web client tree without a listening port. Three parts of the web composition required an active webServer: `dsh-web-app`'s runtime glue (LAN trust snapshot, URL line, web-surface prompt section), the Connection host half (its `/api` route and both WebSocket upgrades registered directly on `ctx.webServer`), and the renderer (loaded from the web server's origin). Reusing that composition as-is would give a single-user desktop app a listening port — a LAN-reachable `/api`, port collisions, and a URL line with no user-facing URL — while forking the client tree would duplicate every object-layer fix.

## Decision

### Carrier-neutral Connection host half

`dsh-client-connection`'s host half provides `ctx.connection` with no required service: `HostConnectionService` (`packages/client/connection/src/rpc-host.ts`) owns the `/api` interceptor registry plus one physical-carrier seat. `createSharedFetchHandler('/api', fallback)` composes interceptor-or-fallback dispatch that selects exactly one target per request; `claimCarrier(carrier)` records the seat; `assertCarried()` throws while the seat is empty. The `/api` fallback is carrier-neutral (`createApiFallbackHandler(ctx, { privilegedTrusted })`, `packages/client/connection/src/api-fallback.ts`): the privileged-method gate, the event-path 426 answer, then API Proxy dispatch. Both carriers share the wire constants through the package root's re-export; the `./api-path` subpath additionally publishes them for external consumers.

Exactly one physical carrier claims per composition. The HTTP carrier (`http-webserver`) claims inside its `ctx.inject(['webServer'])` fiber, which fires when the server's listen settles, so the claim and the route never race a binding fiber; a webServer restart re-runs the fiber and re-claims the same identity, which the seat tolerates. The Electron carrier (`electron-ipc`) claims at apply. A claim by a different carrier while the seat is taken throws. Vendored cordis defines no readiness event, so Loader settlement is the readiness signal: after the tree settles, an unclaimed host half fails `assertCarried()` as an unhandled rejection, which the app-boot guard turns into a fatal exit; the check stays quiet on a tree disposed mid-boot (early SIGTERM) and on a failed boot, which the Loader reports (`packages/client/connection/src/index.ts`).

Generic `rpc.handle` channels stay HTTP-only: registration reads `ctx.webServer` and throws when it is absent. Production code uses only `intercept('/api')`, whose interceptor dispatches over any carrier's shared handler — the Electron profile's remote endpoints ride the IPC carrier with no extra registration.

### Server-less web composition

With no webServer row, `dsh-web-app` provides the `webRuntime` service as an empty trust snapshot and mounts none of the HTTP-bound glue — no frontend-static fallback owner, no web-surface prompt section, no URL line — so the `connection` row's `inject: [webRuntime]` still resolves. A webServer first visible only after Loader settlement means this row already committed to the server-less path beside a live server; that row-order miscomposition throws (`packages/bundle/web-app/src/index.ts`). `dsh-client-modules` binds its HTTP bundle route and index tap only under webServer; a server-less host reads the boot graph directly through `ctx.clientModules.graph()`.

### The renderer carrier seam

The preload (`apps/electron/src/preload.ts`) injects exactly `window.__DSH_IPC__` with four members: `fetch` (one `dsh:fetch` invoke per HTTP-style request), `openStream`/`closeStream` (`dsh:openStream`/`dsh:closeStream`), and `onServerRequest` (`dsh:server-request` pushes). `readIpcBridge()` (`packages/client/connection/src/client/ipc-bridge.ts`) returns the bridge, returns undefined outside the desktop shell, and throws when the global is present but malformed — a half-injected bridge fails loud instead of falling back to HTTP against a nonexistent origin. The client plugin selects fixture (`?fixture`) → IPC (bridge present) → HTTP (`WebApiClient`); `packages/client/connection/src/client/index.ts` owns the order.

`IpcApiClient` (`packages/client/connection/src/client/ipc-api-client.ts`) subclasses `AbstractApiClient` and swaps exactly the transport aspects the base class reserves: `doFetch` (the fetch shape over one invoke) and the two stream openers (push-channel pumps). Wire envelopes, rpcId discipline, zod parses, and the base-class deadline machinery are unchanged — the IPC row of the [GUI layering note](2026-07-19-gui-layering-and-rpc-protocol.md)'s subclass table. Main-side, `IpcStreamPumps` (`packages/host/connection-electron/src/ipc-streams.ts`) owns one pump per (sender, channel), wraps each frame in the same `ServerRequest` envelope the WebSocket downlinks send, and aborts exactly the affected source on sender loss (`once('destroyed')`), channel reopen, and plugin disposal.

### The `dsh://` privileged protocol

The renderer loads `dsh://app/`, not `file://`. A `file://` page gets an opaque origin, and the vite build emits root-absolute asset paths (`/assets/...`) that resolve against the filesystem root, so `file://` would need a relocated build; `fetch` and streaming responses are also restricted there. The `dsh` scheme registers as privileged (`standard`, `secure`, `supportFetchAPI`, `stream`) before app ready (`apps/electron/src/main.ts`). The handler (`apps/electron/src/protocol.ts`) serves the built `apps/web` dist, reusing `injectBootManifest` from `dsh-client-modules` — the same function the HTTP carrier's `tapIndex` path applies — so renderer script discovery is unchanged and the shell's `BootSeams` custom-bundle-load parameter stays unused. `/plugins/<id>/client.js[.map]` serves from `ctx.clientModules` with the same mapping as `ClientModuleRegistry.serveBundle`. `/api/session.export` is the only `/api` route the protocol handler serves: the export download navigates the renderer to a `dsh://` URL, so the handler forwards that one request through `toFetchHandler(apiProxy)` to produce the attachment response; every other `/api` request rides the IPC carrier.

### Carrier trust and `isLoopback`

The privileged-method fence stays in the carrier-neutral fallback. The HTTP carrier passes `privilegedTrusted: false` and leans on the loopback/`trustedHosts` fence; the IPC carrier passes `privilegedTrusted: true` — an explicit carrier trust property, not a removed check. The IPC channels are unreachable from the network and serve only the app's own renderer, which runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, navigation locked to `dsh://app`, and new windows denied: the channel's trust strength is at least a loopback HTTP origin's, which is exactly what the fence expresses for the browser carrier. `maxRequestBodyBytes` caps every `dsh:fetch` body.

The client handle reports `isLoopback: true` when a bridge is present. The desktop renderer's authority is `dsh://app`, not a loopback hostname; without the bridge-derived value, `openPath` and host-scoped settings affordances would silently degrade.

### The desktop composition

The `electron` profile template stacks `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-electron-app` (`packages/boot/app-boot/src/profile.ts`). The `dsh-electron-app` bundle is a patch layer (`packages/bundle/electron-app/cordis.patch.yml`): it disables the `webserver`, `client-hmr`, and `directory-picker` rows, inserts `connection-electron` and `directory-picker-electron`, and keeps `web-runtime` mounted with `printUrl: false` and `surfaceContext: false` — the row stays because the `connection` row injects `webRuntime` and a patch cannot rewrite another row's `inject`; with no webServer the row provides the empty snapshot. `packages/bundle/electron-app/tests/composition.spec.ts` pins the row set against the real `loadProfile`/`composeEntries` path.

`apps/electron` main boots the profile through `runProfile` (the CLI's launcher entry, `@deepseek-ai/dsh/profile-boot`), registers `dsh://`, opens one sandboxed window, renders boot failures through a cause-chain error box, and disposes the tree exactly once on every quit path; `--dsh-smoke` replaces dialogs and interactive lifetime with machine-checked assertions. `ElectronDirectoryPicker` (`packages/host/directory-picker-electron/src/index.ts`) registers the `native` capability from inside the main process — no cross-process hop — and replaces the `-native` row; both register the `native` capability, so exactly one backend row may load.

### Native modules: no electron-rebuild

The tree's native modules — `node-pty` (under `dsh-subprocess-local`) and `koffi` — are N-API modules whose prebuilds load in Electron's embedded Node without recompilation. `@electron/rebuild` was evaluated for the toolchain and then dropped: the desktop shell runs on the same prebuilds as plain Node, so no rebuild step exists to own. Running `@electron/rebuild --force` against `node-pty` overwrites its prebuilt binary and deletes the Windows `conpty` support files, breaking the terminal backend; do not run it in this repository.

## Alternatives considered

**A listening loopback webServer inside the desktop shell.** Reuses the HTTP carrier with zero code, but turns a single-user desktop app into a port-holding local server — port collisions, a `/api` that a `0.0.0.0` misconfiguration exposes, and a URL line with no user-facing URL. The carrier split costs three packages and one carrier seam; the server costs a permanent security and operations surface.

**A parallel desktop client tree.** A second client tree keeps the host untouched but forks every object-layer fix across two renderers. The IPC carrier reuses the web client packages unchanged; only the transport aspects differ.

**`file://` loading.** Opaque origin, root-absolute vite asset paths, and restricted fetch/streaming make it a build-and-API workaround rather than a load mechanism; the `dsh://` handler is ~120 lines and keeps the dist byte-identical to the web build.

**A native IPC RPC face (no fetch shape).** Protocol invariants — envelope parse, rpcId echo check, deadlines — live in the base class above `doFetch`; a per-channel native face would re-implement them and fork the wire contract. Bridging the fetch shape over invoke keeps one contract for both carriers.

**Carrier presence detected by service identity (the IPC provider also providing `ctx.connection`).** Two providers of one service collide in cordis' registry, and presence cannot distinguish the HTTP carrier from the IPC carrier. The claim seat records carrier identity, so a tree that mounts both carriers fails at the second claim naming both, not at a silent route loss.

**An IPC-specific privileged-method list.** A second fence would drift from `PRIVILEGED_METHODS`. `privilegedTrusted` states the carrier's trust once; the one fence stays authoritative for both carriers.

## Consequences

The web profile carries no new behavior from the carrier split: its snapshot output pins the refactor as behavior-preserving. The `host/` group holds a package that imports `electron` — plain-Node profiles never load it, and its composition is confined to the `electron` profile template. Known limitations: `dsh://` responses carry no CSP header yet (the renderer logs a warning; the header belongs in `apps/electron/src/protocol.ts` when added), and the protocol handler answers dist misses with 404 where `frontend-static` answers the SPA fallback with 200, so client-side routes that resolve only through fallback do not load under `dsh://`. Live patch-layer reload stays unavailable on the desktop shell (restart applies `cordis.patch.yml` edits; [loader note](2026-08-14-electron-main-plugin-resolution.md)), and the handler's post-dispose behavior throws instead of answering 503 ([testing note](../testing/2026-08-14-electron-profile-snapshot-and-window-e2e.md)); the connection-electron README owns the wire-level caps (invoke has no cancellation leg; the body cap counts string length).

## Verification

`packages/client/connection/tests/node-half.host.spec.ts` pins the claim semantics (same-carrier re-claim tolerated, different carrier throws, settlement fail-loud, mid-boot disposal guard) and `ipc-api-client.client.spec.ts` the renderer carrier (stream-open failure containment, pre-abort ordering); `packages/bundle/web-app/tests/web-server-optional.spec.ts` pins the server-less path and the late-webServer failure; `packages/bundle/electron-app/tests/composition.spec.ts` pins the composed rows; `apps/electron/tests/protocol.spec.ts` pins the `dsh://` handler (boot-graph injection order, MIME mapping, encoded traversal rejection, bundle and export routes). `electron . --dsh-smoke` boots the real profile and asserts the renderer's boot graph, the four-member bridge, one `dsh:fetch` round-trip, and that no `webServer` service mounted, exiting nonzero on any failure; the keyless profile snapshot and the Playwright window e2e are owned by the [testing note](../testing/2026-08-14-electron-profile-snapshot-and-window-e2e.md).
