import { describe, expect, it } from 'vitest'
import type { Aria2Task } from '@shared/types'
import { buildMediaDetailRows, buildTaskDetailKind, buildUriDetailSummary } from '../useTaskDetailSummary'

function makeTask(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: 'gid-1',
    status: 'active',
    totalLength: '1000',
    completedLength: '400',

    downloadSpeed: '100',

    connections: '2',
    dir: '/downloads',
    files: [
      {
        index: '1',
        path: '/downloads/file.zip',
        length: '1000',
        completedLength: '400',
        selected: 'true',
        uris: [{ uri: 'https://example.com/file.zip', status: 'used' }],
      },
    ],
    ...overrides,
  }
}

describe('buildTaskDetailKind', () => {
  it('classifies HTTP, SFTP, and other URI tasks as uri when no protocol metadata exists', () => {
    expect(buildTaskDetailKind(makeTask())).toBe('uri')
  })
})

describe('buildUriDetailSummary', () => {
  it('summarizes sources and does not expose bittorrent fields', () => {
    const summary = buildUriDetailSummary(
      makeTask({
        files: [
          {
            index: '1',
            path: '/downloads/file.zip',
            length: '1000',
            completedLength: '400',
            selected: 'true',
            uris: [
              { uri: 'https://mirror-a.example/file.zip', status: 'used' },
              { uri: 'https://mirror-b.example/file.zip', status: 'waiting' },
            ],
          },
        ],
      }),
    )

    expect(summary.primaryUri).toBe('https://mirror-a.example/file.zip')
    expect(summary.mirrorCount).toBe(2)
    expect(summary.fileCount).toBe(1)
    expect(summary.selectedFileCount).toBe(1)
  })
})

describe('media overview integration', () => {
  const media = {
    state: 'downloading' as const,
    protocol: 'hls' as const,
    live: 'false' as const,
    duration: '60000',
    completedDuration: '10000',
    downloadedLength: '1024',
    lengthKnown: 'false' as const,
    error: '',
    tracks: [
      {
        id: '0:0',
        type: 'video' as const,
        language: '',
        codec: 'avc1',
        width: '640',
        height: '360',
        bandwidth: '1000000',
        selected: 'true' as const,
      },
    ],
  }
  it('does not repeat status, protocol or zero-value diagnostics before selection', () => {
    expect(buildMediaDetailRows(makeTask({ media: { ...media, state: 'awaiting-selection' } }), 'en-US')).toEqual([])
  })
  it('adds only media-specific rows to the existing overview', () => {
    const rows = buildMediaDetailRows(makeTask({ media }), 'en-US')
    expect(rows.map((row) => row.key)).toEqual(['video', 'duration', 'speed', 'received'])
    expect(rows.find((row) => row.key === 'duration')?.value).toBe('00:00:10 / 00:01:00')
    expect(rows.find((row) => row.key === 'video')?.value).toContain('640×360')
  })
  it('shows recorded duration without a fake total for paused live media', () => {
    const rows = buildMediaDetailRows(
      makeTask({ status: 'paused', media: { ...media, state: 'paused', live: 'true' } }),
      'en-US',
    )
    expect(rows.find((row) => row.key === 'duration')?.value).toBe('00:00:10')
    expect(rows.some((row) => row.key === 'speed')).toBe(false)
  })
})
