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
      qobuzCredentialsPath: "data/qobuz-credentials.json",
      ownerIds: [],
      ohdioRegionId: 8,
    })
  })

  it("parses comma-separated OWNER_ID and QOBUZ_CREDENTIALS_PATH", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "discord-token",
      DISCORD_CLIENT_ID: "123456789",
      OWNER_ID: " 123456789012345678 , 223456789012345678 ",
      QOBUZ_CREDENTIALS_PATH: "/data/creds.json",
    })

    expect(config.ownerIds).toEqual(["123456789012345678", "223456789012345678"])
    expect(config.qobuzCredentialsPath).toBe("/data/creds.json")
  })

  it("rejects OWNER_ID values that are not Discord user IDs", () => {
    expect(() =>
      loadConfig({ DISCORD_TOKEN: "x", DISCORD_CLIENT_ID: "1", OWNER_ID: "marc" })
    ).toThrow(ConfigError)
  })

  it("allows missing QOBUZ_USER_TOKEN", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "discord-token",
      DISCORD_CLIENT_ID: "123456789",
    })

    expect(config.qobuzUserToken).toBeUndefined()
  })

  it("throws when required vars are missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
    expect(() => loadConfig({ DISCORD_TOKEN: "x" })).toThrow(
      "Missing required environment variable: DISCORD_CLIENT_ID"
    )
  })

  it("reads OHDIO_REGION_ID when set", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "discord-token",
      DISCORD_CLIENT_ID: "123456789",
      QOBUZ_USER_TOKEN: "qobuz-token",
      OHDIO_REGION_ID: "11",
    })
    expect(config.ohdioRegionId).toBe(11)
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
