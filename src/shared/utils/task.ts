/** @fileoverview Task metadata operations: naming, progress, task links, and open targets. */
import { parseInt } from 'lodash-es'
import type { Aria2Task, Aria2File } from '@shared/types'
import { resolveTaskFilePath } from '@/composables/useTaskPaths'

/** Download progress as a percentage with one decimal, rounded down so it never reads 100 early. */
export const calcProgress = (totalLength: string | number, completedLength: string | number): number => {
  const total = parseInt(String(totalLength), 10)
  const completed = parseInt(String(completedLength), 10)
  if (total === 0 || completed === 0) return 0
  return Math.floor((completed / total) * 1000) / 10
}

const parseLength = (value: string | number | undefined): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export const getTaskCompletedLength = (task: Aria2Task): number => {
  return parseLength(task.completedLength)
}

const getFileNameFromFile = (file?: Aria2File): string => {
  if (!file) return ''
  const { path } = file
  if (path) {
    // Path is set — aria2 has resolved the filename (from Content-Disposition or URL).
    const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    if (idx <= 0 || idx === path.length) return path
    return path.substring(idx + 1)
  }
  // Path is empty: aria2 hasn't received the HTTP response yet.
  // Fall back to extracting from URI, but only for segments that look like filenames
  // (i.e., contain a dot/extension). Extensionless segments like "/download/sample/215"
  // are typically redirect stubs or API endpoints — return '' so the UI shows a
  // placeholder instead of a misleading name. aria2 will update the real filename
  // after receiving Content-Disposition or the final redirected URL.
  const uri = file.uris?.[0]?.uri
  if (!uri) return ''
  try {
    const segment = new URL(uri).pathname.split('/').filter(Boolean).pop() ?? ''
    if (!segment || !segment.includes('.')) return ''
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}

export const getTaskName = (task: Aria2Task | null, options: { defaultName?: string } = {}): string => {
  const { defaultName = '' } = options
  let result = defaultName
  if (!task) return result

  const { files } = task
  if (!files || files.length === 0) return result

  if (files.length === 1) {
    const name = getFileNameFromFile(files[0])
    result = name || result
  } else {
    // Multi-file HTTP: use first non-empty filename
    const firstName = files.map((f) => getFileNameFromFile(f)).find((n) => !!n)
    result = firstName || result
  }

  return result
}

export const getTaskUris = (task: Aria2Task): string[] => {
  const { files } = task
  if (!files || files.length === 0) return []
  const uris: string[] = []
  for (const file of files) {
    if (file.uris && file.uris.length > 0) {
      uris.push(file.uris[0].uri)
    }
  }
  return uris
}

export interface TaskRestartDescriptor {
  uris: string[]
  path?: string
}

export const getRestartDescriptors = (task: Aria2Task): TaskRestartDescriptor[] => {
  const { files } = task
  if (!files || files.length === 0) return []
  const descriptors: TaskRestartDescriptor[] = []
  for (const file of files) {
    if (file.uris && file.uris.length > 0) {
      const uniqueUris = [...new Set(file.uris.map((entry) => entry.uri.trim()).filter(Boolean))]
      if (uniqueUris.length > 0) descriptors.push({ uris: uniqueUris, path: file.path })
    }
  }
  return descriptors
}

export const getTaskUri = (task: Aria2Task): string => {
  const uris = getTaskUris(task)
  return uris.length > 0 ? uris[0] : ''
}

export const canRestart = (task: Aria2Task): boolean => {
  return getTaskUris(task).length > 0
}

export const resolveOpenTarget = async (task: Aria2Task): Promise<string> => {
  const { dir } = task
  const resolved = resolveTaskFilePath(task)
  if (resolved) return resolved

  // Fallback: open the download directory
  return dir
}

export { getFileNameFromFile }
