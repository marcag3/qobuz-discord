/** System ffmpeg — ffmpeg-static segfaults on some Linux builds (see voice spike). */
export function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FFMPEG_PATH?.trim()
  if (configured) return configured
  return "ffmpeg"
}

/** s16le stereo 48 kHz — Discord's raw PCM input. */
export const PCM_BYTES_PER_SECOND = 48_000 * 2 * 2

/** Prefetch this many seconds of PCM so HLS segment fetches do not starve the player. */
export const PCM_PREFETCH_SECONDS = 4

/**
 * @discordjs/voice stops after this many consecutive 20 ms packets without audio.
 * The library default is 5 (100 ms). Ohdio HLS is AES-128 in ~10 s segments; ffmpeg
 * pauses stdout while it fetches and decrypts the next segment, which is longer than 100 ms.
 */
export const MAX_MISSED_FRAMES = 250

export function buildPlaybackFfmpegArgs(
  url: string,
  options: { seekSeconds?: number; userAgent?: string } = {}
): string[] {
  const args = ["-hide_banner", "-loglevel", "error"]
  if (options.userAgent) {
    args.push("-user_agent", options.userAgent)
  }
  if (options.seekSeconds && options.seekSeconds > 0) {
    args.push("-ss", String(options.seekSeconds))
  }
  args.push("-i", url, "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1")
  return args
}
