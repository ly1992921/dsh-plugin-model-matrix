/**
 * Shared settings page for a subscription's model list.
 *
 * Vendored into each bundle unchanged; the bundle passes the strings, the API
 * prefix and the subscription's identity. The page is deliberately one
 * component rather than a set of slots so the tier filter, the per-model
 * toggles, the refresh control and the connection lights always agree on one
 * copy of the store.
 *
 * Interaction model:
 *   - Tier filter (Free / Plan / Paid) is a client-side view filter. It is what
 *     the picker inherits *through* the host: the host computes `visible` from
 *     each model's own override, so a model with an explicit Show/Hide keeps it.
 *   - Each row has a Show/Hide toggle and a tier selector. Both are optimistic:
 *     the row flips immediately and the response reconciles it.
 *   - The traffic light is `unknown` / `ok` / `fail`. Testing is manual (per row
 *     or "test all") — an automatic probe on selection is a host concern, so the
 *     page exposes the result the host records.
 *
 * `window.__ModuleLoader__` is not used here: the bundle's client.js wires this
 * module into the loader and hands it `React`.
 */

export function createSettingsPage({ React, api, strings, refreshPicker }) {
  const { createElement: h, Fragment, useCallback, useEffect, useMemo, useRef, useState } = React

  const T = (key) => strings[key] ?? key

  const TIER_LABELS = {
    free: T('tierFree'),
    plan: T('tierPlan'),
    paid: T('tierPaid'),
  }
  const TIER_ORDER = ['free', 'plan', 'paid']

  /** A colour + label for one probe status. */
  function lightOf(status) {
    const state = status?.state ?? 'unknown'
    if (state === 'ok') return { tone: 'ok', title: T('probeOk') }
    if (state === 'fail') return { tone: 'fail', title: `${T('probeFail')}${status?.code === undefined ? '' : ` (${status.code})`}` }
    return { tone: 'idle', title: T('probeUnknown') }
  }

  function formatTime(value) {
    if (value === null || value === undefined) return T('never')
    try {
      return new Date(value).toLocaleString()
    } catch {
      return String(value)
    }
  }

  function formatPrice(model) {
    if (model.inputPrice === undefined && model.outputPrice === undefined) return T('priceUnknown')
    const scale = (value) => (value === undefined ? '—' : `$${(value * 1_000_000).toFixed(2)}`)
    return `${scale(model.inputPrice)} / ${scale(model.outputPrice)}`
  }

  function formatContext(model) {
    const tokens = model.contextWindow
    if (!Number.isFinite(tokens)) return '—'
    return tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens)
  }

  return function SettingsPage() {
    const [store, setStore] = useState(null)
    const [error, setError] = useState(undefined)
    const [busy, setBusy] = useState(undefined)
    const [query, setQuery] = useState('')
    const [tierFilter, setTierFilter] = useState(() => new Set(TIER_ORDER))
    const [testingAll, setTestingAll] = useState(false)
    const mounted = useRef(true)

    const apply = useCallback((payload) => {
      if (!mounted.current) return
      if (payload?.store !== undefined) {
        setStore(payload.store)
        if (Array.isArray(payload.store.offeredTiers) && payload.store.offeredTiers.length > 0) {
          setTierFilter(new Set(payload.store.offeredTiers))
        }
      }
      if (payload?.warning !== undefined) setError(payload.warning)
    }, [])

    const load = useCallback(async () => {
      try {
        apply(await api('/state'))
        setError(undefined)
      } catch (problem) {
        if (mounted.current) setError(problem.message)
      }
    }, [apply])

    useEffect(() => {
      mounted.current = true
      void load()
      return () => {
        mounted.current = false
      }
    }, [load])

    const refresh = useCallback(async () => {
      setBusy('refresh')
      try {
        apply(await api('/refresh', { method: 'POST', body: {}, timeout: 30_000 }))
      } catch (problem) {
        setError(problem.message)
      } finally {
        if (mounted.current) setBusy(undefined)
      }
    }, [apply])

    const setOverride = useCallback(
      async (modelId, patch) => {
        // Optimistic: flip the row now so the toggle never lags behind the click.
        setStore((current) => {
          if (current === null) return current
          return {
            ...current,
            models: current.models.map((model) => {
              if (model.id !== modelId) return model
              const next = { ...model, ...patch }
              const visible =
                next.visibility === 'show' ? true : next.visibility === 'hide' ? false : tierFilter.has(next.tier)
              return { ...next, visible }
            }),
          }
        })
        try {
          apply(await api('/override', { method: 'POST', body: { model: modelId, ...patch } }))
          refreshPicker?.()
        } catch (problem) {
          setError(problem.message)
          void load()
        }
      },
      [apply, load, tierFilter],
    )

    const probe = useCallback(
      async (modelId) => {
        setBusy(`probe:${modelId}`)
        setStore((current) =>
          current === null
            ? current
            : {
                ...current,
                models: current.models.map((model) =>
                  model.id === modelId ? { ...model, status: { ...model.status, pending: true } } : model,
                ),
              },
        )
        try {
          apply(await api('/probe', { method: 'POST', body: { model: modelId }, timeout: 30_000 }))
        } catch (problem) {
          setError(problem.message)
        } finally {
          if (mounted.current) setBusy(undefined)
        }
      },
      [apply],
    )

    const probeAll = useCallback(async () => {
      setTestingAll(true)
      try {
        apply(await api('/probeall', { method: 'POST', body: {}, timeout: 240_000 }))
      } catch (problem) {
        setError(problem.message)
      } finally {
        if (mounted.current) setTestingAll(false)
      }
    }, [apply])

    const toggleTier = useCallback(
      async (tier) => {
        const next = new Set(tierFilter)
        if (next.has(tier)) next.delete(tier)
        else next.add(tier)
        // Never let the filter empty itself: the page would read as "no models".
        const tiers = next.size === 0 ? [...TIER_ORDER] : TIER_ORDER.filter((item) => next.has(item))
        setTierFilter(new Set(tiers))
        try {
          apply(await api('/tiers', { method: 'POST', body: { tiers } }))
          refreshPicker?.()
        } catch (problem) {
          setError(problem.message)
          void load()
        }
      },
      [apply, load, tierFilter],
    )

    const models = store?.models ?? []
    const shown = useMemo(() => {
      const needle = query.trim().toLowerCase()
      return models.filter((model) => {
        if (!tierFilter.has(model.tier)) return false
        if (needle === '') return true
        return model.id.toLowerCase().includes(needle) || String(model.name).toLowerCase().includes(needle)
      })
    }, [models, query, tierFilter])

    const grouped = useMemo(() => {
      const groups = new Map(TIER_ORDER.map((tier) => [tier, []]))
      for (const model of shown) groups.get(model.tier)?.push(model)
      return groups
    }, [shown])

    const counts = store?.counts

    return h(
      'div',
      { className: 'np-page' },
      h(
        'header',
        { className: 'np-head' },
        h('h2', { className: 'np-title' }, T('title')),
        h('p', { className: 'np-sub' }, T('subtitle')),
      ),

      error === undefined ? null : h('div', { className: 'np-error', role: 'alert' }, error),

      h(
        'div',
        { className: 'np-toolbar' },
        h(
          'div',
          { className: 'np-chips', role: 'group', 'aria-label': T('tierFilter') },
          ...TIER_ORDER.map((tier) =>
            h(
              'button',
              {
                key: tier,
                type: 'button',
                className: `np-chip${tierFilter.has(tier) ? ' np-chip--on' : ''} np-chip--${tier}`,
                'aria-pressed': tierFilter.has(tier),
                onClick: () => toggleTier(tier),
              },
              TIER_LABELS[tier],
              counts === undefined ? null : h('span', { className: 'np-chip-count' }, String(counts[tier] ?? 0)),
            ),
          ),
        ),
        h('input', {
          className: 'np-search',
          type: 'search',
          placeholder: T('search'),
          value: query,
          onInput: (event) => setQuery(event.currentTarget.value),
        }),
        h(
          'button',
          { type: 'button', className: 'np-btn', onClick: refresh, disabled: busy === 'refresh' },
          busy === 'refresh' ? T('refreshing') : T('refreshNow'),
        ),
        h(
          'button',
          { type: 'button', className: 'np-btn np-btn--primary', onClick: probeAll, disabled: testingAll || models.length === 0 },
          testingAll ? T('testing') : T('testAll'),
        ),
      ),

      h(
        'div',
        { className: 'np-meta' },
        counts === undefined
          ? T('loading')
          : `${counts.total} ${T('models')} · ${counts.visible} ${T('offered')} · ${T('source')}: ${
              store.source === 'live' ? T('live') : T('stale')
            } · ${T('updated')}: ${formatTime(store.updatedAt)}`,
      ),

      shown.length === 0
        ? h('p', { className: 'np-empty' }, T('empty'))
        : TIER_ORDER.map((tier) => {
            const rows = grouped.get(tier) ?? []
            if (rows.length === 0) return null
            return h(
              'section',
              { key: tier, className: 'np-group' },
              h('h3', { className: `np-group-head np-group-head--${tier}` }, TIER_LABELS[tier], h('span', { className: 'np-chip-count' }, String(rows.length))),
              h(
                'div',
                { className: 'np-rows' },
                ...rows.map((model) => {
                  const light = lightOf(model.status)
                  const pending = busy === `probe:${model.id}` || model.status?.pending === true
                  return h(
                    'div',
                    { key: model.id, className: `np-row${model.visible ? '' : ' np-row--off'}` },
                    h('span', {
                      className: `np-light np-light--${pending ? 'pending' : light.tone}`,
                      title: pending ? T('testing') : light.title,
                      role: 'img',
                      'aria-label': pending ? T('testing') : light.title,
                    }),
                    h(
                      'div',
                      { className: 'np-main' },
                      h('div', { className: 'np-name' }, model.name ?? model.id),
                      h('div', { className: 'np-id' }, model.id),
                      h(
                        'div',
                        { className: 'np-detail' },
                        `${formatContext(model)} ${T('context')} · ${formatPrice(model)}${T('perMillion')}`,
                        model.note === 'chat-model' ? h('span', { className: 'np-note' }, T('chatModel')) : null,
                      ),
                    ),
                    h(
                      'div',
                      { className: 'np-actions' },
                      h(
                        'select',
                        {
                          className: 'np-select',
                          value: model.tier,
                          title: T('tierOverride'),
                          onChange: (event) => void setOverride(model.id, { tier: event.currentTarget.value }),
                        },
                        ...TIER_ORDER.map((option) => h('option', { key: option, value: option }, TIER_LABELS[option])),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'np-btn np-btn--sm',
                          onClick: () => void probe(model.id),
                          disabled: pending,
                        },
                        pending ? T('testing') : T('probe'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: `np-toggle${model.visibility === 'hide' ? ' np-toggle--off' : ''}`,
                          'aria-pressed': model.visibility !== 'hide',
                          title: model.visibility === 'hide' ? T('showTip') : T('hideTip'),
                          onClick: () =>
                            void setOverride(model.id, { visibility: model.visibility === 'hide' ? 'inherit' : 'hide' }),
                        },
                        model.visibility === 'hide' ? T('show') : T('hide'),
                      ),
                    ),
                  )
                }),
              ),
            )
          }),

      h(
        'footer',
        { className: 'np-foot' },
        h('p', null, T('footnote')),
      ),
    )
  }
}

/** The page's stylesheet, injected once per bundle. */
export const SETTINGS_CSS = `
.np-page { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 32px; font-size: 13px; }
.np-head { display: flex; flex-direction: column; gap: 4px; }
.np-title { margin: 0; font-size: 16px; font-weight: 600; }
.np-sub { margin: 0; color: var(--dsh-text-secondary, #8b8b8b); font-size: 12px; line-height: 1.5; }
.np-error { padding: 8px 12px; border-radius: 8px; background: rgba(220, 80, 80, 0.12); border: 1px solid rgba(220, 80, 80, 0.35); color: #d05050; font-size: 12px; }
.np-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.np-chips { display: flex; gap: 6px; }
.np-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--dsh-border, #3a3a3a); background: transparent; color: inherit; font-size: 12px; cursor: pointer; opacity: 0.55; }
.np-chip--on { opacity: 1; border-color: currentColor; }
.np-chip--free.np-chip--on { color: #3cae6a; }
.np-chip--plan.np-chip--on { color: #3a86d6; }
.np-chip--paid.np-chip--on { color: #c08a2e; }
.np-chip-count { padding: 0 5px; border-radius: 999px; background: rgba(128, 128, 128, 0.18); font-size: 11px; }
.np-search { flex: 1 1 140px; min-width: 120px; padding: 5px 9px; border-radius: 7px; border: 1px solid var(--dsh-border, #3a3a3a); background: var(--dsh-input-bg, transparent); color: inherit; font-size: 12px; }
.np-btn { padding: 5px 11px; border-radius: 7px; border: 1px solid var(--dsh-border, #3a3a3a); background: transparent; color: inherit; font-size: 12px; cursor: pointer; }
.np-btn:hover:not(:disabled) { background: rgba(128, 128, 128, 0.12); }
.np-btn:disabled { opacity: 0.45; cursor: default; }
.np-btn--primary { border-color: #3a86d6; color: #3a86d6; }
.np-btn--sm { padding: 3px 8px; font-size: 11px; }
.np-meta { color: var(--dsh-text-secondary, #8b8b8b); font-size: 11px; }
.np-empty { padding: 20px; text-align: center; color: var(--dsh-text-secondary, #8b8b8b); }
.np-group { display: flex; flex-direction: column; gap: 6px; }
.np-group-head { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
.np-group-head--free { color: #3cae6a; }
.np-group-head--plan { color: #3a86d6; }
.np-group-head--paid { color: #c08a2e; }
.np-rows { display: flex; flex-direction: column; gap: 1px; border-radius: 9px; overflow: hidden; border: 1px solid var(--dsh-border, #3a3a3a); }
.np-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: rgba(128, 128, 128, 0.05); }
.np-row--off { opacity: 0.48; }
.np-light { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; background: #6b6b6b; }
.np-light--ok { background: #3cae6a; box-shadow: 0 0 0 3px rgba(60, 174, 106, 0.18); }
.np-light--fail { background: #d05050; box-shadow: 0 0 0 3px rgba(208, 80, 80, 0.18); }
.np-light--pending { background: #c9a227; animation: np-pulse 1s ease-in-out infinite; }
@keyframes np-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.np-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.np-name { font-weight: 500; }
.np-id { font-family: var(--dsh-font-mono, ui-monospace, monospace); font-size: 11px; color: var(--dsh-text-secondary, #8b8b8b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-detail { font-size: 11px; color: var(--dsh-text-secondary, #8b8b8b); }
.np-note { margin-left: 6px; padding: 0 5px; border-radius: 4px; background: rgba(201, 162, 39, 0.18); color: #c9a227; }
.np-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
.np-select { padding: 3px 6px; border-radius: 6px; border: 1px solid var(--dsh-border, #3a3a3a); background: var(--dsh-input-bg, transparent); color: inherit; font-size: 11px; }
.np-toggle { padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(60, 174, 106, 0.5); color: #3cae6a; background: transparent; font-size: 11px; cursor: pointer; }
.np-toggle--off { border-color: var(--dsh-border, #3a3a3a); color: var(--dsh-text-secondary, #8b8b8b); }
.np-foot { border-top: 1px solid var(--dsh-border, #3a3a3a); padding-top: 10px; color: var(--dsh-text-secondary, #8b8b8b); font-size: 11px; line-height: 1.6; }
.np-foot p { margin: 0; }
@media (max-width: 560px) {
  .np-row { flex-wrap: wrap; }
  .np-actions { width: 100%; justify-content: flex-end; }
}
`
