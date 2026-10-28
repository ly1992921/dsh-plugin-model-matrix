/**
 * Nous Research Portal catalog.
 *
 * The Portal inference API is OpenAI-compatible and serves an OpenRouter-shaped
 * `/v1/models` object unauthenticated. Live probing (428 rows) found three id
 * shapes that matter here:
 *
 *   vendor/model          the standard paid route
 *   vendor/model:free     a genuinely $0 lane 鈥?8 models, all tool-capable
 *   vendor/model:batch    an asynchronous half-price batch lane, not a chat route
 *   ~vendor/model-latest  a rolling alias that pins to the newest release
 *
 * `:free` and the paid id share one `canonical_slug` but are different routes at
 * different prices, so they must stay separate rows: a `vendor/model:free` entry
 * is what "the free models" means on this subscription, and dropping it in favour
 * of the paid twin would silently remove the thing the user asked for.
 *
 * What a Portal account can use still depends on its plan (Free $0 / Plus $20 /
 * Super $100 / Ultra $200), and the free plan is documented as "free models only,
 * standard rate limits, $0 monthly credits". So models are bucketed three ways:
 *
 *   free  鈥?zero-priced rows, plus the documented free-plan families.
 *   plan  鈥?everything a paid plan unlocks: priced models at or below the
 *           configured per-million-token cutoff.
 *   paid  鈥?premium rows above that cutoff.
 *
 * The cutoffs are settings, not constants, and the settings page can re-bucket
 * any single model with its own tier override 鈥?because "which models my plan
 * covers" is account knowledge the plugin cannot read from the API.
 */

import { priceOf, positiveInt, tierFromPrice } from './store.js'

export const PROVIDER = 'nous-portal'
export const DEFAULT_BASE_URL = 'https://inference-api.nousresearch.com/v1'
export const DEFAULT_API_KEY_ENV = 'NOUS_PORTAL_API_KEY'
export const DEFAULT_MODELS_CACHE = 'nous-portal'

/** Families the Portal documents as reachable on the free plan even though they are priced. */
const FREE_PLAN_FAMILIES = [/hermes-?4/i, /hermes-?3/i]

/**
 * A row the picker should never offer: the `:batch` half-price lanes are
 * asynchronous batch endpoints, not interactive chat models, and a bare vendor
 * alias resolves to the same weights as its dated twin.
 */
export function isOfferableModel(id) {
  if (typeof id !== 'string' || id.length === 0) return false
  if (id.includes(':batch')) return false
  return true
}

/**
 * Bucket one catalog row.
 *
 * `freeCutoff` / `planCutoff` are USD per 1M tokens (the same unit the Portal
 * publishes as a per-token string scaled by 1e6).
 */
export function tierOf(row, { freeCutoff = 0, planCutoff = 5 } = {}) {
  const price = priceOf(row)
  const inputPer1M = price.inputPrice === undefined ? undefined : price.inputPrice * 1_000_000
  const outputPer1M = price.outputPrice === undefined ? undefined : price.outputPrice * 1_000_000
  if (inputPer1M === 0 && outputPer1M === 0) return 'free'
  const family = String(row?.id ?? '') + ' ' + String(row?.name ?? '')
  if (FREE_PLAN_FAMILIES.some((pattern) => pattern.test(family))) return 'free'
  const worst = Math.max(inputPer1M ?? Number.POSITIVE_INFINITY, outputPer1M ?? Number.POSITIVE_INFINITY)
  if (!Number.isFinite(worst)) return tierFromPrice(price)
  if (worst <= freeCutoff) return 'free'
  if (worst <= planCutoff) return 'plan'
  return 'paid'
}

/** Turn one upstream row into the store's model record. */
export function toModelEntry(row, tierOptions) {
  const price = priceOf(row)
  const inputModalities = Array.isArray(row?.architecture?.input_modalities)
    ? row.architecture.input_modalities.filter((value) => typeof value === 'string')
    : ['text']
  const context =
    positiveInt(row?.context_length) ??
    positiveInt(row?.top_provider?.context_length) ??
    131_072
  const maxTokens =
    positiveInt(row?.top_provider?.max_completion_tokens) ??
    Math.min(context, 32_768)
  const efforts = Array.isArray(row?.reasoning?.supported_efforts)
    ? row.reasoning.supported_efforts.filter((value) => typeof value === 'string')
    : undefined
  return {
    id: row.id,
    name: typeof row.name === 'string' && row.name.length > 0 ? row.name : row.id,
    contextWindow: context,
    maxTokens,
    inputModalities,
    tier: tierOf(row, tierOptions),
    ...(price.inputPrice === undefined ? {} : { inputPrice: price.inputPrice }),
    ...(price.outputPrice === undefined ? {} : { outputPrice: price.outputPrice }),
    ...(efforts === undefined ? {} : { reasoningEfforts: efforts }),
    // Nous documents the Hermes chat weights as unsuitable for agent tool loops;
    // the flag lets the settings page warn instead of silently under-performing.
    ...(FREE_PLAN_FAMILIES.some((pattern) => pattern.test(row.id)) ? { note: 'chat-model' } : {}),
  }
}

/** Decode a `/v1/models` body into model records. */
export function decodeModels(body, tierOptions) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  const seen = new Set()
  const models = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const id = typeof row.id === 'string' ? row.id : undefined
    if (id === undefined || !isOfferableModel(id) || seen.has(id)) continue
    seen.add(id)
    models.push(toModelEntry({ ...row, id }, tierOptions))
  }
  models.sort((left, right) => left.id.localeCompare(right.id))
  return models
}

/**
 * Fetch the live catalog. Returns `{ models }` or throws; callers keep the
 * previously known list when this fails, the same stale-while-error posture the
 * rest of the tooling uses.
 */
export async function fetchModels({ baseUrl = DEFAULT_BASE_URL, apiKey, timeoutMs = 30_000, signal, tierOptions } = {}) {
  const url = `${trimSlash(baseUrl)}/models`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('catalog request timed out')), timeoutMs)
  timeout.unref?.()
  const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        // The catalog answers without a bearer, but sending one when available
        // makes the response reflect the account's own entitlements.
        ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      signal: combined,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GET ${url} answered HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
    return decodeModels(await response.json(), tierOptions)
  } finally {
    clearTimeout(timeout)
  }
}

/** Strip a trailing slash so `${base}/models` never doubles it. */
export function trimSlash(value) {
  return String(value ?? '').replace(/\/+$/, '')
}
