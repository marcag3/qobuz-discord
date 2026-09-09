import { describe, expect, it } from "vitest"
import { matchLiveStation, liveTrackFromStation, isStrongLiveMatch } from "../../src/ohdio/live.js"
import type { LiveStation } from "../../src/ohdio/types.js"

const stations: LiveStation[] = [
  { callSign: "cbf", networkId: 3, networkTitle: "ICI Première", onAir: { title: "Pénélope", startTime: "", endTime: "" } },
  { callSign: "cbfx", networkId: 4, networkTitle: "ICI Musique" },
  { callSign: "sp01radio", networkId: 16, networkTitle: "ICI Musique Classique" },
]

describe("matchLiveStation", () => {
  it("matches premiere/musique aliases and call signs", () => {
    expect(matchLiveStation(stations, "ici première")?.callSign).toBe("cbf")
    expect(matchLiveStation(stations, "musique")?.callSign).toBe("cbfx")
    expect(matchLiveStation(stations, "cbf")?.callSign).toBe("cbf")
    expect(matchLiveStation(stations, "classique")?.callSign).toBe("sp01radio")
  })

  it("treats network-name tokens as strong live matches", () => {
    const classique = stations[2]
    expect(isStrongLiveMatch(classique, "classique")).toBe(true)
    expect(isStrongLiveMatch(classique, "penelope")).toBe(false)
  })
})

describe("liveTrackFromStation", () => {
  it("builds an infinite Ohdio track", () => {
    const track = liveTrackFromStation(stations[0])
    expect(track).toMatchObject({
      id: "live:cbf",
      source: "ohdio",
      title: "Pénélope",
      artistName: "ICI Première",
      infinite: true,
      appCode: "medianetlive",
    })
  })
})
