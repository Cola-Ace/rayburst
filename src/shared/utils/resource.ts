/** @fileoverview Download resource detection. */
import { RESOURCE_TAGS, DETECT_RESOURCE_MAX_CHARS, DETECT_RESOURCE_MAX_LINES } from '@shared/constants'
import { parseAria2Input } from './batchHelpers'

function lineMatchesAnyResource(line: string): boolean {
  return RESOURCE_TAGS.some((tag) => line.toLowerCase().startsWith(tag) && line.length > tag.length)
}

function countMeaningfulInputLines(content: string): number {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')).length
}

export const detectResource = (content: string): boolean => {
  if (!content || content.length > DETECT_RESOURCE_MAX_CHARS) return false

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0 || lines.length > DETECT_RESOURCE_MAX_LINES) return false

  if (lines.length === 1) return lineMatchesAnyResource(lines[0])

  const parsed = parseAria2Input(content)
  if (parsed.entries.length === 0) return false

  if (parsed.validLineCount !== countMeaningfulInputLines(content)) return false

  return parsed.entries.every((entry) => entry.uris.length > 0 && entry.uris.every(lineMatchesAnyResource))
}
