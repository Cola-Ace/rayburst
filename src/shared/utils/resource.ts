/** @fileoverview Clipboard resource detection and protocol filtering. */
import { RESOURCE_TAGS, DETECT_RESOURCE_MAX_CHARS, DETECT_RESOURCE_MAX_LINES } from '@shared/constants'
import { parseAria2Input } from './batchHelpers'
import type { ClipboardConfig } from '@shared/types'

/**
 * Builds the list of allowed protocol prefixes based on a ClipboardConfig filter.
 * Without a filter, includes all recognized protocol tags.
 */
function buildAllowedTags(filter?: ClipboardConfig): string[] {
  if (!filter) return RESOURCE_TAGS

  const tags: string[] = []
  if (filter.http) {
    tags.push('http://', 'https://')
  }
  if (filter.sftp) {
    tags.push('sftp://')
  }
  if (filter.thunder) {
    tags.push('thunder://')
  }
  return tags
}

const WEB_PAGE_EXTENSIONS = new Set([
  'html',
  'htm',
  'xhtml',
  'shtml',
  'php',
  'asp',
  'aspx',
  'jsp',
  'jspx',
  'cfm',
  'cgi',
  'do',
  'action',
])

/** Whether an HTTP(S) URL names a file rather than a web page: its last path segment has a non-page extension. */
export function isLikelyFileUrl(url: string): boolean {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return false
  }
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(path.slice(path.lastIndexOf('/') + 1))?.[1]
  return !!extension && !WEB_PAGE_EXTENSIONS.has(extension.toLowerCase())
}

function lineMatchesAllowedResource(line: string, allowedTags: string[], httpFilesOnly = false): boolean {
  const lower = line.toLowerCase()
  if (httpFilesOnly && /^https?:\/\//.test(lower) && !isLikelyFileUrl(line)) return false
  return allowedTags.some((tag) => lower.startsWith(tag) && line.length > tag.length)
}

function lineMatchesAnyResource(line: string): boolean {
  return lineMatchesAllowedResource(line, RESOURCE_TAGS)
}

function countMeaningfulInputLines(content: string): number {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')).length
}

export const detectResource = (content: string, filter?: ClipboardConfig): boolean => {
  if (filter && !filter.enable) return false
  if (!content || content.length > DETECT_RESOURCE_MAX_CHARS) return false

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0 || lines.length > DETECT_RESOURCE_MAX_LINES) return false

  const allowedTags = buildAllowedTags(filter)
  const httpFilesOnly = filter?.httpFilesOnly ?? false

  if (lines.length === 1) return lineMatchesAllowedResource(lines[0], allowedTags, httpFilesOnly)

  const parsed = parseAria2Input(content)
  if (parsed.entries.length === 0) return false

  if (parsed.validLineCount !== countMeaningfulInputLines(content)) return false

  return parsed.entries.every(
    (entry) =>
      entry.uris.length > 0 &&
      entry.uris.every(
        (uri) => lineMatchesAnyResource(uri) && (!httpFilesOnly || !/^https?:\/\//i.test(uri) || isLikelyFileUrl(uri)),
      ),
  )
}
