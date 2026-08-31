import { describe, expect, it } from "vitest"
import { loadConfig, ConfigError } from "../src/config.js"

describe("loadConfig", () => {
  it("loads required env vars", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "discord-token",
      DISCORD_CLIENT_ID: "123456789",
      QOBUZ_USER_TOKEN: "qobuz-token",
      GUILD_ID: "guild-1",
    })

    expect(config).toEqual({
      discordToken: "discord-token",
      discordClientId: "123456789",
      qobuzUserToken: "qobuz-token",
      guildId: "guild-1",
      qobuzAppId: undefined,
      qobuzAppSecret: undefined,
    })
  })

  it("throws when required vars are missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
    expect(() => loadConfig({ DISCORD_TOKEN: "x" })).toThrow(
      "Missing required environment variable: DISCORD_CLIENT_ID"
    )
  })

  it("ignores empty optional vars", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "discord-token",
      DISCORD_CLIENT_ID: "123456789",
      QOBUZ_USER_TOKEN: "qobuz-token",
      GUILD_ID: "   ",
    })

    expect(config.guildId).toBeUndefined()
  })
})
