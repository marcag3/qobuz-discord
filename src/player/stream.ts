import type { Track } from "./track.js"

export type StreamInfo = {
  url: string
  mimeType?: string
  seekSeconds?: number
  userAgent?: string
}

export interface StreamResolver {
  resolve(track: Track): Promise<StreamInfo>
  refresh?(track: Track): Promise<Track>
}
