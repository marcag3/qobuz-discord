import { describe, expect, it } from "vitest"
import {
  buildPlaybackFfmpegArgs,
  MAX_MISSED_FRAMES,
  PCM_BYTES_PER_SECOND,
  PCM_PREFETCH_SECONDS,
  resolveFfmpegPath,
} from "../src/ffmpeg.js"

describe("buildPlaybackFfmpegArgs", () => {
  it("reads HTTP at decode speed so a PCM prefetch buffer can fill", () => {
    const args = buildPlaybackFfmpegArgs("https://example.com/audio.m3u8")
    expect(args).not.toContain("-re")
    expect(args.slice(args.indexOf("-i"))).toEqual([
      "-i",
      "https://example.com/audio.m3u8",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1",
    ])
  })

  it("seeks and sends a User-Agent before opening the input", () => {
    const args = buildPlaybackFfmpegArgs("https://cdn.example/file.m3u8", {
      seekSeconds: 117,
      userAgent: "GallantBot",
    })
    const inputIndex = args.indexOf("-i")
    expect(args.slice(0, inputIndex)).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-user_agent",
      "GallantBot",
      "-ss",
      "117",
    ])
  })
})

describe("voice playback constants", () => {
  it("tolerates multi-segment HLS stalls instead of the 100 ms library default", () => {
    expect(MAX_MISSED_FRAMES).toBeGreaterThan(5)
    expect(PCM_BYTES_PER_SECOND).toBe(192_000)
    expect(PCM_PREFETCH_SECONDS).toBeGreaterThanOrEqual(2)
  })

  it("uses system ffmpeg by default", () => {
    expect(resolveFfmpegPath({})).toBe("ffmpeg")
    expect(resolveFfmpegPath({ FFMPEG_PATH: " /usr/bin/ffmpeg " })).toBe("/usr/bin/ffmpeg")
  })
})
