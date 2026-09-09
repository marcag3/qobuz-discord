import { describe, expect, it, vi } from "vitest"
import { resolvePlayQuery } from "../../src/catalog/resolve.js"
import type { OhdioClient } from "../../src/ohdio/client.js"
import type { QobuzService } from "../../src/qobuz/client.js"
import type { Track } from "../../src/player/track.js"

function qobuzTrack(): Track {
  return { id: "1", source: "qobuz", title: "Song", artistName: "Artist" }
}

function ohdioTrack(): Track {
  return { id: "10681661", source: "ohdio", title: "Pénélope", artistName: "ICI Première" }
}

describe("resolvePlayQuery", () => {
  it("routes Ohdio URLs to the Ohdio client", async () => {
    const tracks = [ohdioTrack()]
    const ohdio = { expandFromQuery: vi.fn().mockResolvedValue(tracks) } as unknown as OhdioClient
    const qobuz = { search: vi.fn(), expandFromUrl: vi.fn() } as unknown as QobuzService

    const result = await resolvePlayQuery(
      qobuz,
      ohdio,
      "https://ici.radio-canada.ca/ohdio/premiere/emissions/penelope/episodes/1091696/x"
    )

    expect(ohdio.expandFromQuery).toHaveBeenCalled()
    expect(qobuz.search).not.toHaveBeenCalled()
    expect(result).toEqual(tracks)
  })

  it("keeps Qobuz search for plain queries", async () => {
    const tracks = [qobuzTrack()]
    const ohdio = { expandFromQuery: vi.fn() } as unknown as OhdioClient
    const qobuz = {
      search: vi.fn().mockResolvedValue({
        mostPopular: [{ type: "tracks", id: 1, title: "Song" }],
      }),
      expandToTracks: vi.fn().mockResolvedValue(tracks),
      expandFromUrl: vi.fn(),
    } as unknown as QobuzService

    const result = await resolvePlayQuery(qobuz, ohdio, "bohemian rhapsody")
    expect(qobuz.search).toHaveBeenCalledWith("bohemian rhapsody")
    expect(ohdio.expandFromQuery).not.toHaveBeenCalled()
    expect(result).toEqual(tracks)
  })
})
