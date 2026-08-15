/**
 * Carrier-neutral `/api` fallback handler: the privileged-method gate, the
 * event-path 426 answer, and dispatch to the API Proxy. The HTTP carrier and
 * the Electron IPC carrier both compose their Fetch handler over this one
 * implementation; only the carrier-trust declaration differs.
 */

import type { Context } from '@deepseek-ai/cordis'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type { FetchHandler } from './rpc.ts'
import { isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'

/**
 * Methods gated to loopback even on a trusted-host deployment. Native dialogs
 * act on the host machine; the settings and credential domains mutate the
 * user's configuration and secret store, and READING them is equally
 * privileged — `settings.describe` returns every exposed namespace's
 * configuration and `credentials.describe` reports whether an arbitrary
 * environment-variable name is configured and where from, which is
 * reconnaissance no anonymous caller should have. `trustedHosts` is a
 * DNS-rebinding fence, explicitly not authentication, so the whole
 * configuration plane stays loopback-same-origin until a real authentication
 * layer exists. `llm.discoverModels` belongs to that plane on both counts: it
 * carries a draft credential, and it makes the HOST issue a GET to a URL the
 * caller chose and reports back the status or the parsed body — an anonymous
 * LAN caller would have a probe for whatever the host can reach and the
 * browser cannot.
 *
 * The model catalog (`llm.providers`, `llm.models`) is deliberately NOT here:
 * it carries provider ids, display names, and model lists — no endpoints,
 * keys, or key state — and a LAN client's model picker legitimately needs it.
 */
const PRIVILEGED_METHODS = new Set([
  // A preset composition names the plugins a session runs, so reading one is
  // reconnaissance; copy and remove rearrange what the deployment offers, and
  // openDocument drives the host desktop — all more than the roster beside
  // them. (Authoring is copy-only, so no method here accepts composition text
  // or a path; the pin is about who may manage the roster at all.)
  //
  // CHOOSING one is not pinned, and `agentPreset.list` is not either. Picking a
  // preset looks like escalation — one of them mounts the toolset that edits the
  // live runtime — but `session.create` already takes an `agentPreset`, so
  // pinning only the switch would leave the same capability one method over.
  // The deeper reason is that the capability is not the preset's to grant: the
  // deployment's own default already carries `bash` and the filesystem tools, so
  // any caller that may start a session at all can already run commands as this
  // process. Pinning the switch would be a fence beside an open gate.
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.openPath',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])

/** Carrier trust declaration for the `/api` fallback. */
export interface ApiFallbackOptions {
  /**
   * Whether the physical carrier already proves a trusted context. The HTTP
   * route passes false and leans on the loopback fence; the Electron IPC
   * carrier passes true — the channel is unreachable from the network and
   * serves only the app's own renderer.
   */
  readonly privilegedTrusted: boolean
}

/**
 * Build the `/api` fallback for endpoints no shared-channel interceptor
 * claimed.
 * @param ctx - host context; `apiProxy` is read per request and may be absent.
 * @param options - carrier trust declaration.
 * @returns Fetch handler applying the privileged-method gate, the event-path
 * 426 answer, then API Proxy dispatch (404 when no proxy is mounted).
 */
export function createApiFallbackHandler(ctx: Context, options: ApiFallbackOptions): FetchHandler {
  return {
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const method = pathname.startsWith(`${API_PATH}/`)
        ? pathname.slice(API_PATH.length + 1)
        : undefined
      if (method !== undefined
        && PRIVILEGED_METHODS.has(method)
        && !options.privilegedTrusted
        && !isTrustedApiRequest(request, [])) {
        return new Response('forbidden', { status: 403 })
      }
      if (request.method === 'GET' && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
        return new Response('upgrade required', {
          status: 426,
          headers: { connection: 'Upgrade', upgrade: 'websocket' },
        })
      }
      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined) return new Response('not found', { status: 404 })
      return toFetchHandler(apiProxy).fetch(request)
    },
  }
}
