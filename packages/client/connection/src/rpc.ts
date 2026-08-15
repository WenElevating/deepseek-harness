/** Generic unary RPC contracts shared by the Host and Client Connection halves. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Transport-independent request handler consumed by the Host HTTP bridge. */
export interface FetchHandler {
  /**
   * Handle one standard Fetch request.
   * @param request - request produced by the active transport bridge.
   * @returns complete or streaming Fetch response.
   */
  fetch(request: Request): Promise<Response>
}

/** Trust fence applied before a Host RPC channel reaches its handler. */
export type ConnectionRpcAuthority = 'trusted-host' | 'loopback'

/** Registration policy for one logical RPC channel. */
export interface ConnectionRpcHandlerOptions {
  /** Browser authority accepted by every endpoint in this channel. */
  readonly authority: ConnectionRpcAuthority
}

/** Handler invoked after Connection has decoded the transport envelope. */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean

/** Host registry for logical RPC channels carried by the current transport. */
export interface HostConnectionRpc {
  /**
   * Register one absolute channel prefix and its trust policy.
   * @param channel - absolute logical channel such as `/rpc`.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - channel trust policy.
   * @returns asynchronous disposer removing the channel and its physical route.
   */
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>

  /**
   * Intercept owned endpoints on the shared `/api` channel before its fallback.
   * @param channel - reserved shared channel; currently `/api`.
   * @param matches - synchronous endpoint ownership test.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - trust policy for every endpoint claimed by this interceptor.
   * @returns asynchronous disposer removing the interceptor.
   */
  intercept(
    channel: '/api',
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>
}

/** Host `ctx.connection` shape consumed by transport-independent adapters. */
export interface HostConnectionHandle {
  /** Generic RPC channel registry. */
  readonly rpc: HostConnectionRpc

  /**
   * Compose one shared-channel Fetch handler from its interceptor and fallback.
   * @param channel - shared channel mounted by Connection (`/api`).
   * @param fallback - handler for endpoints not claimed by the interceptor.
   * @returns Fetch handler that selects exactly one target for each request.
   */
  createSharedFetchHandler(channel: '/api', fallback: FetchHandler): FetchHandler

  /**
   * Claim the single physical-carrier seat for the Host half. The HTTP
   * carrier (`http-webserver`) and an IPC carrier each claim once; a claim by
   * a different carrier while the seat is taken is a miscomposition and
   * throws. Re-claiming the same carrier is accepted: the HTTP claim sits in
   * a webServer inject fiber that re-runs when that service restarts, and the
   * seat it records does not change.
   * @param carrier - carrier identity, e.g. `http-webserver` or `electron-ipc`.
   * @throws when a different carrier already claimed the seat.
   */
  claimCarrier(carrier: string): void

  /**
   * Assert some physical carrier claimed the Host half.
   * @throws when no carrier ever claimed — a composition that mounts neither
   * the HTTP carrier nor an IPC carrier plugin.
   */
  assertCarried(): void
}

/** Client caller for logical RPC channels carried by the current transport. */
export interface ClientConnectionRpc {
  /**
   * Call one endpoint through an already registered logical channel.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `goals/create`.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the existing RPC success/error result; correlation stays inside Connection.
   */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcResult<unknown>>
}
