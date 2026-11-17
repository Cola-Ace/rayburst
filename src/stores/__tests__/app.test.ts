import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'

// ── Mocks ───────────────────────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => 'macos'),
}))

const submitManualUrisMock = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const submitBatchItemsMock = vi.hoisted(() => vi.fn().mockResolvedValue(0))
const resolveUnresolvedItemsMock = vi.hoisted(() =>
  vi.fn(async (items: import('@shared/types').BatchItem[], _t: (key: string) => string, _downloadProxy?: string) => {
    for (const item of items) {
      item.payload = 'resolved-payload'
      item.status = 'pending'
    }
  }),
)

vi.mock('@/composables/useAddTaskSubmit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useAddTaskSubmit')>()
  return {
    ...actual,
    submitManualUris: (...args: Parameters<typeof actual.submitManualUris>) => submitManualUrisMock(...args),
  }
})

import { useAppStore } from '../app'
import { createBatchItem } from '@shared/utils/batchHelpers'

describe('useAppStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    submitManualUrisMock.mockReset()
    submitManualUrisMock.mockResolvedValue({ submittedTaskNames: [] })
    submitBatchItemsMock.mockReset()
    submitBatchItemsMock.mockResolvedValue(0)
    resolveUnresolvedItemsMock.mockClear()
  })

  // ── enqueueBatch ────────────────────────────────────────────────

  it('enqueueBatch deduplicates against items already in pendingBatch', () => {
    const store = useAppStore()

    store.pendingBatch = [createBatchItem('uri', 'https://example.test/existing')]

    const skipped = store.enqueueBatch([
      createBatchItem('uri', 'https://example.test/existing'),
      createBatchItem('uri', 'https://example.test/new'),
    ])

    expect(skipped).toBe(1)
    expect(store.pendingBatch.map((i) => i.source)).toEqual([
      'https://example.test/existing',
      'https://example.test/new',
    ])
  })

  it('enqueueBatch deduplicates duplicates within the same incoming batch', () => {
    const store = useAppStore()

    const skipped = store.enqueueBatch([
      createBatchItem('uri', 'https://example.test/dup'),
      createBatchItem('uri', 'https://example.test/dup'),
      createBatchItem('uri', 'https://example.test/other'),
    ])

    expect(skipped).toBe(1)
    expect(store.pendingBatch.map((i) => i.source)).toEqual(['https://example.test/dup', 'https://example.test/other'])
  })

  it('enqueueBatch returns 0 and opens dialog when given empty array', () => {
    const store = useAppStore()
    const skipped = store.enqueueBatch([])
    expect(skipped).toBe(0)
    expect(store.pendingBatch).toEqual([])
  })

  it('enqueueBatch opens addTaskDialog on non-empty input', () => {
    const store = useAppStore()
    expect(store.addTaskVisible).toBe(false)
    store.enqueueBatch([createBatchItem('uri', 'https://example.com/file')])
    expect(store.addTaskVisible).toBe(true)
  })

  it('deduplicates replayed confirmations and cancels only distinct duplicate intents', async () => {
    const store = useAppStore()
    const input = { url: 'https://example.com/file.zip', requestId: 'first' }
    await store.handleExternalInputs([input])
    vi.mocked(invoke).mockClear()
    await store.handleExternalInputs([input, { ...input, requestId: 'second' }])
    expect(store.pendingBatch).toHaveLength(1)
    expect(store.pendingBatch[0].browserContext?.requestId).toBe('first')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('cancel_download_request', { id: 'second' })
  })

  // ── Interval Management ─────────────────────────────────────────

  // ── Dialog State ────────────────────────────────────────────────

  describe('dialog state', () => {
    it('showAddTaskDialog clears stale external browser context before manual entry', () => {
      const store = useAppStore()
      store.pendingReferer = 'https://old.example/page'
      store.pendingCookie = 'sid=old'
      store.pendingFilename = 'old.zip'
      store.pendingUserAgent = 'OldUA/1.0'
      store.pendingRequestHeaders = [{ name: 'Accept', value: 'application/octet-stream' }]

      store.showAddTaskDialog()

      expect(store.addTaskVisible).toBe(true)
      expect(store.pendingReferer).toBe('')
      expect(store.pendingCookie).toBe('')
      expect(store.pendingFilename).toBe('')
      expect(store.pendingUserAgent).toBe('')
      expect(store.pendingRequestHeaders).toEqual([])
    })

    it('hideAddTaskDialog sets addTaskVisible to false and clears pendingBatch', () => {
      const store = useAppStore()
      store.addTaskVisible = true
      store.pendingBatch = [createBatchItem('uri', 'https://example.com')]
      store.hideAddTaskDialog()
      expect(store.addTaskVisible).toBe(false)
      expect(store.pendingBatch).toEqual([])
    })
  })

  // ── applyStat (pump snapshot → reactive state) ──────────────────

  describe('applyStat', () => {
    it('updates stat values from event payload', () => {
      const store = useAppStore()
      store.applyStat({
        downloadSpeed: 204800,

        numActive: 2,
        numWaiting: 1,
        numStopped: 5,
        numStoppedTotal: 10,
      })
      expect(store.stat.downloadSpeed).toBe(204800)
      expect(store.stat.numActive).toBe(2)
      expect(store.stat.numWaiting).toBe(1)
      expect(store.stat.numStopped).toBe(5)
    })

    it('preserves the authoritative engine speed payload', () => {
      const store = useAppStore()
      store.applyStat({
        downloadSpeed: 999,

        numActive: 0,
        numWaiting: 0,
        numStopped: 1,
        numStoppedTotal: 1,
      })
      expect(store.stat.downloadSpeed).toBe(999)
    })

    it('preserves downloadSpeed when tasks are active', () => {
      const store = useAppStore()
      store.applyStat({
        downloadSpeed: 512000,

        numActive: 1,
        numWaiting: 0,
        numStopped: 0,
        numStoppedTotal: 0,
      })
      expect(store.stat.downloadSpeed).toBe(512000)
    })
  })

  // ── handleDeepLinkUrls ──────────────────────────────────────────

  describe('handleDeepLinkUrls', () => {
    beforeEach(async () => {
      const { usePreferenceStore } = await import('@/stores/preference')
      usePreferenceStore().config.extensionDownloadBehavior = 'confirm'
    })

    it('no-ops for empty or null-ish input', () => {
      const store = useAppStore()
      store.handleDeepLinkUrls([])
      expect(store.pendingBatch).toEqual([])
    })

    it('treats the private scheme as activation only, even with download parameters', () => {
      const store = useAppStore()
      const result = store.handleDeepLinkUrls(['rayburst://', 'rayburst://new?url=https://example.com/file.zip'])
      expect(store.pendingBatch).toHaveLength(0)
      expect(result.ignored).toBe(2)
    })
  })

  // ── Extension download behavior ───────────────────────────────────

  describe('extensionDownloadBehavior', () => {
    beforeEach(async () => {
      const { usePreferenceStore } = await import('@/stores/preference')
      usePreferenceStore().recordHistoryDirectory = vi.fn()
    })

    function browserInput(url: string, referer = '', cookie = '', filename = '') {
      return { url, referer, cookie, filename, source: 'http-api' }
    }

    it('auto-submits HTTP URI when enabled', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'show'
      const onStart = vi.fn()
      store.setExternalInputStartHandler(onStart)
      submitManualUrisMock.mockResolvedValueOnce({
        submittedTaskNames: ['file.zip'],
      })

      await store.handleExternalInputs([browserInput('https://example.com/file.zip')])
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Auto-submitted: pendingBatch should be empty, dialog should NOT open
      expect(store.pendingBatch).toHaveLength(0)
      expect(store.addTaskVisible).toBe(false)
      expect(onStart).toHaveBeenCalledWith(['file.zip'])
    })

    it('falls back to AddTask dialog when disabled', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'confirm'

      await store.handleExternalInputs([browserInput('https://example.com/file.zip')])

      expect(store.pendingBatch).toHaveLength(1)
      expect(store.addTaskVisible).toBe(true)
    })

    it('does not open dialog when all items are auto-submitted', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'show'

      await store.handleExternalInputs([
        browserInput('https://example.com/a.zip'),
        browserInput('https://example.com/b.mp4'),
      ])

      expect(store.pendingBatch).toHaveLength(0)
      expect(store.addTaskVisible).toBe(false)
    })

    it('passes referer through auto-submit without retaining pending metadata', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'show'

      await store.handleExternalInputs([browserInput('https://example.com/file.zip', 'https://example.com')])

      const submittedForm = submitManualUrisMock.mock.calls[0][0]
      expect(submittedForm.referer).toBe('https://example.com')
      expect(store.pendingReferer).toBe('')
    })

    it('passes cookie through auto-submit without retaining pending metadata', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'show'

      await store.handleExternalInputs([
        browserInput('https://cdn.quark.cn/file.zip', 'https://pan.quark.cn', 'auth=secret'),
      ])

      const submittedForm = submitManualUrisMock.mock.calls[0][0]
      expect(submittedForm.cookie).toBe('auth=secret')
      expect(store.pendingCookie).toBe('')
    })

    it('auto-submits structured extension input with captured user agent and request headers', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'show'
      prefStore.config.userAgent = 'ConfiguredUA/1.0'

      await store.handleExternalInputs([
        {
          url: 'https://drivers.amd.com/file.exe',
          finalUrl: 'https://drivers.amd.com/file.exe',
          referer: 'https://www.amd.com/support',
          cookie: 'auth=secret',
          userAgent: 'BrowserUA/1.0',
          requestHeaders: [{ name: 'Accept', value: 'application/octet-stream' }],
          filename: 'driver.exe',
          source: 'http-api',
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))

      const submittedForm = submitManualUrisMock.mock.calls[0][0]
      expect(submittedForm.userAgent).toBe('BrowserUA/1.0')
      expect(submittedForm.referer).toBe('https://www.amd.com/support')
      expect(submittedForm.cookie).toBe('auth=secret')
      expect(submittedForm.requestHeaders).toEqual([{ name: 'Accept', value: 'application/octet-stream' }])
    })

    it('falls back to configured user agent when structured input has none', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'show'
      prefStore.config.userAgent = 'ConfiguredUA/1.0'

      await store.handleExternalInputs([
        {
          url: 'https://example.com/file.zip',
          source: 'http-api',
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))

      const submittedForm = submitManualUrisMock.mock.calls[0][0]
      expect(submittedForm.userAgent).toBe('ConfiguredUA/1.0')
    })

    it('keeps structured request headers for manual dialog submission', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'confirm'

      await store.handleExternalInputs([
        {
          url: 'https://example.com/file.zip',
          userAgent: 'BrowserUA/1.0',
          requestHeaders: [{ name: 'Accept-Language', value: 'en-US,en;q=0.9' }],
          source: 'http-api',
        },
      ])

      expect(store.pendingBatch).toHaveLength(1)
      expect(store.pendingBatch[0].browserContext).toMatchObject({
        userAgent: 'BrowserUA/1.0',
        requestHeaders: [{ name: 'Accept-Language', value: 'en-US,en;q=0.9' }],
      })
      expect(store.pendingUserAgent).toBe('BrowserUA/1.0')
      expect(store.pendingRequestHeaders).toEqual([{ name: 'Accept-Language', value: 'en-US,en;q=0.9' }])
    })

    it('non-extension deep links (file://, http://) are unaffected by auto-submit', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'show'

      // Regular deep links (not rayburst://) should always go to dialog
      store.handleDeepLinkUrls(['https://example.com/file.zip'])

      expect(store.pendingBatch).toHaveLength(1)
      expect(store.addTaskVisible).toBe(true)
    })

    it('reports readable auto-submit errors for structured Tauri failures', async () => {
      const store = useAppStore()
      const { usePreferenceStore } = await import('@/stores/preference')
      const prefStore = usePreferenceStore()
      prefStore.config.extensionDownloadBehavior = 'show'
      const onError = vi.fn()
      submitManualUrisMock.mockRejectedValueOnce({ Aria2: 'aria2 RPC error [1]: Unsupported URI scheme' })

      store.setExternalInputErrorHandler(onError)
      await store.handleExternalInputs([browserInput('23222233')])
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(onError).toHaveBeenCalledWith({ Aria2: 'aria2 RPC error [1]: Unsupported URI scheme' })
    })
  })
})
