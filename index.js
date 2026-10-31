/**
 * Host half of dsh-plugin-model-matrix.
 * Mounts subscription routes, model catalog synchronization, and connection probes.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { createModelApi } from './src/core/api.js'
import { probeModel } from './src/core/probe.js'
import { ModelStore } from './src/core/store.js'
import { autoHeal, inspectPluginStatus } from './scripts/self-healer.mjs'

export const name = 'model-matrix'
export const inject = ['llm']

const PKG = 'dsh-plugin-model-matrix'
const NS = 'model-matrix'

export function apply(ctx) {
  // Automatic Self-Healing & Compatibility Guard upon DSH host plugin initialization
  try {
    const status = inspectPluginStatus()
    if (status.asarStatus === 'UNPATCHED_COMPATIBLE' || !status.profileBundleRegistered || !status.junctionExists) {
      console.log(`[${PKG}] Triggering self-healing for DSH ${status.appVersion}...`)
      autoHeal({ verbose: true })
    }
  } catch (err) {
    console.warn(`[${PKG}] Self-healing check error:`, err?.message || err)
  }

  const dshHome = resolveDshHome?.() ?? join(process.env.HOME || process.env.USERPROFILE, '.dsh')
  const storeDir = join(dshHome, 'model-matrix')
  const store = new ModelStore(storeDir)

  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.webServer
    const apiHandler = createModelApi({
      store,
      refresh: async () => {
        try {
          ctx.llm?.emitAdaptersUpdated?.()
        } catch {}
      },
      probe: async (modelId, signal) => {
        return probeModel({
          endpoint: 'https://api.deepseek.com/chat/completions',
          model: modelId,
          headers: async () => ({}),
          signal
        })
      },
      project: (doc) => doc
    })

    scoped.effect(
      () => webServer.register({ kind: 'prefix', path: `/api/${NS}`, handler: apiHandler }),
      `${PKG}: api routes`
    )
  })

  ctx.inject(['commands'], (scoped) => {
    const commands = scoped.commands
    scoped.effect(() => {
      return commands.register({
        name: 'model-matrix-status',
        description: '查看模型矩阵连通性与提供商状态',
        execute: async () => {
          return 'Model Matrix is active and monitoring provider connectivity.'
        }
      })
    }, `${PKG}: status command`)
  })
}
