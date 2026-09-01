import { describe, expect, it } from "vitest"
import { buildControlRows, buildNowPlayingEmbed, CONTROL_IDS } from "../../src/bot/messages.js"

describe("messages", () => {
  const track = {
    id: 1,
    title: "Bohemian Rhapsody",
    artistName: "Queen",
    albumTitle: "A Night at the Opera",
    albumCoverUrl: "https://example.com/cover.jpg",
    durationSeconds: 354,
  }

  it("builds now playing embed with thumbnail and duration", () => {
    const embed = buildNowPlayingEmbed(track)
    expect(embed.data.title).toBe("Now Playing")
    expect(embed.data.description).toContain("Bohemian Rhapsody")
    expect(embed.data.thumbnail?.url).toBe("https://example.com/cover.jpg")
    expect(embed.data.footer?.text).toContain("5:54")
  })

  it("builds control rows with dynamic labels", () => {
    const paused = buildControlRows({ loopMode: "track", shuffle: true, paused: true })
    expect(paused[0].components[0].data.label).toBe("Resume")
    expect(paused[0].components[2].data.label).toBe("Shuffle On")
    expect(paused[0].components[3].data.label).toBe("Loop: Track")

    const playing = buildControlRows({ loopMode: "off", shuffle: false, paused: false })
    expect(playing[0].components[0].data.label).toBe("Pause")
    expect(playing[0].components[3].data.label).toBe("Loop: Off")
  })

  it("builds queue embed with current track", async () => {
    const { buildQueueEmbed } = await import("../../src/bot/messages.js")
    const embed = buildQueueEmbed([track], track)
    expect(embed.data.fields?.[0]?.name).toBe("Now Playing")
  })

  it("defines stable control button ids", () => {
    expect(CONTROL_IDS.skip).toBe("np:skip")
    expect(CONTROL_IDS.pause).toBe("np:pause")
    expect(CONTROL_IDS.shuffle).toBe("np:shuffle")
    expect(CONTROL_IDS.loop).toBe("np:loop")
  })
})
