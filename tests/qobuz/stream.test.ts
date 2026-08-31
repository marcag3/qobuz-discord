import { describe, expect, it } from "vitest"
import { deriveSecretsFromBundle, signTrackFileUrl } from "../../src/qobuz/stream.js"

describe("signTrackFileUrl", () => {
  it("produces deterministic MD5 signature", () => {
    const sig = signTrackFileUrl(5, 54091881, "1700000000", "0123456789abcdef0123456789abcdef")
    expect(sig).toMatch(/^[0-9a-f]{32}$/)
    expect(signTrackFileUrl(5, 54091881, "1700000000", "0123456789abcdef0123456789abcdef")).toBe(sig)
  })
})

describe("deriveSecretsFromBundle", () => {
  it("returns empty array when bundle has no seeds", () => {
    expect(deriveSecretsFromBundle("no seeds here")).toEqual([])
  })
})
