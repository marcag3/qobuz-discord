import type { QobuzService } from "../../qobuz/client.js"

export async function resolveQueryToTracks(qobuz: QobuzService, query: string) {
  const result = await qobuz.search(query)
  const top = result.mostPopular[0]
  if (!top) return []
  return qobuz.expandToTracks(top)
}
