/**
 * Typed declarations for the headless `electron` stub
 * (`electron-stub.mjs`), so the smoke fixture reads the stub registry through
 * the same strictness as the rest of the host aggregate.
 */

/** One registered `ipcMain` handler as the carrier binds it. */
export type IpcHandler = (event: unknown, raw: unknown) => Promise<unknown> | unknown

/** Registered `ipcMain` handlers, keyed by channel; the smoke's assertion surface. */
export declare const ipcHandlers: Map<string, IpcHandler>
