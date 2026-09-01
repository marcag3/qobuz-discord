import { describe, expect, it, vi } from "vitest"
import { expandToTracks } from "../../src/qobuz/expand.js"
import type { PopularItem } from "../../src/qobuz/types.js"

function mockTransport(handlers: Record<string, unknown>) {
  return {
    get: vi.fn(async (endpoint: string) => {
      if (!(endpoint in handlers)) throw new Error(`unexpected endpoint ${endpoint}`)
      return handlers[endpoint]
    }),
  }
}

describe("expandToTracks", () => {
  it("expands album items to track list", async () => {
    const transport = mockTransport({
      "album/get": {
        tracks: {
          items: [
            {
              id: 1,
              title: "Track One",
              performer: { name: "Queen" },
              album: { image: { large: "https://example.com/cover.jpg" } },
            },
            { id: 2, title: "Track Two", performer: { name: "Queen" } },
          ],
        },
      },
    })

    const item: PopularItem = { type: "albums", id: 99, title: "Album" }
    const tracks = await expandToTracks(transport as never, item)

    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toMatchObject({
      id: 1,
      title: "Track One",
      artistName: "Queen",
      albumCoverUrl: "https://example.com/cover.jpg",
    })
  })

  it("expands track items directly", async () => {
    const transport = mockTransport({
      "track/get": {
        id: 424950499,
        title: "And We Knew It Was Our Time",
        performer: { name: "Lane 8" },
      },
    })

    const item: PopularItem = {
      type: "tracks",
      id: 424950499,
      title: "And We Knew It Was Our Time",
      artistName: "Lane 8",
    }

    const tracks = await expandToTracks(transport as never, item)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].id).toBe(424950499)
  })

  it("expands artist items via artist/get tracks extra", async () => {
    const transport = mockTransport({
      "artist/get": {
        tracks: {
          items: [
            { id: 1, title: "And We Knew It Was Our Time", performer: { name: "Lane 8" } },
            { id: 2, title: "Fingers", performer: { name: "Lane 8" } },
          ],
        },
      },
    })

    const item: PopularItem = { type: "artists", id: 1282560, title: "Lane 8" }
    const tracks = await expandToTracks(transport as never, item)

    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toMatchObject({
      id: 1,
      title: "And We Knew It Was Our Time",
      artistName: "Lane 8",
    })
  })
})
