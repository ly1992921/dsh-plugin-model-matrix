/**
 * Shared browser-facing route handler.
 *
 * Each bundle mounts exactly one `webServer` prefix route and hands the store to
 * this factory. The client half talks to it over same-origin `fetch`, which keeps
 * the settings page working on every kernel line the bundles target — no typed
 * Remote binding to keep in sync, and no per-endpoint allowlist to grow.
 *
 * Routes (all relative to the mounted prefix):
 *   GET  /state                       → projected store (models, tiers, visibility, status)
 *   POST /refresh                     → re-read the upstream catalog now
 *   POST /tiers     {tiers}           → which of free/plan/paid the dialog offers
 *   POST /override  {model, visibility?, tier?}
 *                                     → set or clear one model's override
 *   POST /probe     {model}           → test one model, record + return the status
 *   POST /probeAll  {models?}         → test many models with bounded concurrency
 *   POST /probeSet  {statuses}        → record statuses the client already measured
 */

import { pool } from './probe.js'
import { TIERS, visibleModelIds } from './store.js'

/** Cap on a JSON request body — these payloads are tiny. */
const MAX_BODY_BYTES = 64 * 1024

/** Read and parse a JSON request body. Throws on malformed input. */
export async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const parsed = JSON.parse(text)
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

function send(res, status, payload) {
  const body = payload === undefined ? '' : `${JSON.stringify(payload)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(body === '' ? {} : { 'content-length': Buffer.byteLength(body) }),
  })
  res.end(body)
}

/**
 * @param {object} options
 * @param {import('./store.js').ModelStore} options.store
 * @param {() => Promise<object>} options.refresh       re-reads the upstream catalog
 * @param {(modelId: string, signal?: AbortSignal) => Promise<object>} options.probe
 * @param {(doc: object) => object} options.project     store → browser projection
 * @param {(doc: object) => void} [options.refreshRoutes] callback after visibility changes
 * @param {number} [options.probeConcurrency]
 * @param {(message: string) => void} [options.warn]
 */
export function createModelApi({ store, refresh, probe, project, refreshRoutes, visibleForProbe, probeConcurrency = 3, warn, apiMount }) {
  const log = warn ?? (() => {})
  return async function handle(req, res, url) {
    const path = normalisePath(url?.pathname ?? req.url ?? '', apiMount)
    // The host owns the sweep rule, but a host hook is allowed to be synchronous or
    // asynchronous, so it is awaited AND double-guarded: a hook that throws or returns
    // nothing must degrade to the plain projection, never to a 500.
    const visibleIds = async (document, includeHidden) => {
      try {
        const decided = await visibleForProbe?.(document, { includeHidden })
        if (Array.isArray(decided)) return decided
      } catch (error) {
        log(`visibleForProbe failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      return includeHidden === true ? document.models.map((model) => model.id) : visibleModelIds(document)
    }
    try {      if (req.method === 'GET' && (path === '/state' || path === '')) {
        const document = await store.read()
        return send(res, 200, { ok: true, store: project(document) })
      }
      if (req.method === 'POST' && path === '/refresh') {
        let warning
        try {
          await refresh()
        } catch (error) {
          warning = error instanceof Error ? error.message : String(error)
          log(`refresh failed: ${warning}`)
        }
        const document = await store.read()
        return send(res, 200, { ok: true, store: project(document), ...(warning === undefined ? {} : { warning }) })
      }
      if (req.method === 'POST' && path === '/tiers') {
        const body = await readJson(req)
        const requested = Array.isArray(body.tiers) ? body.tiers : []
        const tiers = TIERS.filter((tier) => requested.includes(tier))
        if (tiers.length === 0) return send(res, 400, { ok: false, error: 'tiers must include free, plan or paid' })
        await store.update((draft) => {
          draft.offeredTiers = tiers
        })
        await refreshRoutes?.()
        return send(res, 200, { ok: true, store: project(await store.read()) })
      }
      if (req.method === 'POST' && path === '/override') {
        const body = await readJson(req)
        const modelId = typeof body.model === 'string' ? body.model : undefined
        if (modelId === undefined) return send(res, 400, { ok: false, error: 'model is required' })
        const visibility = body.visibility
        const tier = body.tier
        if (visibility !== undefined && visibility !== 'show' && visibility !== 'hide' && visibility !== 'inherit') {
          return send(res, 400, { ok: false, error: 'visibility must be show, hide or inherit' })
        }
        if (tier !== undefined && tier !== 'free' && tier !== 'plan' && tier !== 'paid' && tier !== 'inherit') {
          return send(res, 400, { ok: false, error: 'tier must be free, plan, paid or inherit' })
        }
        // An override for a model the catalog does not carry can never take
        // effect, and accepting it would leave a silent dot in the store forever.
        const known = new Set((await store.read()).models.map((model) => model.id))
        if (!known.has(modelId)) return send(res, 400, { ok: false, error: `unknown model "${modelId}"` })
        await store.update((draft) => {
          // `clear` is the whole-override reset: dropping the entry is what makes
          // the model follow its tier again, and it is the only way to undo both
          // fields in one request without guessing their previous values.
          if (body.clear === true) {
            delete draft.overrides[modelId]
            return
          }
          const next = { ...(draft.overrides[modelId] ?? {}) }
          if (visibility === 'show' || visibility === 'hide') next.visibility = visibility
          else if (visibility === 'inherit') delete next.visibility
          if (tier === 'free' || tier === 'plan' || tier === 'paid') next.tier = tier
          else if (tier === 'inherit') delete next.tier
          if (next.visibility === undefined && next.tier === undefined) delete draft.overrides[modelId]
          else draft.overrides[modelId] = next
        })
        await refreshRoutes?.()
        return send(res, 200, { ok: true, store: project(await store.read()) })
      }
      if (req.method === 'POST' && path === '/probe') {
        const body = await readJson(req)
        const modelId = typeof body.model === 'string' ? body.model : undefined
        if (modelId === undefined) return send(res, 400, { ok: false, error: 'model is required' })
        const status = await probe(modelId)
        await store.setStatus(modelId, status)
        return send(res, 200, { ok: true, status, store: project(await store.read()) })
      }
      if (req.method === 'POST' && path === '/probeall') {
        const body = await readJson(req)
        const requested = Array.isArray(body.models) ? body.models.filter((id) => typeof id === 'string') : undefined
        const document = await store.read()
        // The host owns the sweep rule: a subscription decides for itself whether a
        // sweep means "what the picker shows" or "the whole catalog".
        const target = requested ?? (await visibleIds(document, body.includeHidden))
        const statuses = await pool(target, probeConcurrency, async (modelId) => {
          try {
            return [modelId, await probe(modelId)]
          } catch (error) {
            return [modelId, { state: 'fail', code: 'SERVER', detail: String(error?.message ?? error).slice(0, 300), at: Date.now() }]
          }
        })
        await store.setStatuses(statuses)
        return send(res, 200, { ok: true, store: project(await store.read()) })
      }
      if (req.method === 'POST' && path === '/probeset') {
        const body = await readJson(req)
        const entries = Object.entries(body.statuses ?? {}).filter(
          ([id, value]) => typeof id === 'string' && value !== null && typeof value === 'object',
        )
        if (entries.length === 0) return send(res, 400, { ok: false, error: 'statuses is required' })
        await store.setStatuses(entries)
        return send(res, 200, { ok: true, store: project(await store.read()) })
      }
      return send(res, 404, { ok: false, error: `no such route: ${path}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`${req.method} ${path} failed: ${message}`)
      // A body that does not parse is the client's mistake, not a server fault: it
      // must answer 400 so the page shows the real problem instead of retrying.
      const malformed = error instanceof SyntaxError || /request body too large/.test(message)
      return send(res, malformed ? 400 : 500, { ok: false, error: message })
    }
  }
}

/** Strip a mount prefix, whether the host trimmed it or handed it over intact. */
function normalisePath(value, prefix) {
  let path = String(value ?? '')
  const query = path.indexOf('?')
  if (query >= 0) path = path.slice(0, query)
  // `webServer` longest-prefix dispatch hands over the full pathname, so the
  // handler is asked to remove the mount itself — `/api/<ns>/state` is `/state`.
  // (Slicing at the last `/api/` is not enough: this plugin's own names all start
  // with `api/` once mounted, so `/api/opencode-zen` contains `api/opencode-zen`;
  // the last marker lands in the middle of the name and eats it.)
  const mount = prefix === undefined ? undefined : String(prefix).replace(/\/+$/, '')
  if (mount !== undefined && (path === mount || path.startsWith(`${mount}/`))) {
    path = path.slice(mount.length)
  }
  if (!path.startsWith('/')) path = `/${path}`
  // `/state` is the resting route, so the bare mount answers it too.
  if (path === '/') path = '/state'
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}
