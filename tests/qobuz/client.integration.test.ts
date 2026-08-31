import { describe, expect, it } from "vitest"
import { loadConfig } from "../../src/config.js"
import { createQobuzClient } from "../../src/qobuz/client.js"

const hasToken = Boolean(process.env.QOBUZ_USER_TOKEN)

describe.skipIf(!hasToken)("Qobuz integration", () => {
  it("searches most_popular and resolves a stream URL", async () => {
    const config = loadConfig({
      DISCORD_TOKEN: process.env.DISCORD_TOKEN ?? "test",
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ?? "123",
      QOBUZ_USER_TOKEN: process.env.QOBUZ_USER_TOKEN!,
      QOBUZ_APP_ID: process.env.QOBUZ_APP_ID,
      QOBUZ_APP_SECRET: process.env.QOBUZ_APP_SECRET,
    })

    const client = createQobuzClient(config)
    await client.init()

    const result = await client.search("bohemian rhapsody", 5)
    expect(result.mostPopular.length).toBeGreaterThan(0)

    const tracks = await client.expandToTracks(result.mostPopular[0])
    expect(tracks.length).toBeGreaterThan(0)

    const stream = await client.getStreamUrl(tracks[0].id)
    expect(stream.url).toMatch(/^https:\/\//)
  }, 60_000)
})
