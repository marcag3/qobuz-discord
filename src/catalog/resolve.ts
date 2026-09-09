import type { OhdioClient } from "../ohdio/client.js"
import { isOhdioInput } from "../ohdio/url.js"
import type { Track } from "../player/track.js"
import type { StreamResolver } from "../player/stream.js"
import type { QobuzService } from "../qobuz/client.js"
import { isQobuzUrl } from "../qobuz/url.js"

export function createStreamResolver(qobuz: QobuzService, ohdio: OhdioClient): StreamResolver {
  return {
    async resolve(track: Track) {
      if (track.source === "ohdio") return ohdio.getStreamUrl(track)
      const info = await qobuz.getStreamUrl(Number(track.id))
      return { url: info.url, mimeType: info.mimeType }
    },
    async refresh(track: Track) {
      if (track.source === "ohdio") return ohdio.refreshTrack(track)
      return track
    },
  }
}

export async function resolvePlayQuery(
  qobuz: QobuzService,
  ohdio: OhdioClient,
  query: string
): Promise<Track[]> {
  if (isOhdioInput(query)) return ohdio.expandFromQuery(query)
  if (isQobuzUrl(query)) return qobuz.expandFromUrl(query)

  const result = await qobuz.search(query)
  const top = result.mostPopular[0]
  if (!top) return []
  return qobuz.expandToTracks(top)
}
