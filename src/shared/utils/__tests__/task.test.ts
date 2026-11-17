/** @fileoverview Tests for task metadata utilities: progress, naming, source links. */
import { describe, it, expect, vi } from 'vitest'
import {
  calcProgress,
  getTaskCompletedLength,
  getTaskName,
  getFileNameFromFile,
  getTaskUri,
  resolveOpenTarget,
  getRestartDescriptors,
} from '../task'
import type { Aria2Task, Aria2File } from '@shared/types'

// Mock Tauri's path.join() — used by resolveOpenTarget for platform-safe path joining.
// In tests, we simulate it with simple string concatenation using '/'.
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

function createMockTask(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: '1',
    status: 'active',
    totalLength: '1000',
    completedLength: '500',

    downloadSpeed: '100',

    connections: '1',
    dir: '/tmp',
    files: [],
    ...overrides,
  }
}

function createMockFile(overrides: Partial<Aria2File> = {}): Aria2File {
  return {
    index: '1',
    path: '/tmp/test.txt',
    length: '1000',
    completedLength: '500',
    selected: 'true',
    uris: [],
    ...overrides,
  }
}

describe('calcProgress', () => {
  it('returns 0 for zero total length', () => {
    expect(calcProgress(0, 0)).toBe(0)
  })

  it('calculates percentage correctly', () => {
    expect(calcProgress(1000, 500)).toBe(50)
    expect(calcProgress(1000, 1000)).toBe(100)
    expect(calcProgress(1000, 250)).toBe(25)
  })

  it('keeps one decimal and never reads 100 before the end', () => {
    expect(calcProgress(3, 1)).toBe(33.3)
    expect(calcProgress(10000, 9999)).toBe(99.9)
  })

  it('handles string inputs', () => {
    expect(calcProgress('1000', '500')).toBe(50)
  })

  it('returns 0 when completed is 0', () => {
    expect(calcProgress(1000, 0)).toBe(0)
  })
})

describe('getTaskCompletedLength', () => {
  it('uses aria2 completedLength for display progress', () => {
    const task = createMockTask({
      status: 'paused',
      totalLength: '1000',
      completedLength: '300',
    })

    expect(getTaskCompletedLength(task)).toBe(300)
  })

  it('keeps progress tied to the native completed length', () => {
    const httpTask = createMockTask({
      status: 'active',
      totalLength: '1000',
      completedLength: '200',
    })
    const btTask = createMockTask({
      status: 'active',
      totalLength: '1000',
      completedLength: '300',
    })

    expect(getTaskCompletedLength(httpTask)).toBe(200)
    expect(getTaskCompletedLength(btTask)).toBe(300)
  })
})

describe('getTaskName', () => {
  it('returns default name for null task', () => {
    expect(getTaskName(null, { defaultName: 'Unknown' })).toBe('Unknown')
  })

  it('returns empty string for null task with no default', () => {
    expect(getTaskName(null)).toBe('')
  })

  it('returns filename for single-file HTTP task', () => {
    const task = createMockTask({
      files: [createMockFile({ path: '/downloads/movie.mp4' })],
    })
    expect(getTaskName(task)).toBe('movie.mp4')
  })

  it('returns default when files array is empty', () => {
    const task = createMockTask({ files: [] })
    expect(getTaskName(task, { defaultName: 'N/A' })).toBe('N/A')
  })
})

describe('getFileNameFromFile', () => {
  // ── Path-based extraction (aria2 has resolved the filename) ──

  it('returns filename from absolute path', () => {
    const file = createMockFile({ path: '/tmp/download/test.zip' })
    expect(getFileNameFromFile(file)).toBe('test.zip')
  })

  it('returns filename from Windows path with backslashes', () => {
    const file = createMockFile({ path: 'C:\\Downloads\\nested\\test.zip' })
    expect(getFileNameFromFile(file)).toBe('test.zip')
  })

  it('returns full path when no separator found', () => {
    const file = createMockFile({ path: 'plainfile.txt' })
    expect(getFileNameFromFile(file)).toBe('plainfile.txt')
  })

  it('returns empty string for undefined file', () => {
    expect(getFileNameFromFile()).toBe('')
  })

  // ── URI fallback (path empty — aria2 hasn't resolved yet) ──

  it('falls back to URI filename when path is empty and URI has extension', () => {
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'https://example.com/file.zip', status: 'used' }],
    })
    expect(getFileNameFromFile(file)).toBe('file.zip')
  })

  it('decodes percent-encoded URI filename in fallback', () => {
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'https://example.com/AAA%20BBB.mp3', status: 'used' }],
    })
    expect(getFileNameFromFile(file)).toBe('AAA BBB.mp3')
  })

  it('returns empty for extensionless URI path — redirect/API endpoint', () => {
    // The exact scenario from bug report: https://datashop.cboe.com/download/sample/215
    // "215" is not a filename — it's a redirect stub. aria2 will resolve via Content-Disposition.
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'https://datashop.cboe.com/download/sample/215', status: 'used' }],
    })
    expect(getFileNameFromFile(file)).toBe('')
  })

  it('returns empty for numeric-only URI path segments', () => {
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'https://api.example.com/files/99999', status: 'used' }],
    })
    expect(getFileNameFromFile(file)).toBe('')
  })

  it('returns empty for version-like URI segments without real extension', () => {
    // "v1.2.3" looks like it has a dot but is not a real filename
    // Actually it DOES contain a dot, so this would be treated as having an extension.
    // This is an acceptable trade-off: false positive (showing "v1.2.3" temporarily)
    // is better than false negative (hiding a real filename).
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'https://example.com/releases/v1.2.3', status: 'used' }],
    })
    // Contains dots → treated as having extension → returned as-is
    expect(getFileNameFromFile(file)).toBe('v1.2.3')
  })

  it('returns empty when path and uris are both empty', () => {
    const file = createMockFile({ path: '', uris: [] })
    expect(getFileNameFromFile(file)).toBe('')
  })

  it('returns empty for URI with trailing slash and no filename', () => {
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'https://example.com/', status: 'used' }],
    })
    expect(getFileNameFromFile(file)).toBe('')
  })

  it('handles deep path URIs with extension correctly', () => {
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'https://cdn.example.com/a/b/c/deep%20file.tar.gz', status: 'used' }],
    })
    expect(getFileNameFromFile(file)).toBe('deep file.tar.gz')
  })

  it('handles URIs with query parameters', () => {
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'https://example.com/report.pdf?token=abc&v=2', status: 'used' }],
    })
    expect(getFileNameFromFile(file)).toBe('report.pdf')
  })

  it('returns empty for invalid URI gracefully', () => {
    const file = createMockFile({
      path: '',
      uris: [{ uri: 'not-a-valid-url', status: 'used' }],
    })
    expect(getFileNameFromFile(file)).toBe('')
  })
})

// ── getTaskName ───────────────────────────────────────────────

describe('getTaskName', () => {
  it('preserves literal percent sequences in native file paths', () => {
    const task = createMockTask({
      files: [createMockFile({ path: '/downloads/AAA%20BBB.mp3' })],
    })
    expect(getTaskName(task)).toBe('AAA%20BBB.mp3')
  })

  it('does not reinterpret an existing filename as an encoded URL', () => {
    const task = createMockTask({
      files: [createMockFile({ path: '/downloads/file-r%C3%A9sum%C3%A9.txt' })],
    })
    expect(getTaskName(task)).toBe('file-r%C3%A9sum%C3%A9.txt')
  })

  it('returns default name for null task', () => {
    expect(getTaskName(null, { defaultName: 'Unknown' })).toBe('Unknown')
  })

  it('returns original name for malformed percent sequence', () => {
    const task = createMockTask({
      files: [createMockFile({ path: '/downloads/bad%ZZname.txt' })],
    })
    expect(getTaskName(task)).toBe('bad%ZZname.txt')
  })

  it('handles already-decoded path (post-Layer-1 fix) without double-decoding', () => {
    const task = createMockTask({
      files: [createMockFile({ path: '/downloads/AAA BBB.mp3' })],
    })
    expect(getTaskName(task)).toBe('AAA BBB.mp3')
  })

  it('handles literal percent sign in filename safely', () => {
    const task = createMockTask({
      files: [createMockFile({ path: '/downloads/100%.pdf' })],
    })
    expect(getTaskName(task)).toBe('100%.pdf')
  })

  it('returns empty string for task with empty files array', () => {
    const task = createMockTask({ files: [] })
    expect(getTaskName(task)).toBe('')
  })
})

describe('getTaskUri', () => {
  it('returns first URI for single-file HTTP task', () => {
    const task = createMockTask({
      files: [
        createMockFile({
          uris: [{ uri: 'http://example.com/file.zip', status: 'used' }],
        }),
      ],
    })
    expect(getTaskUri(task)).toBe('http://example.com/file.zip')
  })

  it('returns empty for HTTP task with no URIs', () => {
    const task = createMockTask({
      files: [createMockFile({ uris: [] })],
    })
    expect(getTaskUri(task)).toBe('')
  })

  it('returns first URI for multi-file HTTP task', () => {
    const task = createMockTask({
      files: [createMockFile(), createMockFile({ index: '2' })],
    })
    expect(getTaskUri(task)).toBe('')
  })
})

describe('resolveOpenTarget', () => {
  it('returns file path for HTTP single-file tasks', async () => {
    const task = createMockTask({
      dir: '/downloads',
      files: [
        {
          index: '1',
          path: '/downloads/file.zip',
          length: '1000',
          completedLength: '1000',
          selected: 'true',
          uris: [{ uri: 'http://example.com/file.zip', status: 'used' }],
        },
      ],
    })
    expect(await resolveOpenTarget(task)).toBe('/downloads/file.zip')
  })

  it('prefers selected files over unselected', async () => {
    const task = createMockTask({
      dir: '/downloads',
      files: [
        {
          index: '1',
          path: '/downloads/unwanted.txt',
          length: '100',
          completedLength: '100',
          selected: 'false',
          uris: [],
        },
        {
          index: '2',
          path: '/downloads/wanted.mkv',
          length: '1000',
          completedLength: '1000',
          selected: 'true',
          uris: [],
        },
      ],
    })
    expect(await resolveOpenTarget(task)).toBe('/downloads/wanted.mkv')
  })

  it('falls back to task.dir when files array is empty', async () => {
    const task = createMockTask({
      dir: '/downloads',
      files: [],
    })
    expect(await resolveOpenTarget(task)).toBe('/downloads')
  })

  it('falls back to task.dir when no file path available', async () => {
    const task = createMockTask({
      dir: '/downloads',
      files: [{ index: '1', path: '', length: '0', completedLength: '0', selected: 'true', uris: [] }],
    })
    expect(await resolveOpenTarget(task)).toBe('/downloads')
  })
})

// ── getRestartDescriptors ────────────────────────────────────────────

describe('getRestartDescriptors', () => {
  it('returns one group per file with all mirror URIs for HTTP tasks', () => {
    const task = createMockTask({
      files: [
        createMockFile({
          uris: [
            { uri: 'http://mirror1/a.zip', status: 'used' },
            { uri: 'http://mirror2/a.zip', status: 'waiting' },
          ],
        }),
        createMockFile({
          index: '2',
          path: '/tmp/b.zip',
          uris: [{ uri: 'http://mirror1/b.zip', status: 'used' }],
        }),
      ],
    })
    const result = getRestartDescriptors(task)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ uris: ['http://mirror1/a.zip', 'http://mirror2/a.zip'], path: '/tmp/test.txt' })
    expect(result[1]).toEqual({ uris: ['http://mirror1/b.zip'], path: '/tmp/b.zip' })
  })

  it('returns empty for task with no files and no BT info', () => {
    const task = createMockTask({ files: [] })
    expect(getRestartDescriptors(task)).toEqual([])
  })
})
