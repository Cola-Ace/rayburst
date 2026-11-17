/** @fileoverview Pure utilities for persisted task reconstruction.
 *
 * Restores history records into task models and supports cleanup logic.
 */
import type { Aria2Task, Aria2File, HistoryRecord, HistoryMeta } from '@shared/types'

// ── Centralized history snapshot helpers ────────────────────────────
// All meta read/write MUST go through these functions. Never JSON.parse
// HistoryRecord.meta directly in consumer code.

/** Parse structured meta from a persisted history record (read path).
 *  Never throws — returns empty object on corrupt/missing meta. */
export function parseHistoryMeta(record: HistoryRecord): HistoryMeta {
  if (!record.meta) return {}
  try {
    return JSON.parse(record.meta) as HistoryMeta
  } catch {
    return {}
  }
}

/** Extract all expected file paths from a history record.
 *
 * Used by stale cleanup to check whether downloaded files still exist.
 * Multi-file records return all paths; legacy single-file records return
 * a single synthetic path from dir + name. */
export function extractHistoryFilePaths(record: HistoryRecord): string[] {
  const meta = parseHistoryMeta(record)
  if (meta.files && meta.files.length > 0) {
    return meta.files.map((f) => f.path).filter(Boolean)
  }
  // Legacy fallback: single file path from dir + name
  if (record.dir && record.name) {
    const dir = record.dir.replace(/[\\/]+$/, '')
    return [`${dir}/${record.name}`]
  }
  return []
}

export function historyRecordToTask(record: HistoryRecord): Aria2Task {
  const dir = record.dir ?? ''
  const totalLength = String(record.total_length ?? 0)
  const meta = parseHistoryMeta(record)
  const completedLength = meta.completedLength ?? (record.status === 'complete' ? totalLength : '0')

  // Build files array: prefer multi-file snapshot from meta.files,
  // fall back to a single-file synthesis when no snapshot is available.
  let files: Aria2File[]
  if (meta.files && meta.files.length > 0) {
    // Full restoration from snapshot — preserves all paths, lengths, and mirror URIs.
    files = meta.files.map((f, i) => ({
      index: f.index ?? String(i + 1),
      path: f.path,
      length: f.length ?? '0',
      completedLength: f.completedLength ?? '0',
      selected: f.selected ?? 'true',
      uris: f.uris.map((uri) => ({ uri, status: 'used' as const })),
    }))
  } else {
    // Single-file fallback — path is dir + separator + name.
    // dir may end with `\\` (Windows) or `/` (Unix); avoid double separators.
    const filePath = dir && record.name ? `${dir.replace(/[\\/]+$/, '')}/${record.name}` : record.name
    const uris = record.uri ? [{ uri: record.uri, status: 'used' as const }] : []
    files = [{ index: '1', path: filePath, length: totalLength, completedLength, selected: 'true', uris }]
  }

  const task: Aria2Task = {
    media: meta.media,
    mediaOptions: meta.mediaOptions,
    gid: record.gid,
    status: record.status as Aria2Task['status'],
    totalLength,
    completedLength,
    downloadSpeed: '0',
    connections: '0',
    dir,
    files,
    errorCode: meta.errorCode,
    errorMessage: meta.errorMessage,
  }

  return task
}

/** Tasks restored from each record. The store keeps one record array until
 *  the history changes, so every snapshot reuses these instead of parsing the
 *  metadata of the whole history again. Frozen because they are shared. */
const restoredTasks = new WeakMap<HistoryRecord, Aria2Task>()

function restoredTask(record: HistoryRecord): Aria2Task {
  let task = restoredTasks.get(record)
  if (!task) {
    task = Object.freeze(historyRecordToTask(record))
    restoredTasks.set(record, task)
  }
  return task
}

/** Merge by task identity; the same content can belong to different downloads. */
export function mergeHistoryIntoTasks(aria2Tasks: Aria2Task[], historyRecords: HistoryRecord[]): Aria2Task[] {
  const gids = new Set(aria2Tasks.map((task) => task.gid))
  return [
    ...aria2Tasks,
    ...historyRecords
      .filter((record) => ['uri', 'media'].includes(record.task_type ?? 'uri') && !gids.has(record.gid))
      .map(restoredTask),
  ]
}
