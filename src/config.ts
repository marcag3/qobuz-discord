export type AppConfig = {
  discordToken: string
  discordClientId: string
  qobuzUserToken: string
  guildId?: string
  qobuzAppId?: string
  qobuzAppSecret?: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const discordToken = requireEnv(env, "DISCORD_TOKEN")
  const discordClientId = requireEnv(env, "DISCORD_CLIENT_ID")
  const qobuzUserToken = requireEnv(env, "QOBUZ_USER_TOKEN")

  return {
    discordToken,
    discordClientId,
    qobuzUserToken,
    guildId: optionalEnv(env, "GUILD_ID"),
    qobuzAppId: optionalEnv(env, "QOBUZ_APP_ID"),
    qobuzAppSecret: optionalEnv(env, "QOBUZ_APP_SECRET"),
  }
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
