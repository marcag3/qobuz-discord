import { describe, expect, it } from "vitest"
import { formatListeningActivity } from "../../src/bot/presence.js"

describe("presence", () => {
  const track = {
    id: 1,
    title: "Bohemian Rhapsody",
    artistName: "Queen",
    albumTitle: "A Night at the Opera",
    durationSeconds: 354,
  }

  it("formats listening activity with artist as state", () => {
    expect(formatListeningActivity(track, false)).toEqual({
      name: "Bohemian Rhapsody",
      state: "Queen",
    })
  })

  it("marks paused tracks in activity state", () => {
    expect(formatListeningActivity(track, true)).toEqual({
      name: "Bohemian Rhapsody",
      state: "Paused · Queen",
    })
  })

  it("truncates long titles and state text", () => {
    const longTrack = {
      ...track,
      title: "A".repeat(140),
      artistName: "B".repeat(140),
    }
    const activity = formatListeningActivity(longTrack, false)
    expect(activity.name).toHaveLength(128)
    expect(activity.name.endsWith("…")).toBe(true)
    expect(activity.state).toHaveLength(128)
    expect(activity.state.endsWith("…")).toBe(true)
  })
})
