import type { Transport } from "@kud/qobuz"
import { toQobuzError } from "./auth.js"
import type { PopularItem, PopularItemType, SearchResult } from "./types.js"

type RawPopularItem = {
  type?: PopularItemType
  content?: {
    id?: string | number
    title?: string
    name?: string
    performer?: { name?: string }
    artist?: { name?: string }
  }
}

export function unwrapPopularItem(item: RawPopularItem | null | undefined): PopularItem | null {
  if (!item) return null

  const content = item.content ?? item
  const type = (item.type ?? (content as { type?: PopularItemType }).type) as PopularItemType | undefined
  const id = (content as { id?: string | number }).id
  const title =
    (content as { title?: string }).title ?? (content as { name?: string }).name

  if (!type || id === undefined || !title) return null

  const artistName =
    (content as { performer?: { name?: string } }).performer?.name ??
    (content as { artist?: { name?: string } }).artist?.name

  return { type, id, title, artistName }
}

export function parseMostPopular(rawItems: RawPopularItem[] | undefined): PopularItem[] {
  if (!rawItems?.length) return []

  return rawItems
    .map((item) => unwrapPopularItem(item))
    .filter((item): item is PopularItem => item !== null)
}

export async function searchMostPopular(
  transport: Transport,
  query: string,
  limit = 25
): Promise<SearchResult> {
  try {
    const raw = (await transport.get("catalog/search", { query, limit })) as {
      most_popular?: { items?: RawPopularItem[] }
    }
    const items = parseMostPopular(raw.most_popular?.items as RawPopularItem[] | undefined)
    return { mostPopular: items }
  } catch (err) {
    throw toQobuzError(err, `Search failed for "${query}"`)
  }
}
