/**
 * Command Code catalog access for the settings half of dsh-commandcode-provider.
 *
 * This bundle deliberately does not own the Command Code route: the installed
 * provider plugin registers the `commandcode` adapter, the credential entry and
 * the model discovery function, and a second plugin registering the same provider
 * would collide with it. What this bundle adds is the part the provider lacks — a
 * settings page — and to do that it needs the same catalog the provider uses.
 *
 * Sources, in the provider's own order:
 *   1. Its cache file (`<dsh home>/commandcode/commandcode-models.json`), which is
 *      what the provider is actually serving right now.
 *   2. Its live endpoint, `https://api.commandcode.ai/provider/v1/models`, which
 *      answers unauthenticated with `{object:"list", data:[{id, name, context_length,
 *      supported_endpoints}]}`.
 *   3. models.dev, which is the only place the prices live. Reading prices from
 *      there is what lets this page bucket a model as paid, plan or free at all.
 *
 * A model that only models.dev knows about (notably the zero-priced
 * `inclusionai/ling-3.1-flash:free`) is marked `notAdvertised` rather than dropped:
 * the provider's discovery would reject it, and the page says so on the row instead
 * of pretending the model is available.
 */

import { readFile } from 'node:fs/promises'

import { positiveInt, tierFromPrice } from './store.js'

export const PROVIDER = 'commandcode'
export const DEFAULT_MODELS_URL = 'https://api.commandcode.ai/provider/v1/models'
export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const DEFAULT_API_BASE = 'https://api.commandcode.ai'
export const DEFAULT_CONTEXT_WINDOW = 262_144
export const DEFAULT_MAX_TOKENS = 32_768

/**
 * Tier policy for Command Code.
 *
 * Unlike an agent free lane, this subscription is sold as a plan: the models are
 * priced, and what the user can reach depends on the plan they bought. So the
 * default buckets are
 *   free — $0 rows, or the documented zero-priced suffix,
 *   plan — cheap rows the plan is expected to cover,
 *   paid — premium rows.
 * The cutoffs are settings (see index.js) so a different plan can re-draw the line
 * without a code change.
 */
export const DEFAULT_FREE_CUTOFF = 0
export const DEFAULT_PLAN_CUTOFF = 2

/** An id priced at nothing by itself, whatever a metadata file says. */
export function looksFree(id) {
  return String(id).toLowerCase().includes(':free') || String(id).toLowerCase().includes('-free')
}

export function tierOf(id, cost, { planCutoff = DEFAULT_PLAN_CUTOFF } = {}) {
  if (cost?.input === 0 && cost?.output === 0) return 'free'
  if (looksFree(id)) return 'free'
  if (cost?.input === undefined && cost?.output === undefined) return tierFromPrice({})
  return tierFromPrice({ inputPrice: cost.input, outputPrice: cost.output, planCutoff })
}

/** Decode the provider's `/provider/v1/models` body (or a bare array). */
export function decodeCatalog(body) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  const seen = new Set()
  const models = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const id = typeof row.id === 'string' ? row.id : undefined
    if (id === undefined || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      name: typeof row.name === 'string' && row.name.length > 0 ? row.name : id,
      contextWindow: positiveInt(row.context_length) ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: Math.min(positiveInt(row.context_length) ?? DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS),
      endpoints: Array.isArray(row.supported_endpoints)
        ? row.supported_endpoints.filter((value) => typeof value === 'string')
        : [],
      advertised: true,
      source: 'catalog',
    })
  }
  models.sort((left, right) => left.id.localeCompare(right.id))
  return models
}

/** Decode models.dev into `id -> {cost, context, name}` for one provider slug. */
export function decodeModelsDev(data, slug = 'commandcode') {
  const section = data?.[slug]
  if (section === null || typeof section !== 'object' || typeof section.models !== 'object') return {}
  const out = {}
  for (const [id, model] of Object.entries(section.models)) {
    if (model === null || typeof model !== 'object') continue
    const input = Number(model.cost?.input)
    const output = Number(model.cost?.output)
    out[id] = {
      name: typeof model.name === 'string' ? model.name : undefined,
      cost: Number.isFinite(input) && Number.isFinite(output) ? { input, output } : undefined,
      context: positiveInt(model.limit?.context),
      outputLimit: positiveInt(model.limit?.output),
    }
  }
  return out
}

/**
 * Join the catalog with the price metadata.
 *
 * Every advertised row is kept even when models.dev has no price for it: dropping
 * it would hide real models, and leaving the price unknown keeps the row in "plan"
 * rather than claiming it is free.
 */
export function joinCatalog(catalog, metadata, { planCutoff = DEFAULT_PLAN_CUTOFF } = {}) {
  const merged = new Map()
  for (const model of catalog) {
    const extra = metadata[model.id]
    merged.set(model.id, {
      ...model,
      ...(extra?.name === undefined ? {} : { name: model.name === model.id ? extra.name : model.name }),
      ...(extra?.context === undefined ? {} : { contextWindow: extra.context }),
      ...(extra?.cost === undefined ? {} : { inputPrice: extra.cost.input, outputPrice: extra.cost.output }),
      ...(extra?.cost === undefined ? { priceUnknown: true } : {}),
      tier: tierOf(model.id, extra?.cost, { planCutoff }),
      note: model.endpoints.length === 1 && model.endpoints[0] === '/messages' ? 'messages-only' : undefined,
    })
  }
  // Models.dev entries the provider does not advertise: visible, but flagged, so a
  // free model the provider's discovery would refuse is not silently offered.
  for (const [id, extra] of Object.entries(metadata)) {
    if (merged.has(id)) continue
    merged.set(id, {
      id,
      name: extra.name ?? id,
      contextWindow: extra.context ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: Math.min(extra.outputLimit ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS),
      endpoints: [],
      advertised: false,
      source: 'metadata',
      notAdvertised: true,
      ...(extra.cost === undefined ? { priceUnknown: true } : { inputPrice: extra.cost.input, outputPrice: extra.cost.output }),
      tier: tierOf(id, extra.cost, { planCutoff }),
    })
  }
  // Advertised models first, then by tier severity, then by id.
  const rank = { free: 0, plan: 1, paid: 2 }
  return [...merged.values()].sort((left, right) => {
    if (left.advertised !== right.advertised) return left.advertised ? -1 : 1
    if (rank[left.tier] !== rank[right.tier]) return rank[left.tier] - rank[right.tier]
    return left.id.localeCompare(right.id)
  })
}

/**
 * Read the provider's own cache file.
 *
 * The provider writes the catalog it fetched and is serving; reading it first means
 * this page agrees with the model picker even when the live endpoint is unreachable.
 * The file shape is the provider's, so a missing or odd file simply yields [].
 */
export async function readProviderCache(path) {
  try {
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    const rows = Array.isArray(parsed?.models) ? parsed.models : Array.isArray(parsed?.data) ? parsed.data : undefined
    if (rows === undefined) return []
    return decodeCatalog({ data: rows.map((row) => (typeof row === 'string' ? { id: row } : row)) })
  } catch {
    return []
  }
}

async function getJson(url, { timeoutMs = 30_000, signal, headers = {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request timed out')), timeoutMs)
  timer.unref?.()
  const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: combined,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GET ${url} answered HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Live catalogue from the provider endpoint. */
export async function fetchCatalog({ url = DEFAULT_MODELS_URL, timeoutMs = 30_000, signal, headers } = {}) {
  return decodeCatalog(await getJson(url, { timeoutMs, signal, headers }))
}

/** Live price metadata from models.dev. */
export async function fetchMetadata({ url = MODELS_DEV_URL, timeoutMs = 30_000, signal } = {}) {
  return decodeModelsDev(await getJson(url, { timeoutMs, signal }))
}
