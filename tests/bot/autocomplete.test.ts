import { describe, expect, it, vi } from "vitest"
import { handleAutocomplete } from "../../src/bot/autocomplete.js"
import type { AutocompleteInteraction } from "discord.js"
import type { QobuzClient } from "../../src/qobuz/types.js"

function mockInteraction(focused: string) {
  const respond = vi.fn()
  return {
    options: { getFocused: () => focused },
    respond,
  } as unknown as AutocompleteInteraction & { respond: ReturnType<typeof vi.fn> }
}

function mockQobuz(items: QobuzClient["search"] extends (...args: never) => infer R ? Awaited<R> : never): QobuzClient {
  return {
    search: vi.fn().mockResolvedValue(items),
    resolveUrlItem: vi.fn(),
    expandToTracks: vi.fn(),
    getStreamUrl: vi.fn(),
  }
}

describe("handleAutocomplete", () => {
  it("returns empty for short queries", async () => {
    const interaction = mockInteraction("a")
    await handleAutocomplete(interaction, mockQobuz({ mostPopular: [] }))
    expect(interaction.respond).toHaveBeenCalledWith([])
  })

  it("formats choices with Qobuz URLs", async () => {
    const interaction = mockInteraction("bohemian")
    const qobuz = mockQobuz({
      mostPopular: [
        { type: "tracks", id: 12345, title: "Bohemian Rhapsody", artistName: "Queen" },
      ],
    })

    await handleAutocomplete(interaction, qobuz)

    expect(qobuz.search).toHaveBeenCalledWith("bohemian", 25)
    expect(interaction.respond).toHaveBeenCalledWith([
      {
        name: "Track: Bohemian Rhapsody — Queen",
        value: "https://open.qobuz.com/track/12345",
      },
    ])
  })

  it("resolves pasted Qobuz URLs without searching", async () => {
    const url = "https://play.qobuz.com/album/ntpjmh3w7c1nq"
    const interaction = mockInteraction(url)
    const qobuz = mockQobuz({ mostPopular: [] })
    qobuz.resolveUrlItem = vi.fn().mockResolvedValue({
      type: "albums",
      id: "ntpjmh3w7c1nq",
      title: "August 26",
      artistName: "Post Malone",
    })

    await handleAutocomplete(interaction, qobuz)

    expect(qobuz.resolveUrlItem).toHaveBeenCalledWith(url)
    expect(qobuz.search).not.toHaveBeenCalled()
    expect(interaction.respond).toHaveBeenCalledWith([
      {
        name: "Album: August 26 — Post Malone",
        value: "https://open.qobuz.com/album/ntpjmh3w7c1nq",
      },
    ])
  })

  it("truncates long choice names to 100 chars", async () => {
    const interaction = mockInteraction("long")
    const longTitle = "A".repeat(120)
    const qobuz = mockQobuz({
      mostPopular: [{ type: "albums", id: 1, title: longTitle, artistName: "Artist" }],
    })

    await handleAutocomplete(interaction, qobuz)

    const choices = interaction.respond.mock.calls[0][0] as { name: string }[]
    expect(choices[0].name.length).toBeLessThanOrEqual(100)
    expect(choices[0].name.endsWith("…")).toBe(true)
  })

  it("falls back to empty on search error", async () => {
    const interaction = mockInteraction("query")
    const qobuz: QobuzClient = {
      search: vi.fn().mockRejectedValue(new Error("fail")),
      resolveUrlItem: vi.fn(),
      expandToTracks: vi.fn(),
      getStreamUrl: vi.fn(),
    }

    await handleAutocomplete(interaction, qobuz)
    expect(interaction.respond).toHaveBeenCalledWith([])
  })
})
