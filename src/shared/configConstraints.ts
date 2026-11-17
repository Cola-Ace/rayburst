import type { AppConfig } from '@shared/types'

export interface NumericConstraint {
  min: number
  max: number
  integer?: boolean
}

export interface ConfigValidationIssue {
  path: string
  constraint: NumericConstraint
}

/**
 * Runtime contract for every user-editable numeric preference.
 *
 * Engine limits mirror the bundled Aria2 Next option handlers. Product limits
 * are intentionally conservative where the engine itself is effectively
 * unbounded, preventing settings that would exhaust desktop resources.
 */
export const NUMERIC_CONFIG_CONSTRAINTS = {
  autoCheckUpdateInterval: { min: 0, max: 8760, integer: true },
  uiScale: { min: 0.8, max: 1.5 },
  speedScheduleDays: { min: 0, max: 96, integer: true },
  taskPageSize: { min: 1, max: 100, integer: true },
  maxConcurrentDownloads: { min: 1, max: 100, integer: true },
  streamMaxConnections: { min: 1, max: 256, integer: true },
  maxTries: { min: 0, max: 60, integer: true },
  retryWait: { min: 0, max: 600, integer: true },
  connectTimeout: { min: 1, max: 600, integer: true },
  timeout: { min: 1, max: 600, integer: true },
  rpcListenPort: { min: 1024, max: 65535, integer: true },
  extensionApiPort: { min: 1024, max: 65535, integer: true },
  completedRecordRetentionDays: { min: 0, max: 3650, integer: true },
} as const satisfies Partial<Record<keyof AppConfig, NumericConstraint>>

export type NumericConfigKey = keyof typeof NUMERIC_CONFIG_CONSTRAINTS

export const NUMERIC_CONFIG_ENUM_VALUES = {
  autoCheckUpdateInterval: [0, 24, 168, 720, 4320, 8760],
  uiScale: [0.8, 0.9, 1, 1.1, 1.25, 1.5],
  speedScheduleDays: [0, 31, 96],
} as const satisfies Partial<Record<keyof AppConfig, readonly number[]>>

export function isNumericValueValid(value: unknown, constraint: NumericConstraint): value is number {
  const numericValue = Number(value)
  return (
    Number.isFinite(numericValue) &&
    (!constraint.integer || Number.isInteger(numericValue)) &&
    numericValue >= constraint.min &&
    numericValue <= constraint.max
  )
}

export function isConfigNumericValueValid(key: NumericConfigKey, value: unknown): boolean {
  return isNumericValueValid(value, NUMERIC_CONFIG_CONSTRAINTS[key])
}

export function getInvalidNumericConfigKeys(config: Partial<AppConfig>): NumericConfigKey[] {
  return (Object.keys(NUMERIC_CONFIG_CONSTRAINTS) as NumericConfigKey[]).filter(
    (key) => config[key] !== undefined && !isConfigNumericValueValid(key, config[key]),
  )
}

export function validateAppConfigCandidate(config: Partial<AppConfig>): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = getInvalidNumericConfigKeys(config).map((path) => ({
    path,
    constraint: NUMERIC_CONFIG_CONSTRAINTS[path],
  }))

  for (const [path, allowed] of Object.entries(NUMERIC_CONFIG_ENUM_VALUES)) {
    const value = config[path as keyof AppConfig]
    if (value !== undefined && !allowed.includes(Number(value) as never)) {
      issues.push({
        path,
        constraint: { min: Math.min(...allowed), max: Math.max(...allowed), integer: true },
      })
    }
  }

  return issues
}
