<script setup lang="ts">
/** @fileoverview Detailed task view with file list, peers, and BT info. */
import { ref, computed, watch, defineComponent, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { I18nKey } from '@shared/i18nTypes'
import { logger } from '@shared/logger'
import { writeAppClipboardText } from '@shared/utils'
import { getTaskName, localeDateTimeFormat } from '@shared/utils'
import {
  NDrawer,
  NDrawerContent,
  NDescriptions,
  NDescriptionsItem,
  NIcon,
  NTag,
  NButton,
  NSwitch,
  NForm,
  NInput,
  NInputGroup,
  NFormItem,
  NCollapseTransition,
} from 'naive-ui'
import {
  InformationCircleOutline,
  PulseOutline,
  DocumentOutline,
  ServerOutline,
  SettingsOutline,
  SearchOutline,
} from '@vicons/ionicons5'
import { useTaskDetailOptions } from '@/composables/useTaskDetailOptions'
import { replaceTaskUri } from '@/api/aria2'
import SpeedLimitInput from '@/components/common/SpeedLimitInput.vue'
import {
  buildMediaDetailRows,
  buildTaskDetailKind,
  buildUriDetailSummary,
  getTaskDetailStatusLabelKey,
} from '@/composables/useTaskDetailSummary'
import { usePreferenceStore } from '@/stores/preference'
import { useTaskStore } from '@/stores/task'
import { useHistoryStore } from '@/stores/history'
import { useAppMessage } from '@/composables/useAppMessage'
import { useSystemProxyDetect } from '@/composables/useSystemProxyDetect'
import { getAddedAt } from '@/composables/useTaskOrder'
import type { Aria2Task, Aria2File, UserAgentProfile } from '@shared/types'
import UserAgentPopover from '@/components/common/UserAgentPopover.vue'
import { renderDetailCopyableText } from './detail/TaskDetailShared'
import { mediaStateLabel, canSelectMedia } from '@shared/utils/media'
import { useTaskSelectionStore } from '@/stores/taskSelection'
import TaskDetailActivity from './detail/TaskDetailActivity.vue'
import TaskDetailFiles from './detail/TaskDetailFiles.vue'
import TaskDetailSources from './detail/TaskDetailSources.vue'
import RenameCompletedFile from './detail/RenameCompletedFile.vue'
import MoveDownload from './detail/MoveDownload.vue'

const props = defineProps<{
  show: boolean
  task: Aria2Task | null
  files: Aria2File[]
}>()
const emit = defineEmits<{ close: [] }>()

const { t, locale } = useI18n()
const preferenceStore = usePreferenceStore()
const taskStore = useTaskStore()
onBeforeUnmount(() => {
  taskStore.taskDetailClosing = false
  taskStore.taskDetailVisible = false
})
const historyStore = useHistoryStore()
const message = useAppMessage()
const taskRef = computed(() => props.task)
const taskPrimaryUrl = computed(() => props.task?.files?.[0]?.uris?.[0]?.uri ?? '')

const {
  form: optForm,
  canModify: optCanModify,
  canReplaceUri: optCanReplaceUri,
  retriesWithUri: optRetriesWithUri,
  dirty: optDirty,
  applying: optApplying,
  applyOptions: optApplyFn,
} = useTaskDetailOptions({
  task: taskRef,
  getTaskOption: (gid) => taskStore.getTaskOption(gid),
  changeTaskOption: (payload) => taskStore.changeTaskOption(payload),
  replaceTaskUri,
  retryTaskWithUri: async (task, uri) => {
    await taskStore.retryTask(task, uri)
    emit('close')
  },
  proxyConfig: () => preferenceStore.config.proxy,
  message,
  t,
})

const { detecting: detectingProxy, detect: detectProxy } = useSystemProxyDetect({
  onSuccess(info) {
    optForm.customProxy = info.server
    optForm.proxyMode = 'manual'
    message.success(t('preferences.proxy-detected-success'))
  },
  onNotFound() {
    message.info(t('preferences.proxy-system-not-detected'))
  },
  onError() {
    message.error(t('preferences.proxy-system-detect-failed'))
  },
})

function selectTaskUserAgentProfile(profile: UserAgentProfile) {
  optForm.userAgent = profile.value
  preferenceStore.recordRecentUserAgentProfile(profile.id)
}

function copyLabel(label: string, fallback: string): string {
  return label || fallback
}

async function copyDetailValue(value: string | number | null | undefined, label: string) {
  const text = value === null || value === undefined ? '' : String(value)
  if (!text || text === '-') return
  try {
    await writeAppClipboardText(text)
    message.success(t('preferences.copied-to-clipboard', { label }))
  } catch (e) {
    logger.debug('TaskDetail.clipboard', `writeText failed: ${e}`)
  }
}

function renderCopyableValue(value: string | number, label: string) {
  return renderDetailCopyableText({
    value,
    label,
    tooltip: t('about.click-to-copy'),
    onCopy: copyDetailValue,
  })
}

const CopyableValue = defineComponent({
  name: 'CopyableValue',
  props: {
    value: {
      type: [String, Number],
      required: true,
    },
    label: {
      type: String,
      required: true,
    },
  },
  setup(componentProps) {
    return () => renderCopyableValue(componentProps.value, componentProps.label)
  },
})

const activeTab = ref('general')
const slideDirection = ref<'left' | 'right'>('left')
const prevTabIndex = ref(0)

interface TabDef {
  key: string
  labelKey: I18nKey
  icon: typeof InformationCircleOutline
  uriOnly?: boolean
  liveOnly?: boolean
}
const allTabs: TabDef[] = [
  { key: 'general', labelKey: 'task.task-tab-general', icon: InformationCircleOutline },
  { key: 'activity', labelKey: 'task.task-tab-activity', icon: PulseOutline, liveOnly: true },
  { key: 'files', labelKey: 'task.task-tab-files', icon: DocumentOutline },
  { key: 'options', labelKey: 'task.task-tab-options', icon: SettingsOutline, uriOnly: true, liveOnly: true },
  { key: 'sources', labelKey: 'task.task-tab-sources', icon: ServerOutline, uriOnly: true },
]

const isTerminal = computed(() => ['complete', 'error', 'removed'].includes(props.task?.status ?? ''))
/** A failed download keeps its options page to retry from another source (#548). */
const retriesFromSource = computed(() => props.task?.status === 'error' && optCanReplaceUri.value)

const visibleTabs = computed(() =>
  allTabs.filter(
    (tab) =>
      !(props.task?.media && (tab.key === 'activity' || (tab.key === 'files' && !isTerminal.value))) &&
      (!tab.uriOnly || isURI.value || (tab.key === 'options' && Boolean(props.task?.media))) &&
      (!tab.liveOnly || !isTerminal.value || (tab.key === 'options' && retriesFromSource.value)),
  ),
)

function switchTab(key: string) {
  const oldIdx = visibleTabs.value.findIndex((t) => t.key === activeTab.value)
  const newIdx = visibleTabs.value.findIndex((t) => t.key === key)
  slideDirection.value = newIdx > oldIdx ? 'left' : 'right'
  prevTabIndex.value = newIdx
  activeTab.value = key
}

const detailKind = computed(() => buildTaskDetailKind(props.task))
const isURI = computed(() => detailKind.value === 'uri')
const uriSummary = computed(() => buildUriDetailSummary(props.task))
const mediaRows = computed(() => buildMediaDetailRows(props.task, locale.value))
function editMedia() {
  if (!props.task || !canSelectMedia(props.task)) return
  taskStore.hideTaskDetail()
  useTaskSelectionStore().request({ kind: 'media', gid: props.task.gid })
}

const prevTaskGid = ref('')
watch(
  () => props.task?.gid,
  (gid) => {
    if (gid && gid !== prevTaskGid.value) {
      activeTab.value = 'general'
      prevTaskGid.value = gid
    }
  },
)

watch(visibleTabs, (tabs) => {
  if (!tabs.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = 'general'
    prevTabIndex.value = 0
  }
})
const taskStatusKey = computed(() => props.task?.status)
const taskStatus = computed(() => {
  if (props.task?.media) return t(mediaStateLabel[props.task.media.state])
  const key = taskStatusKey.value
  const labelKey = getTaskDetailStatusLabelKey(key)
  const translated = t(labelKey)
  return translated !== labelKey ? translated : key
})
const taskFullName = computed(() => (props.task ? getTaskName(props.task, { defaultName: 'Unknown' }) : ''))
// ── Task date display ────────────────────────────────────────────────
const taskAddedAt = computed(() => {
  if (!props.task) return ''
  const iso = getAddedAt(props.task.gid)
  if (!iso) return ''
  return localeDateTimeFormat(new Date(iso).getTime(), locale.value)
})

const taskCompletedAt = ref('')
watch(
  () => props.task?.gid,
  async (gid) => {
    if (!gid) {
      taskCompletedAt.value = ''
      return
    }
    try {
      const record = await historyStore.getRecordByGid(gid)
      if (record?.completed_at) {
        taskCompletedAt.value = localeDateTimeFormat(new Date(record.completed_at).getTime(), locale.value)
      } else {
        taskCompletedAt.value = ''
      }
    } catch (e) {
      logger.debug('TaskDetail.completedAt', `gid=${gid} query failed: ${e}`)
      taskCompletedAt.value = ''
    }
  },
  { immediate: true },
)
const taskErrorMessage = computed(() => props.task?.media?.error || props.task?.errorMessage || '')
const taskErrorCode = computed(() => props.task?.errorCode || '')

type TaskStatusTagType = 'default' | 'success' | 'warning' | 'error' | 'info'

const statusTagType = computed<TaskStatusTagType>(() => {
  switch (taskStatusKey.value) {
    case 'active':
    case 'waiting':
      return 'warning'
    case 'complete':
      return 'success'
    case 'error':
      return 'error'
    default:
      return 'default'
  }
})

function handleClose() {
  emit('close')
}

async function onFileRenamed() {
  taskStore.hideTaskDetail()
  await taskStore.fetchList()
}
</script>

<template>
  <NDrawer
    :show="show"
    :width="'61.8%'"
    placement="right"
    :trap-focus="false"
    :block-scroll="false"
    @after-leave="taskStore.taskDetailClosing = false"
    @update:show="
      (v: boolean) => {
        if (!v) handleClose()
      }
    "
  >
    <NDrawerContent :title="t('task.task-detail-title') || 'Task Details'" closable @close="handleClose">
      <div class="detail-tabs">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          :class="['detail-tab', { active: activeTab === tab.key }]"
          @click="switchTab(tab.key)"
        >
          <NIcon :size="16"><component :is="tab.icon" /></NIcon>
          <span class="detail-tab-label">{{ t(tab.labelKey) }}</span>
        </button>
      </div>

      <div class="tab-content-wrapper">
        <Transition :name="`tab-slide-${slideDirection}`" mode="out-in">
          <div v-if="activeTab === 'general'" key="general" class="tab-content">
            <template v-if="task">
              <NDescriptions
                :column="1"
                label-placement="left"
                bordered
                size="small"
                :label-style="{ width: '1px', whiteSpace: 'nowrap' }"
              >
                <NDescriptionsItem :label="t('task.task-name') || 'Name'">
                  <CopyableValue :value="taskFullName" :label="copyLabel(t('task.task-name'), 'Name')" />
                  <RenameCompletedFile :task="task" @renamed="onFileRenamed" />
                </NDescriptionsItem>
                <NDescriptionsItem v-if="task.dir" :label="t('task.task-dir') || 'Directory'">
                  <CopyableValue :value="task.dir" :label="copyLabel(t('task.task-dir'), 'Directory')" />
                  <MoveDownload :task="task" @moved="taskStore.fetchList()" />
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-status') || 'Status'">
                  <div class="detail-status-value">
                    <NTag :type="statusTagType" size="small">{{ taskStatus }}</NTag>
                    <NButton v-if="canSelectMedia(task)" text type="primary" size="small" @click="editMedia">{{
                      t('media.select-tracks')
                    }}</NButton>
                  </div>
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-type') || 'Type'">
                  {{
                    task.media
                      ? [
                          task.media.protocol.toUpperCase() || t('media.auto'),
                          task.media.live === 'true' ? t('media.live') : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : t(`task.task-type-${detailKind}`)
                  }}
                </NDescriptionsItem>
                <NDescriptionsItem v-for="row in mediaRows" :key="row.key" :label="t(row.label)">
                  <span class="technical-text-wrap">{{ row.value }}</span>
                </NDescriptionsItem>
                <NDescriptionsItem v-if="taskErrorMessage" :label="t('task.task-error-info') || 'Error'">
                  {{ taskErrorCode && taskErrorCode !== '0' ? `${taskErrorCode} ` : '' }}{{ taskErrorMessage }}
                </NDescriptionsItem>
                <NDescriptionsItem v-if="taskAddedAt" :label="t('task.task-added-at') || 'Added At'">
                  {{ taskAddedAt }}
                </NDescriptionsItem>
                <NDescriptionsItem v-if="taskCompletedAt" :label="t('task.task-completed-at') || 'Completed At'">
                  {{ taskCompletedAt }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-gid') || 'GID'">
                  <CopyableValue :value="task.gid" :label="copyLabel(t('task.task-gid'), 'GID')" />
                </NDescriptionsItem>
              </NDescriptions>
            </template>
          </div>

          <div v-else-if="activeTab === 'activity'" key="activity" class="tab-content">
            <TaskDetailActivity :task="task" />
          </div>

          <div v-else-if="activeTab === 'files'" key="files" class="tab-content">
            <TaskDetailFiles :files="files" :tooltip="t('about.click-to-copy')" :on-copy="copyDetailValue" />
          </div>

          <div v-else-if="activeTab === 'sources'" key="sources" class="tab-content">
            <TaskDetailSources
              v-if="task && isURI"
              :task="task"
              :summary="uriSummary"
              :tooltip="t('about.click-to-copy')"
              :on-copy="copyDetailValue"
            />
          </div>

          <div v-else-if="activeTab === 'options'" key="options" class="tab-content">
            <NForm label-placement="left" label-width="110px" class="options-form">
              <NFormItem v-if="optForm.uri" :label="t('task.source-url') + ':'">
                <NInput
                  v-model:value="optForm.uri"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 3 }"
                  :readonly="!optCanReplaceUri"
                />
              </NFormItem>
              <NFormItem v-if="!isTerminal" :label="t('task.speed-limit') + ':'">
                <SpeedLimitInput
                  v-model:value="optForm.maxDownloadLimit"
                  :disabled="!optCanModify"
                  :placeholder="t('task.speed-limit-unlimited')"
                />
              </NFormItem>
              <template v-if="!isTerminal">
                <NFormItem :label="t('task.task-user-agent') + ':'">
                  <NInputGroup class="detail-ua-row">
                    <NInput
                      v-model:value="optForm.userAgent"
                      type="textarea"
                      :autosize="{ minRows: 1, maxRows: 3 }"
                      :readonly="!optCanModify"
                      :placeholder="t('task.task-user-agent-placeholder') || ''"
                    />
                    <UserAgentPopover
                      :url="taskPrimaryUrl"
                      :profiles="preferenceStore.config.userAgentProfiles"
                      :rules="preferenceStore.config.userAgentRules"
                      :recent-profile-ids="preferenceStore.config.recentUserAgentProfileIds"
                      :disabled="!optCanModify"
                      @select="selectTaskUserAgentProfile"
                    />
                  </NInputGroup>
                </NFormItem>
                <NFormItem :label="t('task.task-authorization') + ':'">
                  <NInput
                    v-model:value="optForm.authorization"
                    type="textarea"
                    :autosize="{ minRows: 1, maxRows: 3 }"
                    :readonly="!optCanModify"
                    :placeholder="t('task.task-authorization-placeholder') || ''"
                  />
                </NFormItem>
                <NFormItem :label="t('task.task-http-auth') + ':'">
                  <div class="http-auth-fields">
                    <NInput
                      v-model:value="optForm.httpAuthUsername"
                      :readonly="!optCanModify"
                      :placeholder="t('task.task-http-auth-username-placeholder') || ''"
                    />
                    <NInput
                      v-model:value="optForm.httpAuthPassword"
                      type="password"
                      show-password-on="click"
                      :readonly="!optCanModify"
                      :placeholder="t('task.task-http-auth-password-placeholder') || ''"
                    />
                  </div>
                </NFormItem>
                <NFormItem :label="t('task.task-referer') + ':'">
                  <NInput
                    v-model:value="optForm.referer"
                    type="textarea"
                    :autosize="{ minRows: 1, maxRows: 3 }"
                    :readonly="!optCanModify"
                    :placeholder="t('task.task-referer-placeholder') || ''"
                  />
                </NFormItem>
                <NFormItem :label="t('task.task-cookie') + ':'">
                  <NInput
                    v-model:value="optForm.cookie"
                    type="textarea"
                    :autosize="{ minRows: 1, maxRows: 3 }"
                    :readonly="!optCanModify"
                    :placeholder="t('task.task-cookie-placeholder') || ''"
                  />
                </NFormItem>
                <NFormItem :label="t('task.use-proxy') + ':'">
                  <NSwitch
                    :value="optForm.proxyMode === 'manual'"
                    :disabled="!optCanModify"
                    @update:value="optForm.proxyMode = $event ? 'manual' : 'direct'"
                  />
                </NFormItem>
                <NFormItem label=" " :show-feedback="false" class="proxy-options-item">
                  <NCollapseTransition :show="optForm.proxyMode === 'manual'">
                    <div class="proxy-radio-group">
                      <div class="custom-proxy-input">
                        <NInput
                          v-model:value="optForm.customProxy"
                          :readonly="!optCanModify"
                          :placeholder="'http://host:port'"
                        />
                        <NInput
                          v-model:value="optForm.customProxyUsername"
                          :readonly="!optCanModify"
                          :placeholder="t('preferences.proxy-username') || ''"
                        />
                        <NInput
                          v-model:value="optForm.customProxyPassword"
                          type="password"
                          show-password-on="click"
                          :readonly="!optCanModify"
                          :placeholder="t('preferences.proxy-password') || ''"
                        />
                        <NButton :loading="detectingProxy" :disabled="!optCanModify" size="small" @click="detectProxy">
                          <template #icon>
                            <NIcon><SearchOutline /></NIcon>
                          </template>
                          {{ t('preferences.detect-system-proxy') }}
                        </NButton>
                      </div>
                    </div>
                  </NCollapseTransition>
                </NFormItem>
              </template>
              <div v-if="optCanModify || optCanReplaceUri" class="options-apply-bar">
                <NButton
                  :type="optDirty ? 'primary' : 'default'"
                  :disabled="!optDirty"
                  :loading="optApplying"
                  class="apply-btn"
                  @click="optApplyFn"
                >
                  {{
                    optRetriesWithUri
                      ? t('task.source-url-retry')
                      : optDirty
                        ? t('task.apply-changes')
                        : t('task.no-changes')
                  }}
                </NButton>
              </div>
            </NForm>
          </div>
        </Transition>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.detail-status-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.detail-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--panel-border);
  padding-bottom: 0;
  margin-bottom: 0;
}

.detail-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 12px;
  height: 36px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  font-size: var(--font-size-xs);
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.detail-tab:hover {
  color: var(--m3-on-surface);
}

.detail-tab.active {
  color: var(--m3-on-surface);
  border-bottom-color: var(--m3-primary);
}

.tab-content-wrapper {
  overflow: hidden;
  position: relative;
}

.tab-content {
  padding: 16px 0;
}

:deep(.detail-copyable-value) {
  display: inline-flex;
  align-items: flex-start;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
  vertical-align: middle;
}

:deep(.detail-long-text),
:deep(.detail-copyable-text) {
  min-width: 0;
  max-width: 100%;
  line-height: 1.45;
}

:deep(.detail-copyable-value--ellipsis) {
  display: flex;
  align-items: center;
  width: 100%;
}

:deep(.detail-copyable-value--ellipsis .detail-copyable-text) {
  flex: 1;
}

:deep(.detail-copy-button) {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  opacity: 0.58;
  transition:
    opacity 0.16s cubic-bezier(0.2, 0, 0, 1),
    color 0.16s cubic-bezier(0.2, 0, 0, 1);
}

:deep(.detail-copy-button:hover) {
  opacity: 1;
  color: var(--m3-primary);
}

.section-divider {
  margin: 20px 0 12px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--m3-primary);
  letter-spacing: 0.5px;
}

:deep(.progress-row) {
  display: flex;
  align-items: center;
  gap: 12px;
}

:deep(.progress-pct) {
  white-space: nowrap;
  font-size: var(--font-size-xs);
  color: var(--m3-on-surface-variant);
  min-width: 45px;
  text-align: right;
}

:deep(.remaining-text) {
  margin-left: 12px;
  color: var(--m3-on-surface-variant);
  font-size: var(--font-size-xs);
}
.muted-inline {
  color: var(--m3-on-surface-variant);
  font-size: inherit;
  line-height: inherit;
  vertical-align: baseline;
}
:deep(.source-table) {
  margin-top: 12px;
}

.detail-footer {
  display: flex;
  justify-content: center;
}

.detail-footer :deep(.task-item-actions) {
  direction: ltr;
}

.status-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.tab-slide-left-enter-active,
.tab-slide-left-leave-active,
.tab-slide-right-enter-active,
.tab-slide-right-leave-active {
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.tab-slide-left-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.tab-slide-left-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}

.tab-slide-right-enter-from {
  opacity: 0;
  transform: translateX(-40px);
}
.tab-slide-right-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

/* Probe button M3 transition */
:deep(.probe-btn) {
  transition:
    background-color 0.3s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.3s cubic-bezier(0.2, 0, 0, 1),
    color 0.3s cubic-bezier(0.2, 0, 0, 1);
}

/* Spinning indicator matching Naive UI's loading style */
:deep(.probe-spinner) {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: m3-spin 0.8s linear infinite;
  will-change: transform;
  contain: layout style paint;
}

@keyframes m3-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Options tab ─────────────────────────────────────────────────── */
.options-form {
  padding: 4px 0;
}
.detail-ua-row {
  display: flex;
  align-items: stretch;
  width: 100%;
}
.detail-ua-row :deep(.n-input) {
  flex: 1;
}
.options-apply-bar {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
.apply-btn {
  transition:
    background-color 0.25s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.25s cubic-bezier(0.2, 0, 0, 1),
    color 0.25s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.25s cubic-bezier(0.2, 0, 0, 1);
}
.proxy-radio-group {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.custom-proxy-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.custom-proxy-input .n-button {
  align-self: flex-start;
}
.http-auth-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
/* Allow table header text to wrap instead of truncating with "…"
   when the column is too narrow for the translated label. */
:deep(.n-data-table-th__title) {
  white-space: normal;
  overflow-wrap: normal;
  word-break: break-all;
  hyphens: none;
}

:deep(.n-data-table-td) {
  vertical-align: top;
}
</style>
