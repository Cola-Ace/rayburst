/** @fileoverview Shared task-card display model for full and compact task rows. */
import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { mediaPercent, mediaDuration, mediaStateLabel } from '@shared/utils/media'
import { TASK_STATUS } from '@shared/constants'
import {
  bytesToSize,
  calcProgress,
  getTaskCompletedLength,
  getTaskName,
  timeFormat,
  timeRemaining,
} from '@shared/utils'
import type { Aria2Task } from '@shared/types'

export interface TaskCardStatusBadge {
  key: string
  label: string
  tone: 'success' | 'error' | 'muted' | 'waiting'
}

interface TaskCardModel {
  taskFullName: ComputedRef<string>
  statusBadge: ComputedRef<TaskCardStatusBadge | null>
  taskStatus: ComputedRef<string>
  isActive: ComputedRef<boolean>
  completedLengthValue: ComputedRef<number>
  indeterminate: ComputedRef<boolean>
  percent: ComputedRef<number>
  completedSize: ComputedRef<string>
  totalSize: ComputedRef<string>
  hasSizeInfo: ComputedRef<boolean>
  downloadSpeed: ComputedRef<string>
  remaining: ComputedRef<number>
  remainingText: ComputedRef<string>
}

export function useTaskCardModel(task: ComputedRef<Aria2Task>): TaskCardModel {
  const { t } = useI18n()

  const taskFullName = computed(() => getTaskName(task.value, { defaultName: t('task.get-task-name') || 'Unknown' }))
  const taskStatus = computed(() => task.value.status)
  const statusBadge = computed<TaskCardStatusBadge | null>(() => {
    if (task.value.media) {
      const media = task.value.media
      return {
        key: media.state,
        label: t(mediaStateLabel[media.state]),
        tone: task.value.status === 'error' ? 'error' : task.value.status === 'complete' ? 'success' : 'waiting',
      }
    }
    switch (task.value.status) {
      case TASK_STATUS.WAITING:
        return { key: TASK_STATUS.WAITING, label: t('task.status-waiting') || 'Queued', tone: 'waiting' }
      case TASK_STATUS.COMPLETE:
        return { key: TASK_STATUS.COMPLETE, label: t('task.task-complete') || 'Completed', tone: 'success' }
      case TASK_STATUS.ERROR:
        return { key: TASK_STATUS.ERROR, label: t('task.task-error') || 'Error', tone: 'error' }
      case TASK_STATUS.REMOVED:
        return { key: TASK_STATUS.REMOVED, label: t('task.task-removed') || 'Removed', tone: 'muted' }
      default:
        return null
    }
  })
  const isActive = computed(() => task.value.status === TASK_STATUS.ACTIVE)
  const displayedTotalLength = computed(() => Number(task.value.totalLength) || 0)
  const completedLengthValue = computed(() => getTaskCompletedLength(task.value))
  const indeterminate = computed(() => Boolean(task.value.media) && mediaPercent(task.value) === null)
  const percent = computed(() =>
    task.value.media
      ? (mediaPercent(task.value) ?? 0)
      : calcProgress(displayedTotalLength.value, completedLengthValue.value),
  )
  const completedSize = computed(() =>
    task.value.media && task.value.status !== 'complete'
      ? mediaDuration(task.value.media.completedDuration)
      : bytesToSize(completedLengthValue.value, 2),
  )
  const totalSize = computed(() =>
    task.value.media && task.value.status !== 'complete'
      ? task.value.media.live === 'true'
        ? t('media.live')
        : mediaDuration(task.value.media.duration)
      : bytesToSize(displayedTotalLength.value, 2),
  )
  const hasSizeInfo = computed(() =>
    task.value.media
      ? !['waiting', 'probing', 'awaiting-selection'].includes(task.value.media.state)
      : completedLengthValue.value > 0 || displayedTotalLength.value > 0,
  )
  const downloadSpeed = computed(() => bytesToSize(task.value.downloadSpeed))
  const remaining = computed(() => {
    if (!isActive.value || task.value.media) return 0
    return timeRemaining(displayedTotalLength.value, completedLengthValue.value, Number(task.value.downloadSpeed))
  })
  const remainingText = computed(() => {
    if (remaining.value <= 0) return ''
    return timeFormat(remaining.value, {
      prefix: t('task.remaining-prefix') || '',
      i18n: {
        gt1d: t('app.gt1d') || '>1d',
        hour: t('app.hour') || 'h',
        minute: t('app.minute') || 'm',
        second: t('app.second') || 's',
      },
    })
  })

  return {
    taskFullName,
    statusBadge,
    taskStatus,
    isActive,
    completedLengthValue,
    indeterminate,
    percent,
    completedSize,
    totalSize,
    hasSizeInfo,
    downloadSpeed,
    remaining,
    remainingText,
  }
}
