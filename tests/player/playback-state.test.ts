import { describe, expect, it } from "vitest"
import { cycleLoopMode, createPlaybackState } from "../../src/player/playback-state.js"

describe("playback-state", () => {
  it("cycles loop mode off → track → queue → off", () => {
    expect(cycleLoopMode("off")).toBe("track")
    expect(cycleLoopMode("track")).toBe("queue")
    expect(cycleLoopMode("queue")).toBe("off")
  })

  it("creates default playback state", () => {
    expect(createPlaybackState()).toEqual({
      loopMode: "off",
      shuffle: false,
      paused: false,
    })
  })
})
