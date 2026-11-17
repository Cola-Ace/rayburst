/** @fileoverview Core type definitions for Aria2 JSON-RPC responses and application configuration. */

/** Task lifecycle status as reported by aria2 RPC. */
export type TaskStatus = 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed'

export type AppLogLevel = 'error' | 'warn' | 'info' | 'debug'
export type Aria2LogLevel = AppLogLevel | 'trace'
export type FileDeletionMode = 'trash' | 'permanent'

/** URI entry within an aria2 file descriptor. */
export interface Aria2FileUri {
  uri: string
  status: string
}

/** Single file within an aria2 download task, as returned by tellStatus. */
export interface Aria2File {
  index: string
  path: string
  length: string
  completedLength: string
  selected: string
  uris: Aria2FileUri[]
}

/**
 * Complete aria2 task object returned by tellStatus, tellActive, tellWaiting, or tellStopped.
 * All numeric values are represented as strings per the aria2 JSON-RPC protocol.
 */
export type MediaState =
  | 'waiting'
  | 'probing'
  | 'awaiting-selection'
  | 'downloading'
  | 'recording'
  | 'finalizing'
  | 'paused'
  | 'complete'
  | 'error'
  | 'removed'
export interface Aria2MediaTrack {
  id: string
  type: 'video' | 'audio' | 'subtitle' | 'muxed'
  language: string
  codec: string
  width: string
  height: string
  bandwidth: string
  frameRate?: string
  selected: 'true' | 'false'
}
export interface Aria2Media {
  state: MediaState
  protocol: '' | 'hls' | 'dash' | 'collection'
  live: 'true' | 'false'
  duration: string
  completedDuration: string
  downloadedLength: string
  lengthKnown: 'true' | 'false'
  progress?: string
  error: string
  errorCode?: string
  tracks: Aria2MediaTrack[]
}

export interface Aria2Task {
  selectionManaged?: boolean
  bitfield?: string
  numPieces?: string
  pieceLength?: string
  gid: string
  status: TaskStatus
  totalLength: string
  completedLength: string
  downloadSpeed: string
  connections: string
  dir: string
  files: Aria2File[]
  media?: Aria2Media
  mediaOptions?: Record<string, string>
  errorCode?: string
  errorMessage?: string
  verifiedLength?: string
  verifyIntegrityPending?: string
  followedBy?: string[]
  following?: string
  belongsTo?: string
  /** Set when the snapshot carries only some of the files; the open detail task carries all. */
  filesTotal?: number
}

/** Parsed global statistics with numeric values (post-conversion from string). */
export interface Aria2GlobalStat {
  downloadSpeed: number
  numActive: number
  numWaiting: number
  numStopped: number
  numStoppedTotal: number
}

/** One engine read published by the native pump (`tasks:snapshot`). */
export interface TaskSnapshot {
  stat: Aria2GlobalStat
  tasks: Aria2Task[]
}

/** Engine version information returned by aria2.getVersion. */
export interface Aria2Version {
  version: string
  enabledFeatures: string[]
}

/** Raw global statistics as returned by aria2 RPC (all values are strings). */
export interface Aria2RawGlobalStat {
  downloadSpeed: string
  numActive: string
  numWaiting: string
  numStopped: string
  numStoppedTotal: string
  [key: string]: string
}

/** HTTP proxy configuration for download tasks and scoped app requests. */
export interface ProxyConfig {
  mode?: import('@shared/utils/proxy').EngineProxyMode
  server: string
  username?: string
  password?: string
  bypass?: string
  scope?: string[]
}

/** Result from the `get_system_proxy` Tauri command.
 *  Mirrors the Rust `SystemProxyInfo` struct (camelCase via serde). */
export interface SystemProxyInfo {
  /** Proxy URL, e.g. "http://127.0.0.1:7890" */
  server: string
  /** OS bypass list (comma-separated domains/CIDRs) */
  bypass: string
  unsupportedBypass: string[]
  /** True when the detected proxy uses a SOCKS protocol (unsupported by aria2) */
  isSocks: boolean
}

export type UpdateChannel = 'stable' | 'beta'

/** When the floating window shows: always, only while files download, or never. */
export type FloatWindowMode = 'always' | 'downloading' | 'off'
export type ResolvedUpdateChannel = UpdateChannel

/** Clipboard auto-detection filter: controls which protocol families
 *  trigger the "new task" dialog when a URL is detected in the clipboard. */
export interface ClipboardConfig {
  /** Master switch — when false, clipboard detection is fully disabled. */
  enable: boolean
  /** Links copied while Rayburst is in the background open the add window at
   *  once, not when its window is next focused (#793). */
  background: boolean
  /** Detect http:// and https:// URLs. */
  http: boolean
  /** Detect sftp:// URLs. */
  sftp: boolean

  /** Detect thunder:// (迅雷) links. */
  thunder: boolean
  /** Ignore HTTP(S) links whose path names a web page rather than a file. */
  httpFilesOnly: boolean
}

/** A file category rule mapping extensions to a download directory. */
export type FileCategoryUrlPatternMode = 'wildcard' | 'regex'

export interface FileCategory {
  /** Display label — i18n key suffix for built-in categories, user-provided name for custom ones. */
  label: string
  /** File extensions (lowercase, no dot prefix) belonging to this category. */
  extensions: string[]
  /** URL, final URL, or referer match rules. Empty means URL is ignored. */
  urlPatterns?: string[]
  /** Matching mode for urlPatterns. */
  urlPatternMode?: FileCategoryUrlPatternMode
  /** Relative to the default directory, or an explicitly fixed absolute path. */
  directory: string
  directoryMode: 'relative' | 'absolute'
  /** Whether this is a built-in category (cannot be deleted, label resolved via i18n). */
  builtIn?: boolean
}

export interface UserAgentProfile {
  id: string
  name: string
  value: string
  createdAt: number
  updatedAt: number
}

export interface UserAgentRule {
  id: string
  enabled: boolean
  hostPattern: string
  profileId: string
  overridePlugin: boolean
  createdAt: number
  updatedAt: number
}

/** Limits connections to the hosts of a site that bans parallel downloads. */
export interface SiteRule {
  id: string
  enabled: boolean
  /** `example.com` names the domain and its subdomains; `*` matches any characters. */
  hostPattern: string
  /** 0 keeps the task's own value. */
  maxConnectionPerServer: number
  /** `proxy` uses the configured proxy server even when downloads go direct; `direct` skips it. */
  proxy: SiteRuleProxy
}

export type SiteRuleProxy = 'default' | 'proxy' | 'direct'

/** Application user preferences with full type coverage. */
export interface AppConfig {
  theme: 'auto' | 'light' | 'dark'
  colorScheme: string
  customColorScheme: string
  taskCardMode: 'full' | 'compact'
  showLogoWhenEmpty: boolean
  reduceMotion: boolean
  sidebarTaskCounts: boolean
  /** WebView zoom factor applied to every window. */
  uiScale: number
  /** Write binary units as KiB/MiB instead of KB/MB; values are base 1024 either way. */
  iecSizeUnits: boolean
  /** Linux: let the window manager draw the title bar and hide the app's caption buttons. */
  systemTitleBar: boolean
  taskPageSize: number
  locale: string
  dir: string
  rememberSaveLocation: boolean
  lastSaveLocation: string
  streamMaxConnections: number
  maxConcurrentDownloads: number
  maxOverallDownloadLimit: string
  maxDownloadLimit: string
  /** Whether the Speedometer speed limit toggle is active.
   *  When true, configured limits are applied to aria2 at runtime.
   *  When false, aria2 runs with 0 (unlimited) regardless of configured values. */
  speedLimitEnabled: boolean
  /** Whether the speed schedule is enabled. When true, the scheduler automatically
   *  toggles speedLimitEnabled on/off based on time of day and day of week. */
  speedScheduleEnabled: boolean
  /** Schedule start time in "HH:mm" format (24-hour). */
  speedScheduleFrom: string
  /** Schedule end time in "HH:mm" format (24-hour). Supports overnight spans (e.g. "22:00"→"08:00"). */
  speedScheduleTo: string
  /** Day-of-week bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
   *  0 = every day. Weekdays = 31. Weekends = 96. */
  speedScheduleDays: number
  /** Whether smart file classification is active.
   *  When true, downloads are routed to subdirectories by extension. */
  fileCategoryEnabled: boolean
  /** User-configurable file classification rules. */
  fileCategories: FileCategory[]

  openAtLogin: boolean
  autoCheckUpdate: boolean
  autoHideWindow: boolean
  minimizeToTrayOnClose: boolean
  quitOnClose: boolean
  hideDockOnMinimize: boolean
  lightweightMode: boolean
  keepWindowState: boolean

  mediaSelectBeforeDownload: boolean
  mediaDefaultFormat: 'mp4' | 'mkv'
  newTaskShowDownloading: boolean
  noConfirmBeforeDeleteTask: boolean
  fileDeletionMode: FileDeletionMode
  deleteFilesWhenSkipConfirm: boolean
  resumeAllWhenAppLaunched: boolean
  taskNotification: boolean
  /** OS notification when a download starts (gated by taskNotification). */
  notifyOnStart: boolean

  notifyOnComplete: boolean
  /** When the floating window with speed and progress stays on top (#669, #718, #726). */
  floatWindow: FloatWindowMode
  /** Lightweight mode keeps the floating window in the tray instead of releasing it too. */
  floatWindowInLightweight: boolean
  showProgressBar: boolean
  showTrayIcon: boolean
  traySpeedometer: boolean
  dockBadgeSpeed: boolean
  logLevel: AppLogLevel
  aria2LogLevel: Aria2LogLevel
  /** Directory for internal temporary engine files. Empty means the OS temporary directory. */
  tempFilesDir: string
  cookie: string
  proxy: ProxyConfig
  clipboard: ClipboardConfig
  /** One policy owns confirmation and window activation for extension downloads. */
  extensionDownloadBehavior: 'confirm' | 'background' | 'show'

  historyDirectories: string[]
  favoriteDirectories: string[]
  lastCheckUpdateTime: number
  /** Linux-only: opt into WebKitGTK hardware compositing. */
  hardwareRendering: boolean
  updateChannel: UpdateChannel
  runMode: string
  userAgent: string
  userAgentProfiles: UserAgentProfile[]
  userAgentRules: UserAgentRule[]
  recentUserAgentProfileIds: string[]
  siteRules: SiteRule[]
  /** DNS-over-HTTPS resolver URL for downloads; empty uses the system resolver. */
  dnsOverHttps: string
  /** Verify TLS certificates of download servers. */
  checkCertificate: boolean
  /** Program run on every finished download, e.g. a virus scanner. Empty runs nothing. */
  postDownloadProgram: string
  /** Its arguments; `{file}`, `{dir}` and `{name}` name the download. Empty passes `"{file}"`. */
  postDownloadArguments: string
  /** Clicking a completion notification reveals the file in its folder or opens it. */
  notificationClickAction: 'reveal' | 'open'
  rpcListenPort: number
  /** Port for the embedded HTTP API that browser extensions use to submit
   *  downloads. Defaults to 29110. */
  extensionApiPort: number
  /** Shared secret for the extension HTTP API. The browser extension must
   *  send this as a `Bearer` token in the `Authorization` header.
   *  Empty string means the user intentionally cleared it. */
  extensionApiSecret: string
  /** Shared secret for the aria2 RPC API. Empty string means the user intentionally cleared it. */
  rpcSecret: string
  /** When true, aria2 RPC and the extension API listen on all network interfaces. */
  allowRemoteAccess: boolean
  /** Automatically switches locally bound ports when another process or OS reservation blocks them. */
  /** When true, aria2 applies the remote server's Last-Modified timestamp
   *  to the local file instead of using the download-completion time. */
  remoteTime: boolean
  autoCheckUpdateInterval: number
  autoDeleteStaleRecords: boolean
  clearCompletedOnExit: boolean
  /** Completed history retention in days. 0 means keep forever. */
  completedRecordRetentionDays: number
  /** Finished downloads leave the list at once; their files stay. */
  removeCompletedRecords: boolean
  /** When true, the system shuts down after all downloads complete. */
  shutdownWhenComplete: boolean
  /** When true, prevents system idle sleep while downloads are active.
   *  Uses OS-native APIs: macOS IOPMAssertion, Windows SetThreadExecutionState,
   *  Linux systemd Inhibit. */
  keepAwake: boolean
  /** Maximum number of retries per download (0 = unlimited). Maps to aria2 --max-tries. */
  maxTries: number
  /** Seconds to wait between retries after HTTP 503 or similar errors. Maps to aria2 --retry-wait. */
  retryWait: number
  /** Seconds to wait when establishing a connection. Maps to aria2 --connect-timeout. */
  connectTimeout: number
  /** Seconds to wait for data transfer after connection is established. Maps to aria2 --timeout. */
  timeout: number
  /** Disk space pre-allocation method. Maps to aria2 --file-allocation.
   *  Values: 'none' | 'trunc' | 'prealloc' | 'falloc' */
  fileAllocation: string
  /** Suffix on unfinished files (`incomplete-suffix`), empty when off. */
  incompleteSuffix: '' | '.ray'
  /** Per-tab sort configuration (field + direction), persisted independently per tab. */
  taskSort: import('@/composables/useTaskSort').TaskSortConfig
  /** Per-tab manual task order. Unknown tasks are inserted above stored tasks. */
  taskManualOrder: import('@/composables/useTaskSort').TaskManualOrderConfig
  [key: string]: unknown
}

/** Aria2 engine option dictionary passed to RPC calls (kebab-case keys after formatting). */
export interface Aria2EngineOptions {
  [key: string]: string | string[] | undefined
}

export interface BrowserRequestHeader {
  name: string
  value: string
}

export interface ExternalDownloadContext {
  requestId?: string
  filename?: string
  filenameSource?: 'browser' | 'suggested'
  url?: string
  finalUrl?: string
  referer?: string
  cookie?: string
  userAgent?: string
  requestHeaders?: BrowserRequestHeader[]
  traceId?: string
  /** Bytes to download, when the browser or the engine's check knows them. */
  size?: number
}

export interface ExternalDownloadInput extends ExternalDownloadContext {
  url: string
  finalUrl?: string
  filename?: string
  source?: string
}

/** Saved HTTP Basic authentication credential scoped to a normalized URL origin. */
export interface HttpAuthCredential {
  id: number
  origin: string
  username: string
  password: string
  created_at?: string
  updated_at?: string
  last_used_at?: string | null
}

export interface HttpAuthInput {
  url: string
  username: string
  password: string
}

/** Parameters for adding a URI-based download task. */
export interface AddUriParams {
  contexts?: Record<string, ExternalDownloadContext>
  uris: string[]
  outs: string[]
  options: Aria2EngineOptions
  /** Optional file classification config for per-URI directory routing. */
  fileCategory?: UriFileCategoryPolicy
}

/** File classification for per-URI directory routing. */
export interface UriFileCategoryPolicy {
  enabled: boolean
  categories: FileCategory[]
  contexts?: Record<string, ExternalDownloadContext>
  /** The name the server gives a URI's file, which a redirect may hide from the URI (#730). */
  nameOf?: (uri: string) => string | undefined
}

/** Parameters for changing options on an existing task. */
export interface TaskOptionParams {
  gid: string
  options: Aria2EngineOptions
}

/** Update metadata returned by the Rust `check_for_update` command. */
export interface TauriUpdate {
  version: string
  body: string | null
  date: string | null
  channel: ResolvedUpdateChannel
  requestedChannel: UpdateChannel
}

// ── Batch Add Task ──────────────────────────────────────────────────

export type BatchItemKind = 'uri'
export type BatchItemStatus = 'pending' | 'submitted' | 'failed'

/** A single item in the add-task batch queue. */
export interface BatchItem {
  /** Unique identifier for this batch entry. */
  id: string
  kind: BatchItemKind
  /** Original source path or URI. */
  source: string
  /** Human-readable display name (filename or truncated URI). */
  displayName: string

  payload: string
  /** Browser request context captured by the extension for this item. */
  browserContext?: ExternalDownloadContext

  status: BatchItemStatus
  /** Error message when status is 'failed'. */
  error?: string
}

/** Per-file snapshot stored in HistoryMeta.files for multi-file task reconstruction.
 *
 * Captures all data needed to fully restore restart, delete, and stale-cleanup
 * semantics for each individual file within a multi-file download. */
export interface HistoryFileSnapshot {
  index?: string
  completedLength?: string
  /** Full local file path. */
  path: string
  /** File size as string (aria2 convention). */
  length?: string
  selected?: string
  /** All download URIs for this file — preserving mirrors, not just the first. */
  uris: string[]
}

/** Structured meta payload stored as JSON in HistoryRecord.meta.
 *
 * This is the single source of truth for multi-file task reconstruction.
 * All consumers MUST use the centralized helpers in useTaskLifecycle.ts:
 * - parseHistoryMeta()  — read path
 * - extractHistoryFilePaths() — stale cleanup */
export interface HistoryMeta {
  media?: Aria2Media
  mediaOptions?: Record<string, string>
  completedLength?: string
  errorCode?: string
  errorMessage?: string

  /** Complete file list with all URIs — present when files.length > 1. */
  files?: HistoryFileSnapshot[]
}

/** A completed/errored download record stored in SQLite, independent from the aria2 session. */
export interface HistoryRecord {
  /** Auto-incremented primary key (present on read, omitted on insert). */
  id?: number
  /** aria2 GID — unique identifier for deduplication. */
  gid: string

  name: string

  uri?: string
  /** Local directory where the file was saved. */
  dir?: string
  /** Total file size in bytes. */
  total_length?: number
  /** Terminal status: 'complete', 'error', or 'removed'. */
  status: string

  task_type?: string
  /** ISO 8601 timestamp when the task was first added to the download queue.
   *  Once set, never changes — used for position-stable ordering across all tabs. */
  added_at?: string
  /** ISO 8601 timestamp when the record was created. */
  created_at?: string
  /** ISO 8601 timestamp when the download finished. */
  completed_at?: string

  meta?: string
}

export interface BatchTaskFailure {
  gid: string
  message: string
}

export interface BatchTaskOperationResult {
  succeeded: string[]
  failed: BatchTaskFailure[]
}

export interface TaskDeletionOptions {
  deleteMode?: FileDeletionMode
}

export interface BatchDeleteTaskTarget extends TaskDeletionOptions {
  gid: string
}

export interface ResumeEligibleResult {
  resumed: number
  blocked: number
}

/** Aria2 JSON-RPC client API surface consumed by the task store. */
export interface TaskApi {
  retryMedia: (gid: string) => Promise<string>
  /** Names the task whose details are open, so snapshots carry all its files. */
  setDetailedTask?: (gid: string | null) => Promise<void>
  fetchTaskList: (params: { type: string; limit?: number }) => Promise<Aria2Task[]>
  refreshTasks: () => Promise<TaskSnapshot>
  fetchTaskItem: (params: { gid: string }) => Promise<Aria2Task>
  fetchActiveTaskList: () => Promise<Aria2Task[]>
  addUri: (params: AddUriParams) => Promise<string[]>
  addUriAtomic: (params: { uris: string[]; options: Aria2EngineOptions }) => Promise<string>
  getOption: (params: { gid: string }) => Promise<Record<string, string>>
  changeOption: (params: TaskOptionParams) => Promise<void>
  getFiles: (params: { gid: string }) => Promise<Aria2File[]>
  removeTask: (params: { gid: string }) => Promise<string>
  deleteTask: (params: { gid: string } & TaskDeletionOptions) => Promise<void>
  batchDeleteTasks: (params: { tasks: BatchDeleteTaskTarget[] }) => Promise<BatchTaskOperationResult>
  forcePauseTask: (params: { gid: string }) => Promise<string>
  forcePauseAll: () => Promise<string>
  pauseTask: (params: { gid: string }) => Promise<string>
  resumeTask: (params: { gid: string }) => Promise<string>
  resumeEligible: () => Promise<ResumeEligibleResult>
  removeTaskRecord: (params: { gid: string }) => Promise<string>
  purgeTaskRecords: () => Promise<void>
  saveSession: () => Promise<string>
}
