import { describe, expect, it } from 'vitest'
import {
  createBatchItem,
  mergeRawUriLines,
  normalizeUriLines,
  decodePathSegment,
  extractDecodedFilename,
  invalidInputOut,
  joinInputSubdir,
  parseAria2Input,
  safeFilename,
  splitInputOut,
  takeInputSubdir,
} from '../batchHelpers'

describe('normalizeUriLines', () => {
  it('splits lines, trims whitespace, drops blanks, and preserves first occurrence order', () => {
    expect(
      normalizeUriLines(`
        https://a.example/file
        https://b.example/file.zip

        https://a.example/file
        thunder://foo
      `),
    ).toEqual(['https://a.example/file', 'https://b.example/file.zip', 'thunder://foo'])
  })

  it('handles multiline payload text exactly like a textarea source', () => {
    expect(normalizeUriLines('https://a.example/file\nhttps://b.example/file\nhttps://a.example/file\n')).toEqual([
      'https://a.example/file',
      'https://b.example/file',
    ])
  })

  it('does NOT convert strings of wrong length (39 chars)', () => {
    const short = 'd8988e034cb5de79d319242e3365bf30a7741a6'
    expect(normalizeUriLines(short)).toEqual([short])
  })

  it('does NOT convert strings of wrong length (41 chars)', () => {
    const long = 'd8988e034cb5de79d319242e3365bf30a7741a6ef'
    expect(normalizeUriLines(long)).toEqual([long])
  })

  it('keeps Thunder links wrapped for engine parsing', () => {
    const thunder = 'thunder://' + btoa('AAhttps://example.com/file.zipZZ')
    expect(normalizeUriLines(thunder)).toEqual([thunder])
  })

  it('keeps mixed-case Thunder schemes wrapped for engine parsing', () => {
    const thunder = 'Thunder://' + btoa('AAhttps://example.com/file.zipZZ')
    expect(normalizeUriLines(thunder)).toEqual([thunder])
  })

  it('deduplicates Thunder links by exact normalized line', () => {
    const thunder = 'thunder://' + btoa('AAhttps://example.com/file.zipZZ')
    expect(normalizeUriLines(`${thunder}\n${thunder}`)).toEqual([thunder])
  })
})

describe('parseAria2Input', () => {
  it('parses aria2 input-file entries with per-task options', () => {
    expect(
      parseAria2Input(`
        https://example.com/index.html
          out=index1.html
        https://example.com/index.html
          out=index2.html
      `).entries,
    ).toEqual([
      { uris: ['https://example.com/index.html'], options: { out: 'index1.html' } },
      { uris: ['https://example.com/index.html'], options: { out: 'index2.html' } },
    ])
  })

  it('keeps tab-separated mirrors as one aria2 task', () => {
    expect(
      parseAria2Input('https://mirror-a.example/file.zip\thttps://mirror-b.example/file.zip\n  out=file.zip').entries,
    ).toEqual([
      {
        uris: ['https://mirror-a.example/file.zip', 'https://mirror-b.example/file.zip'],
        options: { out: 'file.zip' },
      },
    ])
  })

  it('keeps cumulative header options in input order', () => {
    expect(
      parseAria2Input(
        [
          'https://example.com/file.zip',
          '  header=Accept-Language: en-US,en;q=0.9',
          '  header=Cookie: a=b',
          '  checksum=sha-256=abc',
        ].join('\n'),
      ).entries,
    ).toEqual([
      {
        uris: ['https://example.com/file.zip'],
        options: {
          header: ['Accept-Language: en-US,en;q=0.9', 'Cookie: a=b'],
          checksum: 'sha-256=abc',
        },
      },
    ])
  })

  it('does not treat orphan option lines as URIs', () => {
    expect(parseAria2Input('  out=orphan.html\nhttps://example.com/file.zip').entries).toEqual([
      { uris: ['https://example.com/file.zip'], options: {} },
    ])
  })

  it('ignores malformed indented option lines after a task', () => {
    expect(parseAria2Input('https://example.com/file.zip\n  malformed-option-line').entries).toEqual([
      { uris: ['https://example.com/file.zip'], options: {} },
    ])
  })
})

describe('input file out paths', () => {
  it('splits the directories below dir from the file name', () => {
    expect(splitInputOut('game.rar')).toEqual({ subdir: [], name: 'game.rar' })
    expect(splitInputOut('phantom/./disc 1\\game.part01.rar')).toEqual({
      subdir: ['phantom', 'disc 1'],
      name: 'game.part01.rar',
    })
  })

  it('refuses a path that leaves dir or names nothing', () => {
    for (const out of [
      '../game.rar',
      'a/../../game.rar',
      '/etc/game',
      'C:/game.rar',
      '\\\\host\\game',
      'a//b',
      'dir/',
    ]) {
      expect(splitInputOut(out), out).toBeNull()
    }
    expect(splitInputOut('a:b/c')).toBeNull()
  })

  it('reports the first refused out in the input', () => {
    const text = 'https://a.example/1\n  out=ok/1.rar\nhttps://a.example/2\n  out=../2.rar\n'
    expect(invalidInputOut(text)).toBe('../2.rar')
    expect(invalidInputOut('https://a.example/1\n  out=ok/1.rar')).toBeUndefined()
  })

  it('moves the directories into dir in its own separator', () => {
    const options: Record<string, unknown> = { out: 'phantom/game.part01.rar' }
    const subdir = takeInputSubdir(options)
    expect(options.out).toBe('game.part01.rar')
    expect(joinInputSubdir('D:\\Downloads\\', subdir)).toBe('D:\\Downloads\\phantom')
    expect(joinInputSubdir('/home/me/Downloads', subdir)).toBe('/home/me/Downloads/phantom')
    expect(joinInputSubdir('/home/me', [])).toBe('/home/me')
    expect(() => takeInputSubdir({ out: '../x' })).toThrow()
  })
})

describe('mergeRawUriLines', () => {
  it('keeps Thunder links raw while still trimming blanks and deduplicating exact lines', () => {
    const thunder = 'thunder://' + btoa('AAhttps://example.com/file.zipZZ')

    expect(mergeRawUriLines('', [` ${thunder} \n\n${thunder}`])).toBe(thunder)
  })
})

// ── detectKind ────────────────────────────────────────────────────────
// Scheme-first → remote URI download → local path suffix → fallback.

describe('createBatchItem', () => {
  it('uses source as payload for uri items', () => {
    const item = createBatchItem('uri', 'https://b.example/file.zip')
    expect(item.payload).toBe('https://b.example/file.zip')
  })

  it('assigns distinct IDs to separate items', () => {
    const a = createBatchItem('uri', 'https://a.example/file')
    const b = createBatchItem('uri', 'https://b.example/file')
    expect(a.id).not.toBe(b.id)
  })
})

// ── decodePathSegment ─────────────────────────────────────────────────

describe('decodePathSegment', () => {
  it('decodes percent-encoded spaces', () => {
    expect(decodePathSegment('AAA%20BBB')).toBe('AAA BBB')
  })

  it('decodes UTF-8 percent sequences', () => {
    expect(decodePathSegment('r%C3%A9sum%C3%A9')).toBe('résumé')
  })

  it('returns original string for malformed percent sequence', () => {
    expect(decodePathSegment('bad%ZZname')).toBe('bad%ZZname')
  })

  it('returns unencoded strings unchanged', () => {
    expect(decodePathSegment('normal.txt')).toBe('normal.txt')
  })

  it('returns empty string for empty input', () => {
    expect(decodePathSegment('')).toBe('')
  })

  it('handles string with only a percent sign', () => {
    // '%' alone is malformed, decodeURIComponent throws → returns original
    expect(decodePathSegment('%')).toBe('%')
  })
})

// ── extractDecodedFilename ────────────────────────────────────────────

describe('extractDecodedFilename', () => {
  it('decodes percent-encoded spaces in HTTP URIs', () => {
    expect(extractDecodedFilename('http://example.com/AAA%20BBB.mp3')).toBe('AAA BBB.mp3')
  })

  it('decodes UTF-8 percent sequences', () => {
    expect(extractDecodedFilename('http://example.com/file-r%C3%A9sum%C3%A9.txt')).toBe('file-résumé.txt')
  })

  it('returns unencoded filename unchanged', () => {
    expect(extractDecodedFilename('http://example.com/plain.zip')).toBe('plain.zip')
  })

  it('strips query string and fragment before extracting', () => {
    expect(extractDecodedFilename('http://example.com/file.zip?v=1&t=2#section')).toBe('file.zip')
  })

  it('handles deep paths and extracts only the last segment', () => {
    expect(extractDecodedFilename('https://cdn.example.com/a/b/c/deep%20file.tar.gz')).toBe('deep file.tar.gz')
  })

  it('sanitizes decoded forward slashes to underscores (path traversal defense)', () => {
    expect(extractDecodedFilename('http://example.com/a%2Fb.txt')).toBe('a_b.txt')
  })

  it('sanitizes Windows-unsafe characters to underscores', () => {
    expect(extractDecodedFilename('http://example.com/a%3Ab%2Ac.txt')).toBe('a_b_c.txt')
  })

  it('returns empty string for trailing-slash URIs (no filename)', () => {
    expect(extractDecodedFilename('http://example.com/')).toBe('')
  })

  it('returns empty string for bare domain URIs', () => {
    expect(extractDecodedFilename('http://example.com')).toBe('')
  })

  it('returns empty string for data URIs', () => {
    expect(extractDecodedFilename('data:text/plain;base64,SGVsbG8=')).toBe('')
  })

  it('returns original segment for malformed percent sequence', () => {
    expect(extractDecodedFilename('http://example.com/bad%ZZname.txt')).toBe('bad%ZZname.txt')
  })

  it('handles SFTP URIs', () => {
    expect(extractDecodedFilename('sftp://files.example.com/pub/file%20name.tar.gz')).toBe('file name.tar.gz')
  })

  it('returns empty string for blob URIs', () => {
    expect(extractDecodedFilename('blob:http://example.com/abc-123')).toBe('')
  })

  it('preserves plus signs (not decoded as spaces in path segments)', () => {
    // Plus in URL path is a literal +, not a space (RFC 3986)
    expect(extractDecodedFilename('http://example.com/file+name.zip')).toBe('file+name.zip')
  })

  it('handles double-encoded sequences by decoding only once', () => {
    // %2520 → first decode → %20 (the literal string %20, not a space)
    expect(extractDecodedFilename('http://example.com/file%2520name.zip')).toBe('file%20name.zip')
  })

  it('handles HTTPS with port number', () => {
    expect(extractDecodedFilename('https://cdn.example.com:8443/path/file%20name.zip')).toBe('file name.zip')
  })

  it('handles already-decoded filenames without re-encoding', () => {
    expect(extractDecodedFilename('http://example.com/already decoded.zip')).toBe('already decoded.zip')
  })

  it('rejects filenames that are only dots', () => {
    expect(extractDecodedFilename('http://example.com/..')).toBe('')
    expect(extractDecodedFilename('http://example.com/.')).toBe('')
  })

  it('sanitizes backslash in decoded filename', () => {
    // %5C = backslash
    expect(extractDecodedFilename('http://example.com/path%5Cfile.txt')).toBe('path_file.txt')
  })
})

// ── sanitizeAria2OutHint ─────────────────────────────────────────────
// Pure filesystem safety — no business logic. Any out value (user-typed
// or extension-provided) is safe to pass through this function.

describe('safeFilename', () => {
  it('keeps the extension of a long multibyte name', () => {
    const name = `${'附件'.repeat(60)}.rar`
    const safe = safeFilename(name)
    expect(safe.endsWith('.rar')).toBe(true)
    expect(new TextEncoder().encode(safe).length).toBeLessThanOrEqual(240)
  })

  it('leaves short names and keeps characters whole', () => {
    expect(safeFilename('report:v2.pdf')).toBe('report_v2.pdf')
    const emoji = safeFilename(`${'😀'.repeat(70)}.zip`)
    expect(emoji).toMatch(/^(😀)+\.zip$/u)
  })

  it('extracts a long encoded URL name with its extension', () => {
    const url = `https://example.com/files/${encodeURIComponent('长文件名'.repeat(30))}.rar?token=${'x'.repeat(500)}`
    expect(extractDecodedFilename(url).endsWith('.rar')).toBe(true)
  })
})
