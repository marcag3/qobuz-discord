import type { Track } from "../player/track.js"
import { APP_CODE, MAX_OHDIO_TRACKS } from "./constants.js"
import type { PlaybackCue, UniqueMediaFile } from "./types.js"
import { ohdioPageUrl, stripHtml } from "./types.js"

export function uniqueMediaIds(items: PlaybackCue[]): UniqueMediaFile[] {
  const out: UniqueMediaFile[] = []
  for (const item of items) {
    const mediaId = item.mediaPlaybackItem?.mediaId
    if (!mediaId) continue
    const last = out.at(-1)
    if (last?.mediaId === mediaId) {
      last.cues.push(item)
      continue
    }
    out.push({
      mediaId,
      appCode: item.appCode || APP_CODE.catchup,
      cues: [item],
    })
  }
  return out.slice(0, MAX_OHDIO_TRACKS)
}

export function filesToTracks(
  files: UniqueMediaFile[],
  meta: {
    title: string
    show?: string
    url?: string
    coverUrl?: string
  }
): Track[] {
  return files.map((file, index) => {
    const first = file.cues[0]
    const seek = Number(first?.mediaPlaybackItem?.mediaSeekTime ?? 0)
    const title = stripHtml(meta.title) || meta.title
    const partTitle =
      files.length > 1
        ? `${title} (${index + 1}/${files.length})`
        : (stripHtml(first?.title) ?? title)
    return {
      id: file.mediaId,
      source: "ohdio",
      title: partTitle,
      artistName: stripHtml(meta.show || first?.productTitle || first?.subtitle) || "Ohdio",
      albumTitle: title,
      url: ohdioPageUrl(meta.url),
      albumCoverUrl: first?.picture?.url ?? meta.coverUrl,
      appCode: file.appCode || APP_CODE.catchup,
      seekSeconds: seek > 0 ? seek : undefined,
    }
  })
}
