/**
 * The `dsh://` privileged-protocol handler: dist files, plugin client bundles,
 * and the session-export download route. Everything else under `dsh://` is a
 * static file; `/api` traffic does NOT pass through here — it rides the
 * connection-electron IPC carrier instead.
 * @module @deepseek-ai/dsh-electron/protocol
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { injectBootManifest, type WebBootGraph } from '@deepseek-ai/dsh-client-modules'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

function fileResponse(body: BodyInit, contentType: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType, 'cache-control': 'no-cache' } })
}

/**
 * Content type for one extension; unknown extensions are opaque byte streams.
 * @param extension - the extension including its leading dot.
 * @returns the MIME content type.
 */
function contentType(extension: string): string {
  return MIME[extension] ?? 'application/octet-stream'
}

/**
 * Serve one `dsh://` request against the booted tree and the frontend dist.
 * @param ctx - the booted profile root context.
 * @param distRoot - absolute path of the built apps/web dist.
 * @param request - the protocol request.
 * @returns the response for the renderer.
 */
export async function handleDshProtocol(ctx: Context, distRoot: string, request: Request): Promise<Response> {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    // A malformed percent escape must answer, not reject: an unhandled throw
    // inside protocol.handle surfaces as an opaque renderer network error.
    return new Response('malformed request path encoding', { status: 400 })
  }
  if (pathname.startsWith('/plugins/')) return serveBundle(ctx, pathname)
  if (pathname.startsWith('/api/session.export')) return serveExport(ctx, request)
  return serveStatic(distRoot, pathname, ctx.clientModules.graph())
}

async function serveStatic(distRoot: string, pathname: string, graph: WebBootGraph): Promise<Response> {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  const candidate = normalize(join(distRoot, relative))
  // The URL parser already collapses literal dot segments; the guard stops
  // encoded ones (%2e%2e%2f) that survive into the decoded path.
  if (!candidate.startsWith(distRoot + sep)) {
    return new Response('forbidden', { status: 403 })
  }
  try {
    const info = await stat(candidate)
    if (info.isDirectory()) return new Response('not found', { status: 404 })
    const body = await readFile(candidate)
    if (relative === 'index.html') {
      // The same function the HTTP carrier's tapIndex applies: the boot graph
      // injection must precede the shell script in <head>.
      return fileResponse(injectBootManifest(body.toString('utf8'), graph), contentType('.html'))
    }
    return fileResponse(body, contentType(extname(relative)))
  } catch {
    // ENOENT and unreadable files share the not-found answer; the desktop
    // shell exposes no dist directory listing to leak. The deliberate
    // divergence from frontend-static's index.html fallback: a dist miss
    // stays 404 instead of serving the SPA shell, so a missing asset is
    // never masked as HTML — a future client history route that relies on
    // the fallback would have to add it here (the desktop-shell
    // architecture note owns the decision).
    return new Response('not found', { status: 404 })
  }
}

async function serveBundle(ctx: Context, pathname: string): Promise<Response> {
  // The same mapping as ClientModuleRegistry.serveBundle: /plugins/<id>/client.js[.map],
  // where the id is the entry's package name (scope slash included).
  const prefix = '/plugins/'
  const mapSuffix = '/client.js.map'
  const bundleSuffix = '/client.js'
  const isSourceMap = pathname.endsWith(mapSuffix)
  const suffix = isSourceMap ? mapSuffix : bundleSuffix
  const clientPath = pathname.startsWith(prefix) && pathname.endsWith(suffix)
    ? ctx.clientModules.clientPath(pathname.slice(prefix.length, -suffix.length))
    : undefined
  if (clientPath === undefined) return new Response('not found', { status: 404 })
  try {
    const body = await readFile(isSourceMap ? `${clientPath}.map` : clientPath)
    return fileResponse(body, contentType(isSourceMap ? '.json' : '.js'))
  } catch {
    // Registered but unreadable (not yet built): a 404 beats silently
    // falling back to HTML, which the renderer would execute as a script.
    return new Response('not found', { status: 404 })
  }
}

async function serveExport(ctx: Context, request: Request): Promise<Response> {
  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined) return new Response('not found', { status: 404 })
  // The query carries the sessionId; rebuilding from the pathname alone would
  // strip it, so the original search string rides along to the canonical
  // carrier host. The download response passes through unchanged: the api
  // already sets `content-disposition: attachment` with the session's filename.
  const url = new URL(request.url)
  const incoming = new Request(new URL(`/api/session.export${url.search}`, 'http://dsh.internal'), request)
  return toFetchHandler(apiProxy).fetch(incoming)
}
