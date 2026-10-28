/**
 * Shared per-model connection probe.
 *
 * The probe answers one question 鈥?"would a real turn on this model work right
 * now?" 鈥?and it answers it the cheap-but-honest way: a one-token completion
 * through the same endpoint the adapter uses, with the same headers. A green
 * light therefore means "the host just talked to this model successfully", not
 * "the model appears in the catalog".
 *
 * Failure codes are normalised to a small closed set so the UI can colour them
 * without string-matching upstream prose.
 */


export const PROBE_CODES = Object.freeze({
  OK: 'OK',
  AUTH: 'AUTH',
  QUOTA: 'QUOTA',
  RATE_LIMIT: 'RATE_LIMIT',
  NOT_FOUND: 'NOT_FOUND',
  INVALID: 'INVALID',
  SERVER: 'SERVER',
  TIMEOUT: 'TIMEOUT',
  TRANSPORT: 'TRANSPORT',
  DISABLED: 'DISABLED',
})

/** HTTP status 鈫?probe code, in priority order. */
export function codeFromStatus(status) {
  if (status === 401 || status === 403) return PROBE_CODES.AUTH
  if (status === 402) return PROBE_CODES.QUOTA
  if (status === 404) return PROBE_CODES.NOT_FOUND
  if (status === 429) return PROBE_CODES.RATE_LIMIT
  if (status === 408 || status === 504) return PROBE_CODES.TIMEOUT
  if (status >= 500) return PROBE_CODES.SERVER
  if (status >= 400) return PROBE_CODES.INVALID
  return PROBE_CODES.TRANSPORT
}

/** Body text 鈫?probe code, for upstreams that answer 200 with an error envelope. */
export function codeFromBody(text) {
  const haystack = String(text ?? '').slice(0, 2000).toLowerCase()
  if (/quota|insufficient|credit|billing|payment required/.test(haystack)) return PROBE_CODES.QUOTA
  if (/rate.?limit|too many requests|slow down/.test(haystack)) return PROBE_CODES.RATE_LIMIT
  if (/unauthor|forbidden|invalid.?api.?.?key|authentication/.test(haystack)) return PROBE_CODES.AUTH
  if (/model not found|no such model|unknown model|not available/.test(haystack)) return PROBE_CODES.NOT_FOUND
  if (/not available in your country|regionerror/.test(haystack)) return PROBE_CODES.AUTH
  // A lane that refuses the *request shape* is not an auth problem — calling it
  // AUTH sent a previous investigation hunting for a missing key when the real
  // cause was `stream: false`. Gated lanes answer this for an ungated request.
  if (/free tier can only be used from within|freetiererror/i.test(haystack)) return PROBE_CODES.INVALID
  return PROBE_CODES.INVALID
}

/**
 * Is this one of the harness's own errors?
 *
 * Duck-typed rather than `instanceof LlmError`: importing `@deepseek-ai/dsh-llm`
 * statically would bind this file to the host's package resolution, which keeps the
 * module impossible to load — and therefore to test — outside a running host. An
 * LlmError always carries a string `code`, which is the part this function needs.
 */
function isLlmError(error) {
  return error instanceof Error && typeof error.code === 'string'
}

/** Collapse an arbitrary error into `{ code, detail }`. */
export function describeProbeError(error) {
  if (isLlmError(error)) {
    const code = normaliseCode(error.code) ?? (error.cause === undefined ? PROBE_CODES.SERVER : describeProbeError(error.cause).code)
    return { code, detail: error.message }
  }
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return { code: PROBE_CODES.TIMEOUT, detail: 'the request did not finish in time' }
  }
  if (error?.cause?.code === 'ENOTFOUND' || error?.cause?.code === 'ECONNREFUSED') {
    return { code: PROBE_CODES.TRANSPORT, detail: error.cause.code }
  }
  const message = error instanceof Error ? error.message : String(error)
  // undici wraps transport problems in a bare TypeError.
  if (error instanceof TypeError && /fetch failed/i.test(message)) {
    return { code: PROBE_CODES.TRANSPORT, detail: error.cause?.message ?? message }
  }
  return { code: PROBE_CODES.SERVER, detail: message.slice(0, 300) }
}

function normaliseCode(code) {
  switch (code) {
    case 'MISSING_CREDENTIAL':
    case 'UNAUTHORIZED':
      return PROBE_CODES.AUTH
    case 'QUOTA_EXCEEDED':
      return PROBE_CODES.QUOTA
    case 'RATE_LIMIT':
      return PROBE_CODES.RATE_LIMIT
    case 'UNKNOWN_MODEL':
      return PROBE_CODES.NOT_FOUND
    case 'TIMEOUT':
      return PROBE_CODES.TIMEOUT
    case 'TRANSPORT':
      return PROBE_CODES.TRANSPORT
    case 'ABORTED':
      return PROBE_CODES.TIMEOUT
    default:
      return undefined
  }
}

/**
 * Probe one model by making the smallest possible real request.
 *
 * @param {object} options
 * @param {string} options.endpoint   absolute URL of an OpenAI-compatible chat endpoint
 * @param {string} options.model      upstream model id
 * @param {() => Promise<Record<string, string>>} options.headers
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ state: 'ok'|'fail', code: string, detail: string, at: number, latencyMs: number }>}
 */
export async function probeModel({ endpoint, model, headers, tools, body, timeoutMs = 20_000, signal }) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('probe timeout')), timeoutMs)
  timeout.unref?.()
  const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  const finish = (state, code, detail) => ({
    state,
    code,
    detail: String(detail ?? '').slice(0, 300),
    at: Date.now(),
    latencyMs: Date.now() - startedAt,
  })
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(await headers()) },
      // `max_tokens: 1` keeps the probe cheap; `stream: false` keeps it a single
      // readable JSON body instead of an SSE stream the caller has to drain.
      // `body` is the caller's last word: a provider whose lane refuses a request
      // shape (a tool gate, a reasoning floor) supplies its own extras here, and
      // `tools`, when given, is folded in rather than dropped.
      body: JSON.stringify({
        model,
        max_tokens: 1,
        stream: false,
        ...(tools === undefined ? {} : { tools }),
        messages: [{ role: 'user', content: 'ping' }],
        ...(body ?? {}),
      }),
      signal: combined,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      // The status alone cannot tell a free-tier lane refusal from a bad key, so
      // the body gets the first say whenever it names a known condition.
      const byBody = codeFromBody(text)
      const code = byBody === PROBE_CODES.INVALID ? codeFromStatus(response.status) : byBody
      return finish('fail', code, `HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
    const text = await response.text()
    let parsed
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      return finish('fail', PROBE_CODES.INVALID, `upstream did not answer with JSON: ${text.slice(0, 200)}`)
    }
    // A 200 carrying an error envelope is still a failure 鈥?several gateways do this.
    if (parsed?.error !== undefined && parsed.error !== null) {
      const detail = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message ?? JSON.stringify(parsed.error))
      return finish('fail', codeFromBody(detail), detail)
    }
    if (!Array.isArray(parsed?.choices)) {
      return finish('fail', PROBE_CODES.INVALID, `unexpected response shape: ${text.slice(0, 200)}`)
    }
    return finish('ok', PROBE_CODES.OK, 'answered')
  } catch (error) {
    const { code, detail } = describeProbeError(error)
    return finish('fail', code, detail)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Run `task` over `items` with bounded concurrency, preserving input order.
 * A plain hand-rolled pool rather than a dependency: three subscriptions each
 * needing it does not justify a package.
 */
export async function pool(items, concurrency, task) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
