import { describe, expect, it } from "vitest"
import { parseQobuzUrl, isQobuzUrl } from "../../src/qobuz/url.js"

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

  it("returns null for non-qobuz URLs", () => {
    expect(parseQobuzUrl("bohemian rhapsody")).toBeNull()
    expect(isQobuzUrl("bohemian rhapsody")).toBe(false)
  })
})
