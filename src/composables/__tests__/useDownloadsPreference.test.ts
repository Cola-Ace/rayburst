import { describe, expect, it } from 'vitest'
import { createDefaultAppConfig } from '@shared/utils/configHydration'
import { buildDownloadsForm, buildDownloadsSystemConfig } from '../useDownloadsPreference'

describe('downloads preference contract', () => {
  it('owns disk allocation next to the save location', () => {
    const form = buildDownloadsForm({ ...createDefaultAppConfig(), fileAllocation: 'prealloc' })

    expect(form.fileAllocation).toBe('prealloc')
    expect(buildDownloadsSystemConfig(form)).toMatchObject({ 'file-allocation': 'prealloc' })
  })
})
