/**
 * @fileoverview Utilities for the batch add-task model.
 * Normalizes external inputs (deep links, drag-drop, file picker) into
 * BatchItem entries for the unified add-task dialog.
 */
import type { BatchItemKind, BatchItem } from '@shared/types'
import type { Aria2EngineOptions } from '@shared/types'
import sanitizeFilename from 'sanitize-filename'

let nextId = 0

/** Deterministic, incrementing ID for batch items. */
function genId(): string {
  return `batch-${++nextId}`
}

/** Gives an item built in another window an ID that is unique in this one. */
export function reissueBatchItem(item: BatchItem): BatchItem {
  return { ...item, id: genId() }
}

function toDisplayName(source: string, kind: BatchItemKind): string {
  if (kind === 'uri') {
    // Truncate long URIs for display
    return source.length > 80 ? source.substring(0, 77) + '...' : source
  }
  // File path — extract basename
  const sep = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'))
  return sep >= 0 ? source.substring(sep + 1) : source
}

/** Create a pending BatchItem from a raw input. Payload is set later for file-based items. */
export function createBatchItem(kind: BatchItemKind, source: string, payload = ''): BatchItem {
  return {
    id: genId(),
    kind,
    source,
    displayName: toDisplayName(source, kind),
    payload: payload || source, // URI items use source as payload
    status: 'pending',
  }
}

// ── URI normalization ───────────────────────────────────────────────

function normalizeUriLine(line: string): string {
  return line.trim()
}

function normalizeRawUriLine(line: string): string {
  return line.trim()
}

export interface Aria2InputEntry {
  uris: string[]
  options: Aria2EngineOptions
}

export interface ParsedAria2Input {
  entries: Aria2InputEntry[]
  validLineCount: number
}

function isAria2OptionLine(line: string): boolean {
  return line.startsWith(' ') || line.startsWith('\t')
}

function isAria2OptionAssignment(line: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]*=/.test(line)
}

function appendAria2Option(options: Aria2EngineOptions, rawLine: string): void {
  const line = rawLine.trim()
  const separator = line.indexOf('=')
  if (separator <= 0) return

  const key = line.slice(0, separator).trim()
  const value = line.slice(separator + 1)
  if (!key) return

  const existing = options[key]
  if (existing === undefined) {
    options[key] = value
  } else if (Array.isArray(existing)) {
    existing.push(value)
  } else {
    options[key] = [existing, value]
  }
}

function parseAria2UriLine(line: string): string[] {
  return line
    .split('\t')
    .map((part) => normalizeUriLine(part))
    .filter(Boolean)
}

function countLeadingSpaces(line: string): number {
  const match = line.match(/^[ \t]*/)
  return match ? match[0].length : 0
}

function trimCommonInputIndent(lines: string[]): string[] {
  const contentIndents = lines
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed && !trimmed.startsWith('#') && !isAria2OptionAssignment(trimmed)
    })
    .map(countLeadingSpaces)

  if (contentIndents.length === 0) return lines

  const commonIndent = Math.min(...contentIndents)
  if (commonIndent <= 0) return lines

  return lines.map((line) => line.slice(Math.min(commonIndent, countLeadingSpaces(line))))
}

/**
 * Parses aria2 input-file structure used by aria2-next:
 * - a non-indented line starts one task
 * - tab-separated URIs on that line are mirrors for the same task
 * - following space/tab-indented key=value lines are per-task options
 * - option validity is intentionally left to aria2-next
 */
export function parseAria2Input(text: string): ParsedAria2Input {
  const entries: Aria2InputEntry[] = []
  let current: Aria2InputEntry | null = null
  let validLineCount = 0

  for (const rawLine of trimCommonInputIndent(text.split('\n'))) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    if (isAria2OptionLine(rawLine) && isAria2OptionAssignment(trimmed)) {
      if (current) {
        appendAria2Option(current.options, rawLine)
        validLineCount++
      }
      continue
    }
    if (isAria2OptionLine(rawLine) && current) continue

    const uris = parseAria2UriLine(rawLine)
    if (uris.length === 0) continue
    current = { uris, options: {} }
    entries.push(current)
    validLineCount++
  }

  return { entries, validLineCount }
}

/**
 * Splits an input file's `out`, which aria2 lets name a path below `dir`
 * (#780), into those directories and the file name. Null when the path
 * would leave `dir` or no file system accepts one of its names.
 */
export function splitInputOut(out: string): { subdir: string[]; name: string } | null {
  const segments = out.split(/[\\/]/)
  if (segments.length === 1) return { subdir: [], name: out }
  if (/^[A-Za-z]:/.test(out) || segments[0] === '' || segments[segments.length - 1] === '') return null
  const parts = segments.filter((segment) => segment !== '.')
  if (parts.some((segment) => !segment || segment === '..' || /[\x00-\x1f<>:"|?*]/.test(segment))) return null
  const name = parts.pop() as string
  return { subdir: parts, name }
}

/** The first `out` in the input that `splitInputOut` refuses. */
export function invalidInputOut(text: string): string | undefined {
  return parseAria2Input(text)
    .entries.flatMap((entry) => [entry.options.out ?? []].flat())
    .find((out) => !splitInputOut(out))
}

/**
 * Leaves only the file name in `options.out` and returns the directories the
 * input file put before it, for `joinInputSubdir` once `dir` is final.
 */
export function takeInputSubdir(options: Record<string, unknown>): string[] {
  if (typeof options.out !== 'string') return []
  const split = splitInputOut(options.out)
  if (!split) throw new Error(`out=${options.out} must name a file inside the download directory`)
  options.out = split.name
  return split.subdir
}

/** `dir` with `subdir` appended, in the separator `dir` already uses. */
export function joinInputSubdir(dir: string, subdir: string[]): string {
  if (subdir.length === 0) return dir
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return [dir.replace(/[\\/]+$/, ''), ...subdir].join(separator)
}

export function normalizeUriLines(text: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of parseAria2Input(text).entries) {
    for (const line of entry.uris) {
      if (!seen.has(line)) {
        seen.add(line)
        result.push(line)
      }
    }
  }
  return result
}

/**
 * Merge URI lines for display/editing, trimming blanks and deduplicating exact lines.
 */
export function mergeRawUriLines(existingText: string, incoming: string[]): string {
  const existing = existingText.split('\n').map(normalizeRawUriLine).filter(Boolean)
  const seen = new Set(existing)
  for (const payload of incoming) {
    for (const raw of payload.split('\n')) {
      const line = normalizeRawUriLine(raw)
      if (line && !seen.has(line)) {
        seen.add(line)
        existing.push(line)
      }
    }
  }
  return existing.join('\n')
}

// ── Filename extraction and decoding ────────────────────────────────

/** ASCII control characters (0x00–0x1F, 0x7F) and C1 controls (0x80–0x9F). */
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f\x80-\x9f]/g

/** The engine's name limit in UTF-8 bytes; it leaves room for a numbered suffix. */
const MAX_FILENAME_BYTES = 240

/**
 * Removes characters no file system accepts and shortens the name to the
 * engine's limit, keeping the extension (`sanitize-filename` alone cuts at
 * 255 bytes, through the extension of a long multibyte name).
 */
export function safeFilename(name: string): string {
  const encoder = new TextEncoder()
  let fitted = name
  if (encoder.encode(fitted).length > MAX_FILENAME_BYTES) {
    const dot = fitted.lastIndexOf('.')
    const extension = dot > 0 && fitted.length - dot < 32 ? fitted.slice(dot) : ''
    const stem = Array.from(extension ? fitted.slice(0, dot) : fitted)
    const budget = MAX_FILENAME_BYTES - encoder.encode(extension).length
    let bytes = encoder.encode(stem.join('')).length
    while (stem.length > 0 && bytes > budget) bytes -= encoder.encode(stem.pop()).length
    fitted = stem.join('') + extension
  }
  return sanitizeFilename(fitted, { replacement: '_' })
}

function sanitizeFilenameSegment(name: string): string {
  const stripped = name.replace(CONTROL_CHAR_RE, '').replace(/[. ]+$/, '')
  const sanitized = safeFilename(stripped)
    .trim()
    .replace(/[. ]+$/, '')
  return sanitized && !/^\.+$/.test(sanitized) ? sanitized : ''
}

/**
 * Safely percent-decodes a single path segment.
 * Returns the original string if decoding fails (malformed % sequence).
 */
export function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function extractDecodedFilename(uri: string): string {
  if (/^(data|blob):/i.test(uri)) return ''
  let pathname: string
  try {
    pathname = new URL(uri).pathname
  } catch {
    // Malformed URI — attempt simple extraction
    pathname = uri.split('?')[0].split('#')[0]
  }

  const segments = pathname.split('/').filter(Boolean)
  const raw = segments.pop()
  if (!raw) return ''

  const decoded = decodePathSegment(raw)

  return sanitizeFilenameSegment(decoded)
}
