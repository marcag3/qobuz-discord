import { DEFAULT_REGION_ID } from "./ohdio/constants.js"

export type AppConfig = {
  discordToken: string
  discordClientId: string
  qobuzUserToken?: string
  guildId?: string
  qobuzAppId?: string
  qobuzAppSecret?: string
  qobuzCredentialsPath: string
  ownerIds: string[]
  ohdioRegionId: number
}

export const DEFAULT_QOBUZ_CREDENTIALS_PATH = "data/qobuz-credentials.json"

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const discordToken = requireEnv(env, "DISCORD_TOKEN")
  const discordClientId = requireEnv(env, "DISCORD_CLIENT_ID")

  return {
    discordToken,
    discordClientId,
    qobuzUserToken: optionalEnv(env, "QOBUZ_USER_TOKEN"),
    guildId: optionalEnv(env, "GUILD_ID"),
    qobuzAppId: optionalEnv(env, "QOBUZ_APP_ID"),
    qobuzAppSecret: optionalEnv(env, "QOBUZ_APP_SECRET"),
    qobuzCredentialsPath:
      optionalEnv(env, "QOBUZ_CREDENTIALS_PATH") ?? DEFAULT_QOBUZ_CREDENTIALS_PATH,
    ownerIds: parseOwnerIds(env.OWNER_ID),
    ohdioRegionId: parseRegionId(env.OHDIO_REGION_ID),
  }
}

function parseOwnerIds(value: string | undefined): string[] {
  const ids = (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  const invalid = ids.find((id) => !/^\d{17,20}$/.test(id))
  if (invalid) {
    throw new ConfigError(`OWNER_ID must be Discord user IDs (comma-separated), got: ${invalid}`)
  }
  return ids
}

function parseRegionId(value: string | undefined): number {
  const parsed = Number(value?.trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_REGION_ID
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${key}`)
  }
  return value
}

function optionalEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value || undefined
}
