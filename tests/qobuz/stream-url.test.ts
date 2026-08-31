import { describe, expect, it } from "vitest"
import { isAllowedStreamUrl } from "../../src/qobuz/stream-url.js"

describe("isAllowedStreamUrl", () => {
  it("accepts Qobuz CDN hosts", () => {
    expect(isAllowedStreamUrl("https://streaming-qobuz-std.akamaized.net/file.mp3")).toBe(true)
    expect(isAllowedStreamUrl("https://media.qobuz.com/stream.flac")).toBe(true)
  })

  it("rejects non-https URLs", () => {
    expect(isAllowedStreamUrl("http://streaming-qobuz-std.akamaized.net/file.mp3")).toBe(false)
  })

  it("rejects unexpected hosts", () => {
    expect(isAllowedStreamUrl("https://evil.com/file.mp3")).toBe(false)
    expect(isAllowedStreamUrl("https://other.akamaized.net/file.mp3")).toBe(false)
    expect(isAllowedStreamUrl("file:///etc/passwd")).toBe(false)
  })

  it("rejects credentials in URL", () => {
    expect(isAllowedStreamUrl("https://user:pass@media.qobuz.com/file.mp3")).toBe(false)
  })
})
