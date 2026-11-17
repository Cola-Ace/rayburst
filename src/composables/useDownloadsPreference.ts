/**
 * @fileoverview Pure functions for the Downloads preference tab.
 *
 * Manages: download paths and disk allocation, task concurrency, retry/recovery,
 * speed limits, task actions, automation, and auto-cleanup. This is the core download
 * experience tab — most fields map to aria2 engine options.
 */
import type { AppConfig, FileCategory, FileDeletionMode } from '@shared/types'
import { DEFAULT_APP_CONFIG as D, buildDefaultCategories, COMPLETED_RECORD_RETENTION_OPTIONS } from '@shared/constants'
import { normalizeFileCategory } from '@shared/utils/fileCategory'

// ── Types ───────────────────────────────────────────────────────────

export interface DownloadsForm {
  [key: string]: unknown
  dir: string
  rememberSaveLocation: boolean
  fileCategoryEnabled: boolean
  fileCategories: FileCategory[]
  maxConcurrentDownloads: number
  streamMaxConnections: number
  maxTries: number
  retryWait: number
  remoteTime: boolean
  fileAllocation: string
  incompleteSuffix: AppConfig['incompleteSuffix']
  maxOverallDownloadLimit: string
  speedScheduleEnabled: boolean
  speedScheduleFrom: string
  speedScheduleTo: string
  speedScheduleDays: number
  mediaSelectBeforeDownload: boolean
  mediaDefaultFormat: 'mp4' | 'mkv'
  newTaskShowDownloading: boolean
  noConfirmBeforeDeleteTask: boolean
  fileDeletionMode: FileDeletionMode
  deleteFilesWhenSkipConfirm: boolean
  shutdownWhenComplete: boolean
  keepAwake: boolean
  postDownloadProgram: string
  postDownloadArguments: string
  autoDeleteStaleRecords: boolean
  clearCompletedOnExit: boolean
  completedRecordRetentionDays: number
  removeCompletedRecords: boolean
}

// ── Pure Functions ──────────────────────────────────────────────────

/**
 * Builds the downloads form state from the preference store config.
 * All fallback values reference DEFAULT_APP_CONFIG (single source of truth).
 */
export function buildDownloadsForm(config: AppConfig, defaultDir: string = ''): DownloadsForm {
  return {
    dir: config.dir || defaultDir,
    rememberSaveLocation: config.rememberSaveLocation ?? D.rememberSaveLocation,
    fileCategoryEnabled: config.fileCategoryEnabled ?? D.fileCategoryEnabled,
    fileCategories:
      config.fileCategories && config.fileCategories.length > 0
        ? config.fileCategories.map(normalizeFileCategory)
        : buildDefaultCategories(),
    maxConcurrentDownloads: config.maxConcurrentDownloads ?? D.maxConcurrentDownloads,
    streamMaxConnections: config.streamMaxConnections ?? D.streamMaxConnections,
    maxTries: config.maxTries ?? D.maxTries,
    retryWait: config.retryWait ?? D.retryWait,
    remoteTime: config.remoteTime ?? D.remoteTime,
    fileAllocation: config.fileAllocation ?? D.fileAllocation,
    incompleteSuffix: config.incompleteSuffix ?? D.incompleteSuffix,
    maxOverallDownloadLimit: String(config.maxOverallDownloadLimit ?? D.maxOverallDownloadLimit),
    speedScheduleEnabled: config.speedScheduleEnabled ?? D.speedScheduleEnabled,
    speedScheduleFrom: config.speedScheduleFrom ?? D.speedScheduleFrom,
    speedScheduleTo: config.speedScheduleTo ?? D.speedScheduleTo,
    speedScheduleDays: config.speedScheduleDays ?? D.speedScheduleDays,
    mediaSelectBeforeDownload: config.mediaSelectBeforeDownload ?? D.mediaSelectBeforeDownload,
    mediaDefaultFormat: config.mediaDefaultFormat ?? D.mediaDefaultFormat,
    newTaskShowDownloading: config.newTaskShowDownloading ?? D.newTaskShowDownloading,
    noConfirmBeforeDeleteTask: config.noConfirmBeforeDeleteTask ?? D.noConfirmBeforeDeleteTask,
    fileDeletionMode: config.fileDeletionMode ?? D.fileDeletionMode,
    deleteFilesWhenSkipConfirm: config.deleteFilesWhenSkipConfirm ?? D.deleteFilesWhenSkipConfirm,
    shutdownWhenComplete: config.shutdownWhenComplete ?? D.shutdownWhenComplete,
    keepAwake: config.keepAwake ?? D.keepAwake,
    postDownloadProgram: config.postDownloadProgram ?? D.postDownloadProgram,
    postDownloadArguments: config.postDownloadArguments ?? D.postDownloadArguments,
    autoDeleteStaleRecords: config.autoDeleteStaleRecords ?? false,
    clearCompletedOnExit: config.clearCompletedOnExit ?? false,
    completedRecordRetentionDays: config.completedRecordRetentionDays ?? D.completedRecordRetentionDays,
    removeCompletedRecords: config.removeCompletedRecords ?? D.removeCompletedRecords,
  }
}

/**
 * Converts the downloads form into aria2 system config key-value pairs.
 * Only engine-level download params; app-only keys (task actions, cleanup)
 * are excluded.
 */
export function buildDownloadsSystemConfig(f: DownloadsForm): Record<string, string> {
  return {
    dir: f.dir,
    'max-concurrent-downloads': String(f.maxConcurrentDownloads),
    split: String(f.streamMaxConnections),
    'max-connection-per-server': String(f.streamMaxConnections),
    'max-overall-download-limit': f.maxOverallDownloadLimit,
    'remote-time': String(!!f.remoteTime),
    'file-allocation': f.fileAllocation || D.fileAllocation,
    'incomplete-suffix': f.incompleteSuffix,
    'max-tries': String(f.maxTries),
    'retry-wait': String(f.retryWait),
  }
}

/**
 * Transforms the downloads form for store persistence.
 * Handles the fileCategories auto-populate guard.
 */
export function transformDownloadsForStore(f: DownloadsForm): Partial<AppConfig> {
  const data = { ...f } as Partial<AppConfig> & Record<string, unknown>

  // Guard: auto-populate default categories when classification is enabled but
  // the categories array is empty (edge case from GitHub issue #229).
  if (f.fileCategoryEnabled && (!f.fileCategories || f.fileCategories.length === 0)) {
    data.fileCategories = buildDefaultCategories()
  } else {
    data.fileCategories = f.fileCategories.map(normalizeFileCategory)
  }

  return data
}

export function recordDownloadsDirectory(f: DownloadsForm, recordDirectory: (directory: string) => void): void {
  const directory = f.dir.trim()
  if (!directory) return
  recordDirectory(directory)
}

export function getCompletedRecordRetentionSelectValue(days: number): number {
  return COMPLETED_RECORD_RETENTION_OPTIONS.includes(days as (typeof COMPLETED_RECORD_RETENTION_OPTIONS)[number])
    ? days
    : -1
}

export function resolveCompletedRecordRetentionDays(selectedValue: number, currentDays: number): number {
  if (selectedValue !== -1) return selectedValue
  return currentDays > 0 ? currentDays : 30
}
