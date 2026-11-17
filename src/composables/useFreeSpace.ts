/** @fileoverview Free space of the chosen download folder against the known download size. */
import { invoke } from '@tauri-apps/api/core'
import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { bytesToSize } from '@shared/utils'

export function useFreeSpace(folder: Ref<string>, size: Ref<number>) {
  const { t } = useI18n()
  const free = ref<number | null>(null)
  let latest = 0

  watch(
    folder,
    (path) => {
      const request = ++latest
      if (!path) {
        free.value = null
        return
      }
      invoke<number | null>('disk_free_space', { path })
        .then((bytes) => {
          if (request === latest) free.value = bytes
        })
        .catch(() => {
          if (request === latest) free.value = null
        })
    },
    { immediate: true },
  )

  const short = computed(() => free.value !== null && size.value > free.value)
  const text = computed(() => {
    if (free.value === null) return ''
    const values = { size: bytesToSize(size.value), free: bytesToSize(free.value) }
    if (short.value) return t('task.space-short', values)
    return size.value > 0 ? t('task.space-size-free', values) : t('task.space-free', values)
  })

  return { free, short, text }
}
