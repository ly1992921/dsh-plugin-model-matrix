/**
 * Shared per-subscription model store + management.
 *
 * One JSON document per subscription, kept under the DSH home so the browser
 * half and the host half agree without a typed Remote binding:
 *
 *   {
 *     version: 1,
 *     models:   [{ id, name, contextWindow, maxTokens, inputModalities, tier, inputPrice, outputPrice, deprecated }],
 *     overrides: { "<model-id>": { visibility: 'show' | 'hide', tier?: 'free'|'plan'|'paid' } },
 *     status:    { "<model-id>": { state: 'unknown'|'ok'|'fail', code, detail, at, latencyMs } },
 *     offeredTiers: ['free'|'plan'|'paid', ...],
 *     updatedAt, source, warning
 *   }
 *
 * `visibility` is `show`/`hide` with `inherit` meaning "follow the tier filter";
 * storing `inherit` explicitly would make the whole map grow for no reason, so a
 * cleared override is deleted instead.
 *
 * Everything here is deliberately dependency-free (node:fs / node:path only) so
 * the same file can be vendored unchanged into several bundles.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const STORE_VERSION = 1

/** Tiers a model can be bucketed into. */
export const TIERS = ['free', 'plan', 'paid']

/**
 * Tiers the dialog picker should offer. Missing or empty means all three, so an
 * old store file does not suddenly hide every paid model.
 */
export function offeredTiersOf(document) {
  const raw = Array.isArray(document?.offeredTiers) ? document.offeredTiers : TIERS
  const tiers = TIERS.filter((tier) => raw.includes(tier))
  return tiers.length > 0 ? tiers : [...TIERS]
}

/** Tunables shared by every bundle that vendors this file. */
export const DEFAULTS = {
  /** How often the host re-reads the upstream catalog. */
  refreshSeconds: 900,
  /** How often the browser re-reads the store while the settings page is open. */
  pollSeconds: 60,
  /**
   * Per-model probe timeout.
   *
   * Measured against the live lanes: a healthy free lane answers in 0.6–2.5s, but
   * `nemotron-3.5-super-vl-free` intermittently takes longer than 20s and then
   * answers normally on the next try. A light that goes red on a cold queue and
   * green a second later teaches the user to distrust the lights, so the ceiling
   * sits well above the observed tail.
   */
  probeTimeoutMs: 45_000,
  /** Concurrent probes when the user hits "test all". */
  probeConcurrency: 3,
}

/**
 * Extract the prompt/completion price of one upstream catalog row, tolerating
 * the three shapes seen in the wild:
 *   - OpenRouter / Nous Portal:  pricing.prompt / pricing.completion (strings)
 *   - models.dev / OpenCode Zen: cost.input / cost.output (numbers)
 */
export function priceOf(row) {
  const pricing = row?.pricing ?? row?.cost ?? {}
  const input = pricing.prompt ?? pricing.input ?? pricing['input_price']
  const output = pricing.completion ?? pricing.output ?? pricing['output_price']
  return {
    inputPrice: finiteOrUndefined(Number(input)),
    outputPrice: finiteOrUndefined(Number(output)),
  }
}

function finiteOrUndefined(value) {
  return Number.isFinite(value) ? value : undefined
}

/**
 * First tier guess from price alone. Callers layer their own rules on top —
 * "free" is a policy question, not just a price question, and each subscription
 * answers it differently (see each bundle's catalog module).
 *
 * `planCutoff` is the per-million-token price under which a priced row counts as
 * "plan" rather than "paid". The default of Infinity keeps the historical
 * behaviour for the bundles that draw their own line; a bundle that prices in
 * (Command Code, whose plan tiers are all expensive) passes a real cutoff.
 */
export function tierFromPrice({ inputPrice, outputPrice, planCutoff = Number.POSITIVE_INFINITY }) {
  if (inputPrice === undefined && outputPrice === undefined) return 'plan'
  if (inputPrice === 0 && outputPrice === 0) return 'free'
  if (inputPrice === 0 || outputPrice === 0) return 'plan'
  const reference = Math.max(Number(inputPrice), Number(outputPrice))
  return Number.isFinite(reference) && reference <= planCutoff ? 'plan' : 'paid'
}

/** A context window / max-token figure that is absent or absurd reads as undefined. */
export function positiveInt(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.floor(numeric)
}

/** Model ids whose picker entry should be dropped outright (batch lanes, aliases). */
export function isHiddenVariant(id) {
  return typeof id === 'string' && (id.includes(':') || id.endsWith('-latest'))
}

/**
 * The persistence layer. One instance per subscription; construction is cheap and
 * every write is atomic (tmp file + rename) so a half-written document can never
 * be read back by the other half of the plugin.
 */
export class ModelStore {
  /**
   * @param {object} options
   * @param {string} options.path       absolute JSON path
   * @param {(message: string) => void} [options.warn]
   */
  constructor({ path, warn }) {
    this.path = path
    this.warn = warn ?? (() => {})
    /** @type {null | object} */
    this.state = null
    this.#writing = Promise.resolve()
  }

  /** @type {Promise<void>} */
  #writing

  /** True when no read has produced a document yet. */
  get loaded() {
    return this.state !== null
  }

  #empty(warning) {
    return {
      version: STORE_VERSION,
      models: [],
      overrides: {},
      status: {},
      updatedAt: null,
      source: 'empty',
      ...(warning === undefined ? {} : { warning }),
    }
  }

  /** Read the document from disk, falling back to an empty one. Never throws. */
  async load() {
    let text
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.warn(`could not read ${this.path}: ${error?.message ?? error}`)
        this.state = this.#empty(`Could not read ${this.path}: ${error?.message ?? error}`)
      } else {
        this.state = this.#empty()
      }
      return this.state
    }
    try {
      this.state = normalise(JSON.parse(text))
    } catch (error) {
      this.warn(`ignoring malformed store at ${this.path}: ${error?.message ?? error}`)
      this.state = this.#empty(`The catalog file at ${this.path} was malformed and has been reset.`)
    }
    return this.state
  }

  /** The in-memory document, loading it first when necessary. */
  async read() {
    return this.state ?? (await this.load())
  }

  /** Apply a mutation to the document and persist it. Serialised. */
  async update(mutate) {
    const current = await this.read()
    const draft = structuredClone(current)
    const result = mutate(draft)
    this.state = normalise(draft)
    this.#writing = this.#writing.then(
      () => this.#persist(this.state),
      () => this.#persist(this.state),
    )
    await this.#writing
    return result === undefined ? this.state : result
  }

  /** Replace the discovered model list, preserving overrides and status. */
  async replaceModels(models, { source, warning } = {}) {
    return this.update((draft) => {
      draft.models = models
      draft.updatedAt = Date.now()
      draft.source = source ?? 'live'
      if (warning === undefined) delete draft.warning
      else draft.warning = warning
    })
  }

  /** Record the red/green result of one connection test. */
  async setStatus(modelId, status) {
    return this.update((draft) => {
      draft.status[modelId] = status
    })
  }

  /** Record many connection-test results in one write. */
  async setStatuses(entries) {
    return this.update((draft) => {
      for (const [modelId, status] of entries) draft.status[modelId] = status
    })
  }

  async #persist(document) {
    const temporary = `${this.path}.${process.pid}.tmp`
    try {
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.path)
    } catch (error) {
      this.warn(`could not write ${this.path}: ${error?.message ?? error}`)
      await rm(temporary, { force: true }).catch(() => {})
    }
  }
}

/** Coerce whatever was on disk into the current shape. */
function normalise(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  const overrides = {}
  for (const [id, entry] of Object.entries(source.overrides ?? {})) {
    if (entry === null || typeof entry !== 'object') continue
    const visibility = entry.visibility === 'show' || entry.visibility === 'hide' ? entry.visibility : undefined
    const tier = TIERS.includes(entry.tier) ? entry.tier : undefined
    if (visibility === undefined && tier === undefined) continue
    overrides[id] = { ...(visibility === undefined ? {} : { visibility }), ...(tier === undefined ? {} : { tier }) }
  }
  const status = {}
  for (const [id, entry] of Object.entries(source.status ?? {})) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.state !== 'ok' && entry.state !== 'fail' && entry.state !== 'unknown') continue
    status[id] = {
      state: entry.state,
      ...(typeof entry.code === 'string' ? { code: entry.code } : {}),
      ...(typeof entry.detail === 'string' ? { detail: entry.detail.slice(0, 500) } : {}),
      ...(Number.isFinite(entry.at) ? { at: entry.at } : {}),
      ...(Number.isFinite(entry.latencyMs) ? { latencyMs: entry.latencyMs } : {}),
    }
  }
  return {
    version: STORE_VERSION,
    models: Array.isArray(source.models) ? source.models.filter(isModelEntry) : [],
    overrides,
    status,
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : null,
    source: typeof source.source === 'string' ? source.source : 'empty',
    offeredTiers: offeredTiersOf(source),
    ...(typeof source.warning === 'string' ? { warning: source.warning } : {}),
  }
}

function isModelEntry(entry) {
  return entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.length > 0
}

/**
 * The browser-facing projection of the store: every model with its resolved
 * visibility so the client never re-derives policy. Only `visible` models are
 * offered to the model picker by the host; the settings page shows all of them
 * with their toggle state.
 */
export function projectStore(document, options = {}) {
  const tiers = options.tiers ?? offeredTiersOf(document)
  const models = (document.models ?? []).map((model) => {
    const override = document.overrides?.[model.id] ?? {}
    const tier = TIERS.includes(override.tier) ? override.tier : (model.tier ?? 'plan')
    const visibility = override.visibility === 'show' || override.visibility === 'hide' ? override.visibility : 'inherit'
    return {
      ...model,
      tier,
      visibility,
      visible: visibility === 'show' ? true : visibility === 'hide' ? false : tiers.includes(tier),
      status: document.status?.[model.id] ?? { state: 'unknown' },
    }
  })
  return {
    version: document.version ?? STORE_VERSION,
    offeredTiers: tiers,
    models,
    updatedAt: document.updatedAt ?? null,
    source: document.source ?? 'empty',
    ...(document.warning === undefined ? {} : { warning: document.warning }),
    counts: {
      total: models.length,
      free: models.filter((model) => model.tier === 'free').length,
      plan: models.filter((model) => model.tier === 'plan').length,
      paid: models.filter((model) => model.tier === 'paid').length,
      visible: models.filter((model) => model.visible).length,
      ok: models.filter((model) => model.status.state === 'ok').length,
      fail: models.filter((model) => model.status.state === 'fail').length,
    },
  }
}

/** Ids the model picker should offer. */
export function visibleModelIds(document, options) {
  return projectStore(document, options)
    .models.filter((model) => model.visible)
    .map((model) => model.id)
}

/**
 * Which next route name the picker should switch to when the user hides the
 * model currently in use (falling back to the first visible one).
 */
export function fallbackModelId(document, options) {
  const visible = visibleModelIds(document, options)
  return visible[0]
}

export const storePathFor = (home, subscription) => join(home, subscription, `${subscription}-models.json`)

export { join }
