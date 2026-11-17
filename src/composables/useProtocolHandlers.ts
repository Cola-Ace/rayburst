/** @fileoverview Read-only native association state. */
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@shared/logger'
import { getErrorMessage } from '@shared/utils/errorMessage'

export const protocolKeys = ['thunder', 'rayburst'] as const
export type ProtocolKey = (typeof protocolKeys)[number]
export interface AssociationStatus {
  state: 'current' | 'other' | 'unassigned' | 'unavailable' | 'error'
  handler: string | null
  error: string | null
}
function errorReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'Protocol' in error) return String(error.Protocol)
  return getErrorMessage(error)
}

export function useProtocolHandlers() {
  const status = ref<Partial<Record<ProtocolKey, AssociationStatus>>>({})
  const refreshing = ref(false)
  let refreshRequested = false
  const busy = computed(() => refreshing.value)

  async function refreshProtocol(protocol: ProtocolKey): Promise<AssociationStatus> {
    try {
      const result = await invoke<AssociationStatus>('get_association_status', { protocol })
      status.value[protocol] = result
      return result
    } catch (error) {
      const reason = errorReason(error)
      logger.warn('Protocol.refresh', 'association query failed', { protocol, reason })
      const result: AssociationStatus = { state: 'error', handler: null, error: reason }
      status.value[protocol] = result
      return result
    }
  }

  async function refreshAll(): Promise<void> {
    refreshRequested = true
    if (busy.value) return
    refreshing.value = true
    try {
      do {
        refreshRequested = false
        await Promise.all(protocolKeys.map(refreshProtocol))
      } while (refreshRequested)
    } finally {
      refreshing.value = false
    }
  }

  return { status: computed(() => status.value), busy, refreshAll }
}
