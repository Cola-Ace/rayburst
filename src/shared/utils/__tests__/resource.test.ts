import { describe, expect, it } from 'vitest'
import { detectResource } from '../resource'
import { DETECT_RESOURCE_MAX_CHARS, DETECT_RESOURCE_MAX_LINES } from '@shared/constants'
describe('Resource detection contract', () => {
  it.each(['https://example.com/file.zip', 'sftp://example.com/file.iso'])(
    'accepts supported resource %s',
    (resource) => {
      expect(detectResource(resource)).toBe(true)
    },
  )

  it.each([
    '',
    'Visit http://example.com for details',
    '[link](https://example.com)',
    'http://',
    'myapp://open?id=123',
    'thunder://QUFodHRwczovL2V4YW1wbGUuY29tL2ZpbGUuemlwWlo=',
  ])('rejects non-resource content %s', (content) => {
    expect(detectResource(content)).toBe(false)
  })

  it('accepts large URL batches within the documented limits', () => {
    const content = Array.from(
      { length: DETECT_RESOURCE_MAX_LINES },
      (_, index) => `https://cdn.example.com/package-${index}-release.zip`,
    ).join('\n')
    expect(content.length).toBeGreaterThan(2048)
    expect(detectResource(content)).toBe(true)
  })

  it('enforces resource input line and character limits', () => {
    const tooManyLines = Array.from(
      { length: DETECT_RESOURCE_MAX_LINES + 1 },
      (_, index) => `https://example.com/${index}`,
    ).join('\n')
    expect(detectResource(tooManyLines)).toBe(false)
    expect(detectResource(`https://example.com/${'a'.repeat(DETECT_RESOURCE_MAX_CHARS)}`)).toBe(false)
  })

  it('keeps valid multi-line aria2 input while rejecting mixed prose', () => {
    expect(detectResource('https://example.com/index.html\n  out=index.html')).toBe(true)
    expect(detectResource('download this file\nhttps://example.com/file.zip')).toBe(false)
  })
})
