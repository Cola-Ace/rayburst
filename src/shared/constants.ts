/** @fileoverview Application-wide constants: themes, intervals, suffixes, limits. */
import { version as appVersion } from '../../package.json'
import { DEFAULT_TASK_MANUAL_ORDER, DEFAULT_TASK_SORT } from '@/composables/useTaskSort'
import type { AppLogLevel, Aria2LogLevel, FloatWindowMode } from '@shared/types'
import type { I18nKey } from '@shared/i18nTypes'
export const EMPTY_STRING = ''

export const APP_THEME = {
  AUTO: 'auto',
  LIGHT: 'light',
  DARK: 'dark',
}

/** Color scheme definition for the preset palette picker. */
export interface ColorSchemeDefinition {
  /** Unique identifier stored in config (kebab-case). */
  id: string
  /** i18n key suffix: `preferences.color-scheme-{id}` */
  labelKey: I18nKey
  /** Seed hex fed to MCU `themeFromSourceColor` to generate the full M3 tonal palette. */
  seed: string
  /** Palette generation mode. Content keeps low-chroma colors visually neutral. */
  variant?: 'source' | 'content'
}

/** Rayburst defaults and optional user-selected color seeds. */
export const DEFAULT_COLOR_SCHEME_ID = 'rayburst'
export const BRAND_COLOR = '#9E74D5'

export const COLOR_SCHEMES: ColorSchemeDefinition[] = [
  { id: DEFAULT_COLOR_SCHEME_ID, labelKey: 'preferences.color-scheme-rayburst', seed: BRAND_COLOR, variant: 'content' },
  { id: 'amber', labelKey: 'preferences.color-scheme-amber', seed: '#E0A422' },
  { id: 'space', labelKey: 'preferences.color-scheme-space', seed: '#4A6CF7' },
  { id: 'mint', labelKey: 'preferences.color-scheme-mint', seed: '#10B981' },
  { id: 'rose', labelKey: 'preferences.color-scheme-rose', seed: '#F43F5E' },
  { id: 'coral', labelKey: 'preferences.color-scheme-coral', seed: '#F97316' },
  { id: 'glacier', labelKey: 'preferences.color-scheme-glacier', seed: '#06B6D4' },
  { id: 'evergreen', labelKey: 'preferences.color-scheme-evergreen', seed: '#15803D' },
  { id: 'graphite', labelKey: 'preferences.color-scheme-graphite', seed: '#737373', variant: 'content' },
  { id: 'sakura', labelKey: 'preferences.color-scheme-sakura', seed: '#EC4899' },
]

export const CUSTOM_COLOR_SCHEME_ID = 'custom'
export const DEFAULT_CUSTOM_COLOR_SCHEME = BRAND_COLOR

export const ADD_TASK_TYPE = {
  URI: 'uri',
} as const

export const TASK_STATUS = {
  ACTIVE: 'active',
  WAITING: 'waiting',
  PAUSED: 'paused',
  ERROR: 'error',
  COMPLETE: 'complete',
  REMOVED: 'removed',
}

export const APP_LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const satisfies readonly AppLogLevel[]
export const ARIA2_LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const satisfies readonly Aria2LogLevel[]

export const MAX_NUM_OF_DIRECTORIES = 5
export const ENGINE_RPC_PORT = 29100
export const EXTENSION_API_PORT = 29110
export const RANDOM_PORT_RANGE_START = 29000
export const RANDOM_PORT_RANGE_END = 29999
export const ENGINE_DEFAULT_STREAM_CONNECTIONS = 16

// Safe thresholds — values above these trigger a user confirmation warning.
// These are "recommended" values displayed in UI labels; exceeding them is allowed
// but requires explicit opt-in via a warning dialog.

export const ONE_SECOND = 1000
export const ONE_MINUTE = ONE_SECOND * 60
export const ONE_HOUR = ONE_MINUTE * 60
export const ONE_DAY = ONE_HOUR * 24
export const COMPLETED_RECORD_RETENTION_FOREVER = 0
export const COMPLETED_RECORD_RETENTION_OPTIONS = [0, 1, 7, 180, 365] as const
/** Unfinished downloads carry this suffix while the preference is on (#721). */
export const INCOMPLETE_SUFFIX = '.ray' as const

export const UPDATE_CHANNELS = ['stable', 'beta'] as const

export const FLOAT_WINDOW_MODES = ['always', 'downloading', 'off'] as const satisfies readonly FloatWindowMode[]

/** Labels of the floating window's modes in the settings, its menu and the tray. */
export const FLOAT_WINDOW_MODE_LABELS = {
  always: 'preferences.float-window-always',
  downloading: 'preferences.float-window-downloading',
  off: 'preferences.float-window-off',
} as const satisfies Record<FloatWindowMode, I18nKey>

/** Day-of-week bitmask constants for speed schedule. Mon=1 … Sun=64. */
export const SCHEDULE_DAY = {
  MON: 1,
  TUE: 2,
  WED: 4,
  THU: 8,
  FRI: 16,
  SAT: 32,
  SUN: 64,
  /** Every day (special sentinel — checked first, bypasses bitmask). */
  EVERY_DAY: 0,
  /** Monday–Friday. */
  WEEKDAYS: 1 + 2 + 4 + 8 + 16, // 31
  /** Saturday–Sunday. */
  WEEKENDS: 32 + 64, // 96
} as const

/** Built-in file category templates for smart path classification (Issue #94).
 *  Extensions are lowercase without dot prefix.  `subdirName` is a fixed English
 *  directory name (filesystem paths should not change with locale).
 *  Use `buildDefaultCategories()` to produce runtime FileCategory[]. */
export const BUILTIN_CATEGORY_TEMPLATES = [
  {
    label: 'file-category-videos',
    extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v', 'rmvb'],
    subdirName: 'Videos',
  },
  {
    label: 'file-category-music',
    extensions: ['mp3', 'flac', 'aac', 'ogg', 'wav', 'wma', 'm4a', 'opus', 'ape'],
    subdirName: 'Music',
  },
  {
    label: 'file-category-images',
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'psd', 'raw'],
    subdirName: 'Images',
  },
  {
    label: 'file-category-documents',
    extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'epub', 'md', 'rtf'],
    subdirName: 'Documents',
  },
  {
    label: 'file-category-archives',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'iso', 'zst'],
    subdirName: 'Archives',
  },
  {
    label: 'file-category-programs',
    extensions: ['exe', 'msi', 'deb', 'rpm', 'appimage', 'pkg', 'apk', 'snap'],
    subdirName: 'Programs',
  },
] as const

/** Built-in categories follow the current default directory without path rewriting. */
export function buildDefaultCategories(): import('@shared/types').FileCategory[] {
  return BUILTIN_CATEGORY_TEMPLATES.map((template) => ({
    label: template.label,
    extensions: [...template.extensions],
    directory: template.subdirName,
    directoryMode: 'relative',
    builtIn: true,
  }))
}

/** Maximum number of file categories a user can create (built-in + custom). */
export const MAX_FILE_CATEGORIES = 20

export const DEFAULT_APP_CONFIG = {
  // ── Appearance ──────────────────────────────────────────────────
  theme: 'auto' as const,
  colorScheme: DEFAULT_COLOR_SCHEME_ID,
  customColorScheme: DEFAULT_CUSTOM_COLOR_SCHEME,
  taskCardMode: 'full' as const,
  showLogoWhenEmpty: true,
  reduceMotion: false,
  sidebarTaskCounts: true,
  uiScale: 1,
  iecSizeUnits: false,
  systemTitleBar: false,
  taskPageSize: 20,
  locale: 'auto',

  // ── Download Core ─────────────────────────────────────────────────
  dir: '',
  rememberSaveLocation: false,
  lastSaveLocation: '',
  streamMaxConnections: ENGINE_DEFAULT_STREAM_CONNECTIONS,
  maxConcurrentDownloads: 6,
  maxOverallDownloadLimit: '0',
  speedLimitEnabled: false,
  speedScheduleEnabled: false,
  speedScheduleFrom: '08:00',
  speedScheduleTo: '18:00',
  speedScheduleDays: 0, // 0 = every day
  maxDownloadLimit: '',

  // ── File Classification (IDM-style pre-download routing) ──────
  fileCategoryEnabled: false, // opt-in: does not affect existing users until enabled
  fileCategories: [] as import('@shared/types').FileCategory[],
  remoteTime: false, // aria2 default=false; file timestamp = download completion time

  // ── Interface & Behavior ──────────────────────────────────────
  openAtLogin: false, // never auto-start on first install
  keepWindowState: false, // first launch has no saved state

  autoHideWindow: false,
  minimizeToTrayOnClose: false, // closing asks by default
  quitOnClose: false, // the user chose to quit without asking
  hideDockOnMinimize: false, // macOS: hide Dock icon when minimized to tray
  lightweightMode: false, // destroy WebView on minimize-to-tray to free ~300MB RAM
  showProgressBar: true,
  showTrayIcon: true,
  traySpeedometer: false, // opt-in: supported on macOS menu bar + Linux appindicator
  dockBadgeSpeed: true, // macOS Dock badge on by default
  taskNotification: true, // users expect download-complete notifications
  notifyOnStart: true,
  notifyOnComplete: true, // main value of OS notification: background completion alert
  floatWindow: 'off' as const,
  floatWindowInLightweight: false, // lightweight mode frees every webview by default
  mediaSelectBeforeDownload: true,
  mediaDefaultFormat: 'mp4' as const,
  newTaskShowDownloading: true, // auto-navigate to downloads after adding task
  noConfirmBeforeDeleteTask: false, // require confirmation to prevent accidental deletion
  fileDeletionMode: 'trash' as const,
  deleteFilesWhenSkipConfirm: false, // when skip-confirm is on, default to keeping files (safe)
  resumeAllWhenAppLaunched: false, // don't flood bandwidth on launch

  // ── Auto Update ───────────────────────────────────────────────
  autoCheckUpdate: true, // qBT checks every launch; security best practice
  autoCheckUpdateInterval: 0, // 0 means every frontend startup, including lightweight restores
  /** Linux-only: WebKitGTK hardware compositing, opt-in: it freezes or blanks windows on many drivers and virtual GPUs. */
  hardwareRendering: false,
  updateChannel: (appVersion.includes('-') ? 'beta' : 'stable') as 'stable' | 'beta',
  lastCheckUpdateTime: 0,

  // ── Network & Security ────────────────────────────────────────
  rpcListenPort: ENGINE_RPC_PORT,
  extensionApiPort: EXTENSION_API_PORT,
  allowRemoteAccess: false,
  // extensionApiSecret is intentionally ABSENT from defaults.
  // rpcSecret is intentionally ABSENT from defaults.
  // For both secrets:
  //   undefined → main.ts auto-generates on first launch.
  //   '' → user intentionally cleared (respected, not regenerated).
  //   'abc' → user-set or auto-generated secret (kept as-is).
  proxy: {
    mode: 'direct' as const,
    server: '',
    username: '',
    password: '',
    bypass: '',
    scope: ['download', 'update-app'],
  },
  clipboard: {
    enable: true,
    background: false,
    http: true,
    sftp: true,
    thunder: true,
    httpFilesOnly: true,
  },
  extensionDownloadBehavior: 'confirm' as const,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  userAgentProfiles: [],
  userAgentRules: [],
  recentUserAgentProfileIds: [],
  siteRules: [],
  dnsOverHttps: '',
  checkCertificate: true,
  postDownloadProgram: '',
  postDownloadArguments: '',
  notificationClickAction: 'reveal' as const,
  logLevel: 'info' as const,
  aria2LogLevel: 'info' as const,
  cookie: '',
  runMode: '',
  tempFilesDir: '',

  // ── Directories ───────────────────────────────────────────────
  historyDirectories: [] as string[],
  favoriteDirectories: [] as string[],

  // ── Cleanup ───────────────────────────────────────────────────
  autoDeleteStaleRecords: false,
  clearCompletedOnExit: false,
  completedRecordRetentionDays: COMPLETED_RECORD_RETENTION_FOREVER,
  removeCompletedRecords: false,

  // ── Power Management ────────────────────────────────────────────
  shutdownWhenComplete: false,
  keepAwake: false,

  // ── Retry & Timeout (matches aria2.conf defaults) ──────────────
  maxTries: 0, // 0 = unlimited retries
  retryWait: 10, // seconds; aria2 waits this long after 503 before retrying
  connectTimeout: 10, // seconds to establish connection
  timeout: 10, // seconds for data transfer after connection
  fileAllocation: 'trunc' as const, // 'none' | 'trunc' | 'prealloc' | 'falloc'
  incompleteSuffix: '' as const,
  // ── Task Sorting ─────────────────────────────────────────────
  taskSort: DEFAULT_TASK_SORT,
  taskManualOrder: DEFAULT_TASK_MANUAL_ORDER,
}

export const FILE_ALLOCATION_OPTIONS = ['none', 'trunc', 'prealloc', 'falloc'] as const

export const PROXY_SCOPES = {
  DOWNLOAD: 'download',
  UPDATE_APP: 'update-app',
}

export const PROXY_SCOPE_OPTIONS = [PROXY_SCOPES.DOWNLOAD, PROXY_SCOPES.UPDATE_APP]

export const NONE_SELECTED_FILES = 'none'
export const SELECTED_ALL_FILES = 'all'

export const COMMON_RESOURCE_TAGS = ['http://', 'https://', 'sftp://']
export const THUNDER_RESOURCE_TAGS = ['thunder://']

export const RESOURCE_TAGS = [...COMMON_RESOURCE_TAGS, ...THUNDER_RESOURCE_TAGS]

/** Memory-safety guard: reject clipboard content longer than this (characters). */
export const DETECT_RESOURCE_MAX_CHARS = 100_000

/**
 * Maximum number of non-empty lines detectResource will evaluate.
 * Prevents pathological performance on huge lists while supporting realistic
 * batch-download scenarios (the old 2048-char limit broke at ~13 URLs).
 */
export const DETECT_RESOURCE_MAX_LINES = 200

export const IMAGE_SUFFIXES = [
  '.ai',
  '.bmp',
  '.eps',
  '.fig',
  '.gif',
  '.heic',
  '.icn',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.psd',
  '.raw',
  '.sketch',
  '.svg',
  '.tif',
  '.webp',
  '.xd',
]

export const AUDIO_SUFFIXES = ['.aac', '.ape', '.flac', '.flav', '.m4a', '.mp3', '.ogg', '.wav', '.wma']

export const VIDEO_SUFFIXES = ['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.mpg', '.rmvb', '.vob', '.wmv']

export const SUB_SUFFIXES = ['.ass', '.idx', '.smi', '.srt', '.ssa', '.sst', '.sub']

export const DOCUMENT_SUFFIXES = [
  '.azw3',
  '.csv',
  '.doc',
  '.docx',
  '.epub',
  '.key',
  '.mobi',
  '.numbers',
  '.pages',
  '.pdf',
  '.ppt',
  '.pptx',
  '.txt',
  '.xls',
  '.xlsx',
]
