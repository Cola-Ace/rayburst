import type { AppConfig } from '@shared/types'

// ── Types ───────────────────────────────────────────────────────────

export interface GeneralForm {
  [key: string]: unknown
  locale: AppConfig['locale']
  theme: AppConfig['theme']
  colorScheme: string
  customColorScheme: string
  taskCardMode: AppConfig['taskCardMode']
  showLogoWhenEmpty: boolean
  reduceMotion: boolean
  sidebarTaskCounts: boolean
  iecSizeUnits: boolean
  systemTitleBar: boolean
  showProgressBar: boolean
  floatWindow: AppConfig['floatWindow']
  floatWindowInLightweight: boolean
  dockBadgeSpeed: boolean
  openAtLogin: boolean
  autoHideWindow: boolean
  keepWindowState: boolean
  resumeAllWhenAppLaunched: boolean
  minimizeToTrayOnClose: boolean
  quitOnClose: boolean
  showTrayIcon: boolean
  hideDockOnMinimize: boolean
  traySpeedometer: boolean
  lightweightMode: boolean
  // Notifications
  taskNotification: boolean
  notifyOnStart: boolean
  notifyOnComplete: boolean
  notificationClickAction: AppConfig['notificationClickAction']
}

// ── Pure Functions ──────────────────────────────────────────────────

/**
 * Builds the general form state from the preference store config.
 */
export function buildGeneralForm(config: AppConfig): GeneralForm {
  return {
    locale: config.locale,
    theme: config.theme,
    colorScheme: config.colorScheme,
    customColorScheme: config.customColorScheme,
    taskCardMode: config.taskCardMode,
    showLogoWhenEmpty: config.showLogoWhenEmpty,
    reduceMotion: config.reduceMotion,
    sidebarTaskCounts: config.sidebarTaskCounts,
    iecSizeUnits: config.iecSizeUnits,
    systemTitleBar: config.systemTitleBar,
    showProgressBar: config.showProgressBar,
    floatWindow: config.floatWindow,
    floatWindowInLightweight: config.floatWindowInLightweight,
    dockBadgeSpeed: config.dockBadgeSpeed,
    openAtLogin: config.openAtLogin,
    autoHideWindow: config.autoHideWindow,
    keepWindowState: config.keepWindowState,
    resumeAllWhenAppLaunched: config.resumeAllWhenAppLaunched,
    minimizeToTrayOnClose: config.minimizeToTrayOnClose,
    quitOnClose: config.quitOnClose,
    showTrayIcon: config.showTrayIcon,
    hideDockOnMinimize: config.hideDockOnMinimize,
    traySpeedometer: config.traySpeedometer,
    lightweightMode: config.lightweightMode,
    taskNotification: config.taskNotification,
    notifyOnStart: config.notifyOnStart,
    notifyOnComplete: config.notifyOnComplete,
    notificationClickAction: config.notificationClickAction,
  }
}

export function transformGeneralForStore(form: GeneralForm): Partial<AppConfig> {
  return { ...form }
}
