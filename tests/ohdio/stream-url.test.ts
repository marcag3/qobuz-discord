import { describe, expect, it } from "vitest"
import { isAllowedOhdioStreamUrl } from "../../src/ohdio/stream-url.js"

describe("isAllowedOhdioStreamUrl", () => {
  it("accepts Radio-Canada Akamai HLS hosts", () => {
    expect(isAllowedOhdioStreamUrl("https://rcavmedias-static.akamaized.net/hls/file.m3u8")).toBe(true)
    expect(isAllowedOhdioStreamUrl("https://rcavliveaudio.akamaized.net/hls/live/master.m3u8")).toBe(true)
    expect(isAllowedOhdioStreamUrl("https://rchdslive-f.akamaihd.net/i/master.m3u8")).toBe(true)
    expect(isAllowedOhdioStreamUrl("http://rchdslive-f.akamaihd.net/i/master.m3u8")).toBe(true)
  })

  it("rejects unexpected hosts", () => {
    expect(isAllowedOhdioStreamUrl("https://evil.com/file.m3u8")).toBe(false)
    expect(isAllowedOhdioStreamUrl("https://streaming-qobuz-std.akamaized.net/file.mp3")).toBe(false)
  })
})
