import { describe, expect, it } from "vitest"
import { filesToTracks, uniqueMediaIds } from "../../src/ohdio/playback.js"
import type { PlaybackCue } from "../../src/ohdio/types.js"

function cue(mediaId: string, title: string, seek = 0): PlaybackCue {
  return {
    title,
    productTitle: "Pénélope",
    appCode: "medianet",
    mediaPlaybackItem: { mediaId, mediaSeekTime: seek },
  }
}

describe("uniqueMediaIds", () => {
  it("collapses consecutive cues that share a mediaId", () => {
    const files = uniqueMediaIds([
      cue("10681661", "Hour 1", 0),
      cue("10681661", "Hour 1 b", 117),
      cue("10681756", "Hour 2", 0),
      cue("10681806", "Hour 3", 0),
    ])
    expect(files.map((file) => file.mediaId)).toEqual(["10681661", "10681756", "10681806"])
    expect(files[0].cues).toHaveLength(2)
  })
})

describe("filesToTracks", () => {
  it("builds string ids with source ohdio and part labels", () => {
    const tracks = filesToTracks(
      uniqueMediaIds([cue("1", "A"), cue("2", "B")]),
      { title: "Mercredi", show: "Pénélope", url: "/premiere/emissions/penelope/episodes/1/x" }
    )
    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toMatchObject({
      id: "1",
      source: "ohdio",
      title: "Mercredi (1/2)",
      artistName: "Pénélope",
    })
    expect(tracks[0].url).toContain("/ohdio/")
  })

  it("strips HTML from titles", () => {
    const tracks = filesToTracks(uniqueMediaIds([cue("1", "Le film <em>Pauline</em>")]), {
      title: "Episode",
      show: "Pénélope",
    })
    expect(tracks[0].title).toBe("Le film Pauline")
  })
})
