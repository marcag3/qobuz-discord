import { describe, expect, it, vi } from "vitest"
import { resolveQueryToTracks } from "../../src/bot/commands/resolver.js"
import type { QobuzService } from "../../src/qobuz/client.js"

describe("resolveQueryToTracks", () => {
  it("uses most_popular #1 and expands it", async () => {
    const top = { type: "tracks" as const, id: 1, title: "Creep", artistName: "Radiohead" }
    const tracks = [{ id: 1, title: "Creep", artistName: "Radiohead" }]

    const qobuz = {
      search: vi.fn().mockResolvedValue({ mostPopular: [top] }),
      expandToTracks: vi.fn().mockResolvedValue(tracks),
    } as unknown as QobuzService

    const result = await resolveQueryToTracks(qobuz, "radiohead creep")
    expect(result).toEqual(tracks)
    expect(qobuz.search).toHaveBeenCalledWith("radiohead creep")
    expect(qobuz.expandToTracks).toHaveBeenCalledWith(top)
  })
})
