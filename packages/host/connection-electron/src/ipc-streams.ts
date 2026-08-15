/** Main-process pumps for the two downlink streams, mirroring WebSocketDownlinks over webContents.send. */

import { randomUUID } from 'node:crypto'
import type {
  ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

type Frame = MuxFrame | HostFrame

/** The ipcMain event surface one pump consumes from a single renderer. */
interface SenderLike {
  /** Push one payload on the `dsh:server-request` channel; throws once the webContents is destroyed. */
  send(channel: string, payload: unknown): void
  /** Register the single-shot renderer-loss callback that ends the sender's pumps. */
  once(event: 'destroyed', listener: () => void): void
  /** Remove a loss callback `once` registered; a fired or absent listener is a no-op. */
  removeListener(event: 'destroyed', listener: () => void): void
}

/** One live pump: its source's abort controller plus the release that empties its seat. */
interface PumpSeat {
  /** Ends the source; `release` also aborts, and aborting twice is a no-op. */
  controller: AbortController
  /** Empty the seat when it is still current, detach its loss listener, and abort. */
  release(): void
}

/** Stable per-object identity for pump keys (webContents are opaque handles). */
const senderSentinels = new WeakMap<object, number>()
let nextSentinel = 0

/**
 * Read the sender's stable identity, assigning one on first sight.
 * @param sender - one renderer's event sender object.
 * @returns the identity used to key that sender's pumps.
 */
function senderSentinel(sender: object): number {
  const existing = senderSentinels.get(sender)
  if (existing !== undefined) return existing
  const assigned = nextSentinel
  nextSentinel += 1
  senderSentinels.set(sender, assigned)
  return assigned
}

/**
 * Wrap one downlink frame in the ServerRequest envelope.
 * @param frame - frame from the typed event stream.
 * @returns the envelope pushed to the renderer.
 */
function serverRequest(frame: RpcRequest<Frame>): ServerRequest {
  return {
    type: 'server-request',
    rpcId: frame.rpcId,
    method: frame.payload.type,
    payload: frame.payload,
  }
}

/**
 * Build the terminal stream/error frame for a failed source.
 * @param error - the failure raised by the event stream.
 * @returns a fresh-rpcId frame the renderer surfaces as a channel failure.
 */
function failureFrame(error: unknown): RpcRequest<Frame> {
  return {
    rpcId: RpcId(randomUUID()),
    payload: {
      type: 'stream/error',
      error: { code: 'internal', message: String(error), details: {} },
    },
  }
}

/**
 * Owns one pump per (sender, channel); replacing or losing the sender aborts
 * its stream. The renderer asks for a channel over `dsh:openStream` and
 * receives `{ channel, frame }` pushes on `dsh:server-request`.
 */
export class IpcStreamPumps {
  private readonly pumps = new Map<string, PumpSeat>()

  /**
   * @param api - host API supplying the typed event streams.
   */
  constructor(private readonly api: ApiProxy) {}

  /**
   * Start (or restart) one channel's pump toward the sender.
   * @param channel - logical downlink to pump.
   * @param sender - the requesting renderer's event sender.
   */
  open(channel: 'mux' | 'host', sender: SenderLike): void {
    this.take(channel, sender)
    const key = `${String(senderSentinel(sender))}:${channel}`
    const controller = new AbortController()
    const seat: PumpSeat = {
      controller,
      release: () => {
        if (this.pumps.get(key) === seat) this.pumps.delete(key)
        sender.removeListener('destroyed', onLost)
        controller.abort()
      },
    }
    // A reload reuses the webContents, so 'destroyed' never fires between
    // re-opens: every seat owns its loss listener, and take() releases the
    // superseded one, or each reload stacks two more never-firing listeners
    // (MaxListenersExceededWarning after a few reloads) and every destroyed
    // sender leaves its seat behind.
    const onLost = (): void => { seat.release() }
    this.pumps.set(key, seat)
    sender.once('destroyed', onLost)
    const open = channel === 'mux'
      ? (signal: AbortSignal): AsyncIterable<RpcRequest<Frame>> =>
        this.api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, signal)
      : (signal: AbortSignal): AsyncIterable<RpcRequest<Frame>> =>
        this.api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, signal)
    void this.pump(sender, channel, open(controller.signal), seat)
  }

  /**
   * Stop one channel's pump for the sender.
   * @param channel - logical downlink to stop.
   * @param sender - the renderer whose pump stops.
   */
  close(channel: 'mux' | 'host', sender: SenderLike): void {
    this.take(channel, sender)
  }

  /**
   * Stop every pump (plugin disposal).
   */
  closeAll(): void {
    // Each seat's release deletes its own entry, so iteration ends with an empty map.
    for (const seat of this.pumps.values()) seat.release()
  }

  private take(channel: 'mux' | 'host', sender: SenderLike): void {
    const key = `${String(senderSentinel(sender))}:${channel}`
    this.pumps.get(key)?.release()
  }

  private async pump<F extends Frame>(
    sender: SenderLike,
    channel: 'mux' | 'host',
    frames: AsyncIterable<RpcRequest<F>>,
    seat: PumpSeat,
  ): Promise<void> {
    try {
      for await (const frame of frames) {
        sender.send('dsh:server-request', { channel, frame: serverRequest(frame) })
      }
    } catch (error) {
      if (!seat.controller.signal.aborted) {
        // Frame delivery fails only in the narrow window where the source
        // failed before the sender's loss aborted it; after the failure frame
        // the renderer reconnects on its own.
        try {
          sender.send('dsh:server-request', { channel, frame: serverRequest(failureFrame(error)) })
        } catch {
          // Sender destroyed: no downstream remains to receive the failure frame.
        }
      }
    } finally {
      seat.release()
    }
  }
}
