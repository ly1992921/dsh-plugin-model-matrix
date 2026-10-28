/**
 * Opencode Zen catalog and free-lane policy.
 *
 * Ported from FishBottle7/opencode2dsh (packages/plugin/src/adapter/catalog.ts and
 * ids.ts) at commit 06a7029. The rules below are the upstream ones, restated for
 * this plugin's store shape:
 *
 *  - `GET https://opencode.ai/zen/v1/models` is public and needs no real bearer;
 *    the literal key `public` is part of the free lane.
 *  - A free lane is not simply "the id contains free". Upstream keeps a blocklist
 *    of ids that were once free and are now gone or restricted, and requires the
 *    gate headers and a canonical `ses_…` id as well (see wire.js).
 *  - Prices come from the row's cost block when present; otherwise the `-free`
 *    suffix is the only signal, and an unknown price must not be bucketed as paid
 *    or the free lanes would vanish from the Free tab.
 *
 * If the upstream list changes, only the two tables below need editing: the
 * decoder reads the live catalog every refresh.
 */

import { positiveInt, tierFromPrice } from './store.js'

export const PROVIDER = 'opencode-zen'
export const ZEN_BASE_URL = 'https://opencode.ai/zen'
export const DEFAULT_API_KEY_ENV = 'OPENCODE_ZEN_API_KEY'

/** The literal bearer the free lane expects; also the default when no key is set. */
export const ANONYMOUS_KEY = 'public'

/**
 * Ids that upstream marks as no-longer-free: each either 404s now or answers a
 * free-tier restriction error. Offering them would give the user a permanently
 * red light, so they are dropped from the catalog.
 */
export const FREE_LANE_BLOCKLIST = new Set([
  'exo-free',
  'jev-1.13-free',
  'ling-3.0-flash-fin-free',
  'muse-spark-1.2-contributor-free',
  'muse-spark-1.3-contributor-free',
])

/** Ids upstream falls back to when the live catalog cannot be read at all. */
export const STATIC_FREE_MODELS = ['big-pickle', 'mimo-v2.6-flash-free', 'nemotron-3.5-lightning-free']

/** Models whose context is larger than the catalog reports. */
export const MODEL_OVERRIDES = {
  'mimo-v2.6-flash-free': { contextWindow: 1_048_576 },
}

/** Upstream's vision heuristic for ids the catalog under-describes. */
const VISION_FALLBACK = /^mimo-v2\.6/i

/** Zen serves spark-family models on the Responses API instead of chat completions. */
const RESPONSES_ONLY_PREFIXES = ['muse-spark']

export function isResponsesModel(id) {
  return RESPONSES_ONLY_PREFIXES.some((prefix) => String(id).startsWith(prefix))
}

/** True when the row should never appear in the picker. */
export function isOfferableModel(id) {
  if (typeof id !== 'string' || id.length === 0) return false
  return !FREE_LANE_BLOCKLIST.has(id)
}

/** Upstream's name-based free test, kept as the documented fallback. */
export function looksFree(id) {
  return String(id).toLowerCase().includes('free')
}

/**
 * Decide a row's tier.
 *
 * The live `/v1/models` rows carry only `{id, object, created, owned_by}` — no
 * cost, no limits. So a row is free when its price metadata says $0, or when the id
 * carries upstream's `-free` suffix; anything unpriced and unmarked lands in
 * "plan" rather than "paid" so an unknown price never claims money is being spent.
 *
 * A priced row is "paid", not "plan": on this subscription the plan does not buy a
 * ballpark of cheap models, it buys the free lane or an account key. Anything with
 * a non-zero price is therefore money, and calling it "plan" would understate what
 * picking it costs.
 */
export function tierOf(id, cost) {
  if (cost?.input === 0 && cost?.output === 0) return 'free'
  if (looksFree(id)) return 'free'
  if (cost?.input === undefined && cost?.output === undefined) return tierFromPrice({})
  return 'paid'
}

/** Turn one `/v1/models` row into the store's model record. */
export function toModelEntry(row, { source = 'live' } = {}) {
  const id = row.id
  const override = MODEL_OVERRIDES[id] ?? {}
  const context =
    override.contextWindow ??
    positiveInt(row.limit?.context) ??
    positiveInt(row.context_length) ??
    131_072
  const maxTokens = positiveInt(row.limit?.output) ?? Math.min(context, 32_768)
  const declared = Array.isArray(row.modalities?.input)
    ? row.modalities.input.filter((value) => typeof value === 'string')
    : Array.isArray(row.architecture?.input_modalities)
      ? row.architecture.input_modalities.filter((value) => typeof value === 'string')
      : undefined
  const inputModalities =
    declared !== undefined && declared.length > 0 ? declared : VISION_FALLBACK.test(id) ? ['text', 'image'] : ['text']
  const efforts = Array.isArray(row.reasoning_options?._dummy)
    ? undefined
    : Array.isArray(row.reasoning_options)
      ? row.reasoning_options.filter((value) => typeof value === 'string')
      : undefined
  const cost =
    row.cost !== undefined && typeof row.cost === 'object'
      ? { input: Number(row.cost.input), output: Number(row.cost.output) }
      : undefined
  return {
    id,
    name: typeof row.name === 'string' && row.name.length > 0 ? row.name : id,
    contextWindow: context,
    maxTokens,
    inputModalities,
    tier: tierOf(id, cost),
    ...(Number.isFinite(cost?.input) ? { inputPrice: cost.input } : {}),
    ...(Number.isFinite(cost?.output) ? { outputPrice: cost.output } : {}),
    ...(efforts === undefined ? {} : { reasoningEfforts: efforts }),
    ...(row.deprecated === true || row.status === 'deprecated' ? { note: 'deprecated' } : {}),
    ...(isResponsesModel(id) ? { note: 'responses-api' } : {}),
    source,
  }
}

/** Decode a `/v1/models` body (or a bare array) into model records. */
export function decodeModels(body, options = {}) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  const seen = new Set()
  const models = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const id = typeof row.id === 'string' ? row.id : undefined
    if (id === undefined || !isOfferableModel(id) || seen.has(id)) continue
    seen.add(id)
    models.push(toModelEntry({ ...row, id }, options))
  }
  models.sort((left, right) => left.id.localeCompare(right.id))
  return models
}

/** The last-resort list, used only when both the live catalog and the cache fail. */
export function staticModels() {
  return STATIC_FREE_MODELS.map((id) =>
    toModelEntry({ id, name: id, cost: { input: 0, output: 0 } }, { source: 'static' }),
  )
}

/** models.dev is where the Zen cost, context and modality metadata actually lives. */
export const MODELS_DEV_URL = 'https://models.dev/api.json'

/**
 * Pull the Zen section out of a models.dev document.
 *
 * models.dev keys providers by slug and there is more than one opencode entry
 * (`opencode`, `opencode-go`). The plain `opencode` slug is the one whose model ids
 * match `/zen/v1/models`; the go variant is a different product, so preferring it
 * would attach the wrong prices.
 */
export function decodeModelsDev(data) {
  if (data === null || typeof data !== 'object') return {}
  const providers = Object.entries(data).filter(([key]) => key === 'opencode' || key.includes('opencode'))
  // Exact slug first, then any opencode-branded section, so a renamed slug still works.
  providers.sort((left, right) => {
    const rank = ([key]) => (key === 'opencode' ? 0 : 1)
    return rank(left) - rank(right)
  })
  const chosen = providers.find(([, value]) => value !== null && typeof value?.models === 'object')
  if (chosen === undefined) return {}
  const out = {}
  for (const [id, model] of Object.entries(chosen[1].models)) {
    if (model === null || typeof model !== 'object') continue
    const input = Number(model.cost?.input)
    const output = Number(model.cost?.output)
    out[id] = {
      name: typeof model.name === 'string' ? model.name : undefined,
      cost: Number.isFinite(input) && Number.isFinite(output) ? { input, output } : undefined,
      context: positiveInt(model.limit?.context),
      outputLimit: positiveInt(model.limit?.output),
      inputModalities: Array.isArray(model.modalities?.input)
        ? model.modalities.input.filter((value) => typeof value === 'string')
        : undefined,
      deprecated: model.deprecated === true || model.status === 'deprecated',
    }
  }
  return out
}

/** Attach models.dev metadata to the live rows. Rows with no entry are left alone. */
export function withModelsDev(models, metadata) {
  if (metadata === undefined || Object.keys(metadata).length === 0) return models
  return models.map((model) => {
    const extra = metadata[model.id]
    if (extra === undefined) return model
    // models.dev wins on price and modality because /v1/models publishes neither;
    // a local override still wins on context (upstream learned it separately).
    const override = MODEL_OVERRIDES[model.id]
    return {
      ...model,
      name: model.name === model.id && extra.name !== undefined ? extra.name : model.name,
      tier: tierOf(model.id, extra.cost),
      ...(extra.cost === undefined ? {} : { inputPrice: extra.cost.input, outputPrice: extra.cost.output }),
      ...(override === undefined && extra.context !== undefined ? { contextWindow: extra.context } : {}),
      ...(extra.outputLimit === undefined ? {} : { maxTokens: extra.outputLimit }),
      ...(extra.inputModalities !== undefined && extra.inputModalities.length > 0
        ? { inputModalities: extra.inputModalities }
        : {}),
      ...(extra.deprecated ? { note: 'deprecated' } : {}),
    }
  })
}

/**
 * Fetch the live catalog, then enrich it with models.dev metadata.
 *
 * The catalog request is the one that must succeed; models.dev is best effort, so a
 * metadata outage degrades to name-based free detection instead of emptying the
 * picker.
 */
export async function fetchModels({ baseUrl = ZEN_BASE_URL, apiKey = ANONYMOUS_KEY, timeoutMs = 30_000, signal } = {}) {
  const models = await fetchCatalog({ baseUrl, apiKey, timeoutMs, signal })
  let metadata
  try {
    metadata = await fetchModelsDev({ timeoutMs, signal })
  } catch {
    metadata = undefined
  }
  return withModelsDev(models, metadata)
}

/**
 * The catalog URL for a base the caller supplies.
 *
 * The default base is the host itself (`https://opencode.ai/zen`), so the path is
 * `/v1/models`. A caller that already passes the OpenAI-compatible root
 * (`.../zen/v1`, which is what the provider options carry) must not have a second
 * `/v1` bolted on — that produced `/v1/v1/models` and a 404.
 */
function catalogUrl(baseUrl) {
  const trimmed = String(baseUrl).replace(/\/+$/, '')
  return `${trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`}/models`
}

/** The catalog request alone. The endpoint answers without a bearer. */
export async function fetchCatalog({ baseUrl = ZEN_BASE_URL, apiKey = ANONYMOUS_KEY, timeoutMs = 30_000, signal } = {}) {
  const url = catalogUrl(baseUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('catalog request timed out')), timeoutMs)
  timer.unref?.()
  const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        // The public catalog tolerates any client identity; sending the CLI ones
        // keeps this request shaped like the client upstream validates.
        'user-agent': opencodeUserAgent(),
        'x-opencode-client': 'cli',
      },
      signal: combined,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GET ${url} answered HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
    return decodeModels(await response.json(), { source: 'live' })
  } finally {
    clearTimeout(timer)
  }
}

/** models.dev metadata, decoded to the shape `withModelsDev` expects. */
export async function fetchModelsDev({ timeoutMs = 30_000, signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('models.dev request timed out')), timeoutMs)
  timer.unref?.()
  const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  try {
    const response = await fetch(MODELS_DEV_URL, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': opencodeUserAgent() },
      signal: combined,
    })
    if (!response.ok) throw new Error(`GET ${MODELS_DEV_URL} answered HTTP ${response.status}`)
    return decodeModelsDev(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

/** The client identity upstream sends; the version is part of the disguise. */
export function opencodeUserAgent() {
  return `opencode/1.18.31 (${process.platform} ${process.arch}; node${process.versions.node})`
}
