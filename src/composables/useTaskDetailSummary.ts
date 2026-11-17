/** @fileoverview Type-aware task detail summaries for the drawer UI. */
import type { Aria2Task, Aria2File } from '@shared/types'
import type { I18nKey } from '@shared/i18nTypes'
import { bytesToSize } from '@shared/utils/format'
import { mediaDuration, mediaTrackLabel } from '@shared/utils/media'

export interface MediaDetailRow {
  key: string
  label: I18nKey
  value: string
}

/** Media contributes rows to the existing overview, never a second summary. */
export function buildMediaDetailRows(task: Aria2Task | null, locale: string): MediaDetailRow[] {
  const media = task?.media
  if (!task || !media || ['waiting', 'probing', 'awaiting-selection'].includes(media.state)) return []
  const rows: MediaDetailRow[] = []
  const labels = {
    video: 'media.video',
    audio: 'media.audio',
    subtitle: 'media.subtitles',
    muxed: 'media.video-audio',
  } as const
  for (const type of ['video', 'muxed', 'audio', 'subtitle'] as const) {
    const tracks = media.tracks.filter((track) => track.selected === 'true' && track.type === type)
    if (tracks.length)
      rows.push({
        key: type,
        label: labels[type],
        value: tracks.map((track) => mediaTrackLabel(track, locale)).join('; '),
      })
  }
  if (Number(media.completedDuration) > 0) {
    rows.push({
      key: 'duration',
      label: media.live === 'true' ? 'media.duration' : 'task.sort-progress',
      value:
        media.live !== 'true' && Number(media.duration) > 0
          ? `${mediaDuration(media.completedDuration)} / ${mediaDuration(media.duration)}`
          : mediaDuration(media.completedDuration),
    })
  }
  if (task.status === 'active' && media.state !== 'finalizing')
    rows.push({ key: 'speed', label: 'task.task-download-speed', value: `${bytesToSize(task.downloadSpeed)}/s` })
  if (Number(media.downloadedLength) > 0)
    rows.push({ key: 'received', label: 'media.received', value: bytesToSize(media.downloadedLength) })
  return rows
}

export type TaskDetailKind = 'uri' | 'media'

export interface UriDetailSummary {
  primaryUri: string
  fileCount: number
  selectedFileCount: number
  mirrorCount: number
  usedMirrorCount: number
  waitingMirrorCount: number
}

export function getTaskDetailStatusLabelKey(status: string | undefined): string {
  return `task.status-${status}`
}

export function buildTaskDetailKind(task: Aria2Task | null | undefined): TaskDetailKind {
  if (task?.media) return 'media'
  return 'uri'
}

function selectedFiles(files: Aria2File[]): Aria2File[] {
  return files.filter((file) => file.selected === 'true')
}

export function buildUriDetailSummary(task: Aria2Task | null | undefined): UriDetailSummary {
  const files = task?.files ?? []
  const uris = files.flatMap((file) => file.uris ?? [])
  return {
    primaryUri: uris[0]?.uri ?? '',
    fileCount: files.length,
    selectedFileCount: selectedFiles(files).length,
    mirrorCount: uris.length,
    usedMirrorCount: uris.filter((uri) => uri.status === 'used').length,
    waitingMirrorCount: uris.filter((uri) => uri.status === 'waiting').length,
  }
}
