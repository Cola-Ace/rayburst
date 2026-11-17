import { buildAdvancedForm, buildAdvancedSystemConfig } from '@/composables/useAdvancedPreference'
import { buildDownloadsForm, buildDownloadsSystemConfig } from '@/composables/useDownloadsPreference'
import { buildNetworkForm, buildNetworkSystemConfig } from '@/composables/useNetworkPreference'
import type { AppConfig } from '@shared/types'

export function buildSystemConfigFromAppConfig(config: AppConfig, defaultDir = ''): Record<string, string> {
  const downloadsSystem = buildDownloadsSystemConfig(buildDownloadsForm(config, defaultDir))
  const networkSystem = buildNetworkSystemConfig(buildNetworkForm(config))
  const advancedSystem = buildAdvancedSystemConfig(buildAdvancedForm(config))

  return {
    ...downloadsSystem,
    ...networkSystem,
    ...advancedSystem,
  }
}
