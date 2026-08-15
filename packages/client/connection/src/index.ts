/**
 * Host half of the client connection: provides the carrier-neutral
 * `connection` service (shared `/api` composition, generic RPC channels, the
 * carrier claim) and, once a webServer is active, mounts the HTTP carrier —
 * the fenced `/api` route and the two WebSocket event downlinks. A
 * server-less composition (the Electron main process) provides the same
 * service and lets an IPC carrier claim the seat instead.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
// Activates the webServer Context merge used below.
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
// Activates the loader Context merge read for settlement below.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { createApiFallbackHandler } from './api-fallback.ts'
import { HostConnectionService } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  FetchHandler,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'
export type { ApiFallbackOptions } from './api-fallback.ts'
export { createApiFallbackHandler } from './api-fallback.ts'
export { DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection (none: the physical carrier is optional and claims its seat at mount). */
export const inject: string[] = []

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
  /** Maximum buffered JSON body for every `/api` request. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Provide the carrier-neutral Host service and mount the HTTP carrier when a
 * webServer is active.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(ctx, trustedHosts)
  const fetchHandler = connection.createSharedFetchHandler(
    API_PATH,
    createApiFallbackHandler(ctx, { privilegedTrusted: false }),
  )
  // The HTTP carrier mounts only on an ACTIVE webServer: the inject fires
  // once the server's listen settles, so the claim and the route never race
  // a binding fiber. The webServer row may still be loading when this row
  // activates.
  ctx.inject(['webServer'], (webCtx) => {
    connection.claimCarrier('http-webserver')
    const route: WebRoute = {
      kind: 'prefix',
      path: API_PATH,
      handler: async (req, res) => {
        if (!isTrustedApiRequest(req, trustedHosts)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        await bridge(req, res, fetchHandler, maxRequestBodyBytes)
      },
    }
    webCtx.effect(() => webCtx.webServer.register(route), 'client-connection: /api route')
    webCtx.inject(['apiProxy'], (apiCtx) => {
      assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
      const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
      const registerDownlink = (
        path: string,
        handle: WebUpgradeRoute['handler'],
      ): void => {
        apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
          path,
          handler: (req, socket, head) => {
            if (!isTrustedApiRequest(req, trustedHosts)) {
              rejectWebSocketUpgrade(socket)
              return
            }
            return handle(req, socket, head)
          },
        }), `client-connection: ${path} WebSocket`)
      }
      apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
      registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => { downlinks.handleMux(req, socket, head) })
      registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => { downlinks.handleHost(req, socket, head) })
    })
  })
  // Exactly one physical carrier must claim the Host half: the HTTP webServer
  // above, or an IPC carrier plugin in a server-less profile. This cordis
  // defines no 'ready' event (vendor/cordis/src/events.ts declares and
  // dispatches internal/* events only), so Loader settlement is the readiness
  // signal: after the tree settles, an unclaimed Host half is a
  // miscomposition that fails loud as an unhandled rejection, which the
  // app-boot guard turns into a fatal exit. A failed boot stays quiet — the
  // Loader reports it. Hand-built trees without a Loader assert on the next
  // microtask, by which point a webServer provided before this plugin has
  // activated its inject fiber and claimed; such a tree providing webServer
  // later has no settlement point and must order the provide first.
  const settled = ctx.get('loader')?.await()
  if (settled === undefined) {
    void Promise.resolve().then(() => { connection.assertCarried() })
  } else {
    void settled.then(() => {
      // The tree can be disposed while the boot was in flight (early SIGTERM);
      // a disposed Host half is no longer part of the composition and has no
      // carriership to assert, and the miscomposition error would turn a clean
      // shutdown into a fatal exit. A strict read of this plugin's own service
      // is undefined once its fiber is gone, carrier-neutrally (an IPC profile
      // never mounts a webServer to check instead).
      if (ctx.get('connection') === undefined) return
      connection.assertCarried()
    // Loader reports a failed boot; this check only stays quiet.
    }, () => {})
  }
}
