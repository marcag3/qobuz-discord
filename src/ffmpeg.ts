/** System ffmpeg — ffmpeg-static segfaults on some Linux builds (see voice spike). */
export function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FFMPEG_PATH?.trim()
  if (configured) return configured
  return "ffmpeg"
}
