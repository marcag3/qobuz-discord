import type { AppConfig } from "../config.js"
import { createAuthSession } from "./auth.js"
import { expandToTracks, popularItemFromUrl } from "./expand.js"
import { searchMostPopular } from "./search.js"
import { DEFAULT_STREAM_FORMAT_ID } from "./constants.js"
import { fetchStreamUrl, resolveAppCredentials } from "./stream.js"
import { parseQobuzUrl } from "./url.js"
import type { PopularItem, QobuzClient, SearchResult, StreamInfo, Track } from "./types.js"

export class QobuzService implements QobuzClient {
  private readonly config: AppConfig
  private appId = ""
  private appSecret = ""
  private token = ""
  private transportReady: ReturnType<typeof createAuthSession> | null = null

  constructor(config: AppConfig) {
    this.config = config
    this.token = config.qobuzUserToken
  }

  async init(): Promise<void> {
    const session = await createAuthSession(this.config)
    this.appId = session.appId
    this.token = session.token
    this.transportReady = Promise.resolve(session)

    const creds = await resolveAppCredentials(this.config)
    this.appSecret = creds.appSecret
    if (!this.appId) this.appId = creds.appId
  }

  private async session() {
    if (!this.transportReady) await this.init()
    return this.transportReady!
  }

  async search(query: string, limit = 25): Promise<SearchResult> {
    const { transport } = await this.session()
    return searchMostPopular(transport, query, limit)
  }

  async expandToTracks(item: PopularItem): Promise<Track[]> {
    const { transport } = await this.session()
    return expandToTracks(transport, item)
  }

  async expandFromUrl(url: string): Promise<Track[]> {
    const parsed = parseQobuzUrl(url)
    if (!parsed) throw new Error("Invalid Qobuz URL")
    return this.expandToTracks(popularItemFromUrl(parsed))
  }

  async getStreamUrl(trackId: number, formatId = DEFAULT_STREAM_FORMAT_ID): Promise<StreamInfo> {
    return fetchStreamUrl({
      appId: this.appId,
      appSecret: this.appSecret,
      token: this.token,
      trackId,
      formatId,
    })
  }
}

export function createQobuzClient(config: AppConfig): QobuzService {
  return new QobuzService(config)
}
