import { beforeEach, describe, expect, it, vi } from 'vitest'
const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))
vi.mock('@shared/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }))
import { useProtocolHandlers, type AssociationStatus } from '../useProtocolHandlers'
const snapshot = (state: AssociationStatus['state']): AssociationStatus => ({
  state,
  handler: null,
  error: null,
})

describe('native associations', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('queries existing defaults without registering a handler', async () => {
    mockInvoke.mockResolvedValue(snapshot('other'))
    const associations = useProtocolHandlers()
    await associations.refreshAll()
    expect(mockInvoke.mock.calls).toEqual([
      ['get_association_status', { protocol: 'thunder' }],
      ['get_association_status', { protocol: 'rayburst' }],
    ])
    expect(associations.status.value['thunder']?.state).toBe('other')
  })

  it('coalesces refreshes until the current queries complete', async () => {
    let complete!: (value: AssociationStatus) => void
    mockInvoke
      .mockReturnValueOnce(
        new Promise<AssociationStatus>((resolve) => {
          complete = resolve
        }),
      )
      .mockResolvedValueOnce(snapshot('unassigned'))
      .mockResolvedValue(snapshot('current'))
    const associations = useProtocolHandlers()
    const operation = associations.refreshAll()
    await associations.refreshAll()
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    complete(snapshot('other'))
    await operation
    expect(mockInvoke).toHaveBeenCalledTimes(4)
    expect(associations.busy.value).toBe(false)
    expect(associations.status.value.thunder?.state).toBe('current')
    expect(associations.status.value.rayburst?.state).toBe('current')
  })
})
