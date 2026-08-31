import { describe, expect, it } from "vitest"
import { buildNowPlayingEmbed, buildQueueEmbed, CONTROL_IDS } from "../../src/bot/messages.js"

describe("messages", () => {
  const track = {
    id: 1,
    title: "Bohemian Rhapsody",
    artistName: "Queen",
    albumTitle: "A Night at the Opera",
  }

  it("builds now playing embed", () => {
    const embed = buildNowPlayingEmbed(track)
    expect(embed.data.title).toBe("Now Playing")
    expect(embed.data.description).toContain("Bohemian Rhapsody")
  })

  it("builds queue embed with current track", () => {
    const embed = buildQueueEmbed([track], track)
    expect(embed.data.fields?.[0]?.name).toBe("Now Playing")
  })

  it("defines stable control button ids", () => {
    expect(CONTROL_IDS.skip).toBe("np:skip")
  })
})
