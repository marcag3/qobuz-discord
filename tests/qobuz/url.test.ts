import { describe, expect, it } from "vitest"
import { buildQobuzUrl, buildTrackUrl, parseQobuzUrl, isQobuzUrl } from "../../src/qobuz/url.js"

describe("buildQobuzUrl", () => {
  it("builds track URLs", () => {
    expect(buildTrackUrl(424950499)).toBe("https://open.qobuz.com/track/424950499")
    expect(buildQobuzUrl("albums", 12345)).toBe("https://open.qobuz.com/album/12345")
  })
})

describe("parseQobuzUrl", () => {
  it("parses track URLs", () => {
    expect(parseQobuzUrl("https://open.qobuz.com/track/424950499")).toEqual({
      type: "tracks",
      id: 424950499,
    })
  })

  it("parses album URLs", () => {
    expect(parseQobuzUrl("https://open.qobuz.com/album/12345")).toEqual({
      type: "albums",
      id: 12345,
    })
  })

  it("parses play.qobuz.com album slug URLs", () => {
    const url = "https://play.qobuz.com/album/ntpjmh3w7c1nq"
    expect(isQobuzUrl(url)).toBe(true)
    expect(parseQobuzUrl(url)).toEqual({
      type: "albums",
      id: "ntpjmh3w7c1nq",
    })
  })

  it("returns null for non-qobuz URLs", () => {
    expect(parseQobuzUrl("bohemian rhapsody")).toBeNull()
    expect(isQobuzUrl("bohemian rhapsody")).toBe(false)
  })
})
