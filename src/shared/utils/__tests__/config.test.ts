/** @fileoverview Tests for config utilities. */
import { describe, it, expect } from 'vitest'
import {
  changeKeysToCamelCase,
  changeKeysToKebabCase,
  diffConfig,
  checkIsNeedRestart,
  formatOptionsForEngine,
  filterHotReloadableKeys,
} from '../config'

describe('changeKeysToCamelCase', () => {
  it('converts kebab-case keys to camelCase', () => {
    expect(changeKeysToCamelCase({ 'max-speed': 100 })).toEqual({ maxSpeed: 100 })
  })
  it('returns empty for empty object', () => {
    expect(changeKeysToCamelCase({})).toEqual({})
  })
  it('returns empty for default parameter', () => {
    expect(changeKeysToCamelCase()).toEqual({})
  })
})

describe('changeKeysToKebabCase', () => {
  it('converts camelCase keys to kebab-case', () => {
    expect(changeKeysToKebabCase({ maxSpeed: 100 })).toEqual({ 'max-speed': 100 })
  })

  it('keeps Aria2 as one engine name prefix', () => {
    expect(changeKeysToKebabCase({ aria2LogLevel: 'warn' })).toEqual({ 'aria2-log-level': 'warn' })
  })
})

describe('diffConfig', () => {
  it('returns only changed keys', () => {
    const result = diffConfig({ a: 1, b: 2 }, { a: 1, b: 3 })
    expect(result).toEqual({ b: 3 })
  })
  it('returns empty for identical configs', () => {
    const result = diffConfig({ a: 1 }, { a: 1 })
    expect(result).toEqual({})
  })
  it('detects changed array values', () => {
    const result = diffConfig({ tags: ['a', 'b'] }, { tags: ['a', 'c'] })
    expect(result).toEqual({ tags: ['a', 'c'] })
  })
  it('returns empty for identical arrays', () => {
    const result = diffConfig({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })
    expect(result).toEqual({})
  })
  it('detects changed nested values', () => {
    const result = diffConfig({ proxy: { host: 'a' } }, { proxy: { host: 'b' } })
    expect(result).toEqual({ proxy: { host: 'b' } })
  })

  it('still detects genuinely different values across types', () => {
    const result = diffConfig({ listenPort: '29120' }, { listenPort: 21302 })
    expect(result).toEqual({ listenPort: 21302 })
  })
})

describe('checkIsNeedRestart', () => {
  it('returns false for empty changes', () => {
    expect(checkIsNeedRestart({})).toBe(false)
  })
  it('returns true for rpcListenPort', () => {
    expect(checkIsNeedRestart({ rpcListenPort: 6800 })).toBe(true)
  })
  it('returns true for rpcSecret', () => {
    expect(checkIsNeedRestart({ rpcSecret: 'new-secret-value' })).toBe(true)
  })
  it('returns false for non-restart keys', () => {
    expect(checkIsNeedRestart({ theme: 'dark' })).toBe(false)
  })
  it('detects restart key among multiple changes', () => {
    expect(checkIsNeedRestart({ theme: 'dark', rpcSecret: 'changed' })).toBe(true)
  })
})

describe('formatOptionsForEngine', () => {
  it('converts keys to kebab-case', () => {
    const result = formatOptionsForEngine({ maxSpeed: '100' })
    expect(result).toHaveProperty('max-speed')
  })
  it('joins arrays with newline', () => {
    const result = formatOptionsForEngine({ trackerSource: ['a', 'b'] })
    expect(result['tracker-source']).toBe('a\nb')
  })
  it('skips null and undefined values', () => {
    const result = formatOptionsForEngine({ a: undefined, b: null })
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('forwards empty-string values for aria2 options that intentionally accept them', () => {
    const result = formatOptionsForEngine({ userAgent: '', referer: '' })
    expect(result['user-agent']).toBe('')
    expect(result.referer).toBe('')
  })
  it('keeps numeric 0 value (converted to string)', () => {
    const result = formatOptionsForEngine({ shareTime: 0 })
    expect(result['share-time']).toBe('0')
  })
  it('converts boolean to string', () => {
    const result = formatOptionsForEngine({ checkIntegrity: true })
    expect(result['check-integrity']).toBe('true')
  })
})

describe('filterHotReloadableKeys', () => {
  it('passes through hot-reloadable keys unchanged', () => {
    const config = {
      'max-concurrent-downloads': '10',
      split: '16',
      'max-overall-download-limit': '0',
      dir: '/downloads',
    }
    expect(filterHotReloadableKeys(config)).toEqual(config)
  })

  it('strips aria2 changeGlobalOption exclusions', () => {
    const config = {
      checksum: 'sha-256=abc',
      'index-out': '0=file.txt',
      out: 'output.zip',
      pause: 'true',
      'select-file': '1-3',
    }
    expect(filterHotReloadableKeys(config)).toEqual({})
  })

  it('strips unsupported engine keys by allowlist', () => {
    const config = {
      'not-supported': 'true',
      'stale-local-key': 'false',
      'future-unknown-key': '203.0.113.1',
      'max-overall-download-limit': '1M',
    }
    expect(filterHotReloadableKeys(config)).toEqual({
      'max-overall-download-limit': '1M',
    })
  })

  it('returns empty for empty input', () => {
    expect(filterHotReloadableKeys({})).toEqual({})
  })

  it('separates hot-reloadable from non-hot-reloadable in mixed input', () => {
    const config = {
      'max-concurrent-downloads': '8',
      'allow-remote-access': 'true',
      'rpc-listen-port': '29100',
      'rpc-secret': 'secret',
      'user-agent': 'Rayburst/3.4.1',
    }
    expect(filterHotReloadableKeys(config)).toEqual({
      'max-concurrent-downloads': '8',
      'user-agent': 'Rayburst/3.4.1',
    })
  })
})
