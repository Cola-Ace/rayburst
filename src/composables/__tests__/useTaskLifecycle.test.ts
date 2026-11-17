/** @fileoverview Tests for persisted task reconstruction and cleanup. */
import { describe, it, expect, vi } from 'vitest'
import type { Aria2Task, HistoryRecord } from '@shared/types'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(true),
  remove: vi.fn().mockResolvedValue(undefined),
}))

const { historyRecordToTask, mergeHistoryIntoTasks, extractHistoryFilePaths } = await import('../useTaskLifecycle')

// ── Test data factories ──────────────────────────────────────────────

function makeTask(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: 'abc123',
    status: 'complete',
    totalLength: '1048576',
    completedLength: '1048576',

    downloadSpeed: '0',

    connections: '0',
    dir: '/downloads',
    files: [
      {
        index: '1',
        path: '/downloads/test.zip',
        length: '1048576',
        selected: 'true',
        uris: [{ uri: 'https://example.com/test.zip', status: 'used' }],
      },
    ],
    ...overrides,
  } as unknown as Aria2Task
}

// ── isMetadataTask ───────────────────────────────────────────────────

// ── historyRecordToTask ─────────────────────────────────────────────

function makeRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    gid: 'hist-001',
    name: 'test-file.zip',
    status: 'complete',
    uri: 'https://example.com/test-file.zip',
    dir: '/downloads',
    total_length: 2048000,
    task_type: 'uri',
    completed_at: '2026-03-15T10:00:00.000Z',
    ...overrides,
  }
}

describe('historyRecordToTask', () => {
  it('restores actual progress and errors without filling skipped files', () => {
    const task = historyRecordToTask(
      makeRecord({
        status: 'error',
        meta: JSON.stringify({
          completedLength: '50',
          errorCode: '3',
          errorMessage: 'Not found',
          files: [
            { index: '1', path: '/dl/selected', length: '100', completedLength: '50', selected: 'true', uris: [] },
            { index: '2', path: '/dl/skipped', length: '1000', completedLength: '0', selected: 'false', uris: [] },
          ],
        }),
      }),
    )
    expect(task.completedLength).toBe('50')
    expect(task.errorMessage).toBe('Not found')
    expect(task.files.map((file) => file.completedLength)).toEqual(['50', '0'])
  })
  it('maps gid, status, dir, totalLength from record', () => {
    const task = historyRecordToTask(makeRecord())
    expect(task.gid).toBe('hist-001')
    expect(task.status).toBe('complete')
    expect(task.dir).toBe('/downloads')
    expect(task.totalLength).toBe('2048000')
    expect(task.completedLength).toBe('2048000')
  })

  it('constructs files[0] with correct path and uri for URI tasks', () => {
    const task = historyRecordToTask(makeRecord())
    expect(task.files).toHaveLength(1)
    expect(task.files[0].path).toBe('/downloads/test-file.zip')
    expect(task.files[0].uris).toEqual([{ uri: 'https://example.com/test-file.zip', status: 'used' }])
  })

  it('handles missing optional fields gracefully', () => {
    const task = historyRecordToTask(makeRecord({ uri: undefined, dir: undefined, total_length: undefined }))
    expect(task.dir).toBe('')
    expect(task.totalLength).toBe('0')
    expect(task.files[0].uris).toEqual([])
  })

  it('preserves error status', () => {
    const task = historyRecordToTask(makeRecord({ status: 'error' }))
    expect(task.status).toBe('error')
  })

  it('sets completedLength = totalLength for complete records, 0 for error', () => {
    const complete = historyRecordToTask(makeRecord({ status: 'complete', total_length: 5000 }))
    expect(complete.completedLength).toBe('5000')

    const errored = historyRecordToTask(makeRecord({ status: 'error', total_length: 5000 }))
    expect(errored.completedLength).toBe('0')
  })

  it('handles missing/corrupt meta gracefully', () => {
    const task1 = historyRecordToTask(makeRecord({ meta: undefined }))
    expect(task1.files).toHaveLength(1)

    const task2 = historyRecordToTask(makeRecord({ meta: 'NOT_JSON' }))
    expect(task2.files).toHaveLength(1)
  })
})

// ── mergeHistoryIntoTasks ───────────────────────────────────────────

describe('mergeHistoryIntoTasks', () => {
  it('returns aria2 tasks unchanged when no history records', () => {
    const aria2 = [makeTask({ gid: 'a1' })]
    const result = mergeHistoryIntoTasks(aria2, [])
    expect(result).toEqual(aria2)
  })

  it('appends history-only records after aria2 tasks', () => {
    const aria2 = [makeTask({ gid: 'a1' })]
    const history = [makeRecord({ gid: 'h1' })]
    const result = mergeHistoryIntoTasks(aria2, history)
    expect(result).toHaveLength(2)
    expect(result[0].gid).toBe('a1')
    expect(result[1].gid).toBe('h1')
  })

  it('deduplicates by GID — aria2 data wins', () => {
    const aria2 = [makeTask({ gid: 'shared', totalLength: '9999' })]
    const history = [makeRecord({ gid: 'shared', total_length: 1111 })]
    const result = mergeHistoryIntoTasks(aria2, history)
    expect(result).toHaveLength(1)
    expect(result[0].gid).toBe('shared')
    expect(result[0].totalLength).toBe('9999') // aria2 data preserved
  })

  it('handles empty aria2 with history records', () => {
    const history = [makeRecord({ gid: 'h1' }), makeRecord({ gid: 'h2' })]
    const result = mergeHistoryIntoTasks([], history)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.gid)).toEqual(['h1', 'h2'])
  })

  it('handles both empty', () => {
    expect(mergeHistoryIntoTasks([], [])).toEqual([])
  })

  it('restores each record once and shares the frozen task across snapshots', () => {
    const history = [makeRecord({ gid: 'h1' })]
    const first = mergeHistoryIntoTasks([], history)[0]
    expect(mergeHistoryIntoTasks([], history)[0]).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(mergeHistoryIntoTasks([], [{ ...history[0] }])[0]).not.toBe(first)
  })

  it('keeps HTTP records with no infoHash (GID-only dedup)', () => {
    const aria2 = [makeTask({ gid: 'http-1' })]
    const history = [makeRecord({ gid: 'http-2', meta: undefined })]
    const result = mergeHistoryIntoTasks(aria2, history)
    expect(result).toHaveLength(2) // different GIDs, no infoHash → no cross-dedup
  })

  it('preserves records with corrupt meta JSON gracefully', () => {
    const aria2 = [
      makeTask({
        gid: 'bt-1',
        infoHash: 'aabb',
        bittorrent: { info: { name: 'X' } },
      } as Partial<Aria2Task>),
    ]
    const history = [makeRecord({ gid: 'old-1', meta: 'NOT_VALID_JSON' })]
    const result = mergeHistoryIntoTasks(aria2, history)
    // Corrupt meta → cannot extract infoHash → record kept (safe fallback)
    expect(result).toHaveLength(2)
  })

  it('keeps native output paths authoritative over a conflicting history snapshot', () => {
    const task = makeTask({ dir: '/downloads' })
    const result = mergeHistoryIntoTasks([task], [makeRecord({ gid: task.gid, dir: '/old-location' })])
    expect(result[0].dir).toBe('/downloads')
    expect(result[0].files[0].path).toBe('/downloads/test.zip')
  })
})

// ── historyRecordToTask multi-file ──────────────────────────────────

describe('historyRecordToTask — multi-file restoration', () => {
  it('restores complete files[] from meta.files', () => {
    const meta = JSON.stringify({
      files: [
        { path: '/dl/a.zip', length: '100', selected: 'true', uris: ['http://m1/a.zip'] },
        { path: '/dl/b.zip', length: '200', selected: 'true', uris: ['http://m1/b.zip'] },
        { path: '/dl/c.zip', length: '300', selected: 'false', uris: ['http://m1/c.zip'] },
      ],
    })
    const task = historyRecordToTask(makeRecord({ meta }))
    expect(task.files).toHaveLength(3)
    expect(task.files[0].path).toBe('/dl/a.zip')
    expect(task.files[1].length).toBe('200')
    expect(task.files[2].selected).toBe('false')
  })

  it('restores full mirror URIs from meta.files', () => {
    const meta = JSON.stringify({
      files: [{ path: '/dl/a.zip', length: '100', uris: ['http://mirror1/a.zip', 'http://mirror2/a.zip'] }],
    })
    const task = historyRecordToTask(makeRecord({ meta }))
    expect(task.files[0].uris).toEqual([
      { uri: 'http://mirror1/a.zip', status: 'used' },
      { uri: 'http://mirror2/a.zip', status: 'used' },
    ])
  })

  it('falls back to single-file synthesis when meta.files is absent', () => {
    const task = historyRecordToTask(makeRecord({ meta: undefined }))
    expect(task.files).toHaveLength(1)
    expect(task.files[0].path).toBe('/downloads/test-file.zip')
  })

  it('falls back to single-file synthesis when meta.files is empty array', () => {
    const meta = JSON.stringify({ files: [] })
    const task = historyRecordToTask(makeRecord({ meta }))
    expect(task.files).toHaveLength(1)
  })
})

// ── extractHistoryFilePaths ─────────────────────────────────────────

describe('extractHistoryFilePaths', () => {
  it('returns all paths from meta.files when present', () => {
    const meta = JSON.stringify({
      files: [
        { path: '/dl/a.zip', uris: [] },
        { path: '/dl/b.zip', uris: [] },
        { path: '/dl/c.zip', uris: [] },
      ],
    })
    const paths = extractHistoryFilePaths(makeRecord({ meta }))
    expect(paths).toEqual(['/dl/a.zip', '/dl/b.zip', '/dl/c.zip'])
  })

  it('falls back to dir + name when meta.files is absent', () => {
    const paths = extractHistoryFilePaths(makeRecord({ dir: '/dl', name: 'file.zip', meta: undefined }))
    expect(paths).toEqual(['/dl/file.zip'])
  })

  it('returns empty array when both dir and name are missing', () => {
    const paths = extractHistoryFilePaths(makeRecord({ dir: undefined, name: '', meta: undefined }))
    expect(paths).toEqual([])
  })
})
