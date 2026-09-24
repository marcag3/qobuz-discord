import type { AppConfig } from "../config.js"
import { toQobuzError } from "./auth.js"
import { connectQobuz, type QobuzConnection } from "./connect.js"
import type { QobuzCredentialStore } from "./credential-store.js"
import { expandToTracks, popularItemFromUrl, resolvePopularItemFromUrl } from "./expand.js"
import { searchMostPopular } from "./search.js"
import { DEFAULT_STREAM_FORMAT_ID } from "./constants.js"
import { fetchStreamUrl } from "./stream.js"
import { parseQobuzUrl } from "./url.js"
import {
  QobuzError,
  type PopularItem,
  type QobuzClient,
  type QobuzCredentialInput,
  type QobuzStatus,
  type SearchResult,
  type StreamInfo,
  type Track,
} from "./types.js"

export type CredentialSource = "saved" | "session" | "env" | "none"

export type QobuzAuthSnapshot = {
  status: QobuzStatus
  source: CredentialSource
  tokenHint?: string
  appId?: string
  savedAt?: string
}

export type CredentialUpdateResult = {
  status: QobuzStatus
  applied: boolean
  persisted: boolean
}

export type QobuzServiceOptions = {
  store?: QobuzCredentialStore
  connect?: (creds: QobuzCredentialInput) => Promise<QobuzConnection>
}

type StatusListener = (status: QobuzStatus, previous: QobuzStatus) => void

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]

export class QobuzService implements QobuzClient {
  private readonly envCredentials: QobuzCredentialInput
  private readonly store?: QobuzCredentialStore
  private readonly connectFn: (creds: QobuzCredentialInput) => Promise<QobuzConnection>
  private readonly listeners = new Set<StatusListener>()
  private credentials: QobuzCredentialInput = {}
  private source: CredentialSource = "none"
  private savedAt?: string
  private connection: QobuzConnection | null = null
  private currentStatus: QobuzStatus = { state: "not_configured" }
  private queue: Promise<unknown> = Promise.resolve()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0

  constructor(config: AppConfig, options: QobuzServiceOptions = {}) {
    this.envCredentials = {
      userToken: config.qobuzUserToken,
      appId: config.qobuzAppId,
      appSecret: config.qobuzAppSecret,
    }
    this.store = options.store
    this.connectFn = options.connect ?? connectQobuz
  }

  get isReady(): boolean {
    return this.currentStatus.state === "ready" && this.connection !== null
  }

  get status(): QobuzStatus {
    return this.currentStatus
  }

  get canClearSaved(): boolean {
    return this.source === "saved" || this.source === "session"
  }

  snapshot(): QobuzAuthSnapshot {
    const token = this.credentials.userToken
    return {
      status: this.currentStatus,
      source: this.source,
      tokenHint: token ? `…${token.slice(-4)}` : undefined,
      appId: this.connection?.appId ?? this.credentials.appId,
      savedAt: this.source === "saved" ? this.savedAt : undefined,
    }
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  init(): Promise<boolean> {
    return this.serialize(async () => {
      await this.loadCredentials()
      await this.reconnect()
      return this.isReady
    })
  }

  updateCredentials(input: QobuzCredentialInput): Promise<CredentialUpdateResult> {
    return this.serialize(() => this.applyCandidate({ ...this.credentials, ...definedOnly(input) }))
  }

  rederiveSecret(): Promise<CredentialUpdateResult> {
    return this.serialize(async () => {
      if (!this.credentials.userToken) {
        return { status: { state: "not_configured" }, applied: false, persisted: false }
      }
      return this.applyCandidate({ userToken: this.credentials.userToken }, true)
    })
  }

  clearSavedCredentials(): Promise<QobuzStatus> {
    return this.serialize(async () => {
      await this.store?.clear()
      this.savedAt = undefined
      this.useEnvCredentials()
      await this.reconnect()
      return this.currentStatus
    })
  }

  dispose(): void {
    this.clearRetry()
    this.listeners.clear()
  }

  async search(query: string, limit = 25): Promise<SearchResult> {
    return this.guarded(({ transport }) => searchMostPopular(transport, query, limit))
  }

  async expandToTracks(item: PopularItem): Promise<Track[]> {
    return this.guarded(({ transport }) => expandToTracks(transport, item))
  }

  async resolveUrlItem(url: string): Promise<PopularItem | null> {
    return this.guarded(({ transport }) => resolvePopularItemFromUrl(transport, url))
  }

  async expandFromUrl(url: string): Promise<Track[]> {
    const parsed = parseQobuzUrl(url)
    if (!parsed) throw new Error("Invalid Qobuz URL")
    return this.expandToTracks(popularItemFromUrl(parsed))
  }

  async getStreamUrl(trackId: number, formatId = DEFAULT_STREAM_FORMAT_ID): Promise<StreamInfo> {
    return this.guarded((conn) =>
      fetchStreamUrl({
        appId: conn.appId,
        appSecret: conn.appSecret,
        token: conn.token,
        trackId,
        formatId,
      })
    )
  }

  private async guarded<T>(fn: (conn: QobuzConnection) => Promise<T>): Promise<T> {
    const conn = this.connection
    if (!conn || this.currentStatus.state !== "ready") {
      throw errorFromStatus(this.currentStatus)
    }

    try {
      return await fn(conn)
    } catch (err) {
      const error = toQobuzError(err, "Qobuz request failed")
      if (!QobuzError.isAuthError(error) && !QobuzError.isSignatureError(error)) throw err
      if (conn === this.connection) {
        console.error("Qobuz credentials stopped working:", error.message)
        this.connection = null
        this.setStatus(statusFromError(error))
      }
      throw error
    }
  }

  private async loadCredentials(): Promise<void> {
    let saved = null
    try {
      saved = (await this.store?.load()) ?? null
    } catch (err) {
      console.error("Could not read saved Qobuz credentials:", (err as Error).message)
    }

    if (saved?.userToken) {
      this.credentials = { userToken: saved.userToken, appId: saved.appId, appSecret: saved.appSecret }
      this.source = "saved"
      this.savedAt = saved.updatedAt
      if (this.envCredentials.userToken && this.envCredentials.userToken !== saved.userToken) {
        console.warn(
          "QOBUZ_USER_TOKEN in .env is ignored: credentials saved via /qobuz-auth take precedence. " +
            "Use “Clear saved credentials” in /qobuz-auth to go back to .env."
        )
      }
      return
    }

    this.useEnvCredentials()
  }

  private useEnvCredentials(): void {
    this.credentials = { ...this.envCredentials }
    this.source = this.envCredentials.userToken ? "env" : "none"
  }

  private async reconnect(): Promise<void> {
    const { connection, status } = await this.tryConnect(this.credentials)
    this.connection = connection
    this.setStatus(status)
    logStatus(status)
  }

  private async applyCandidate(
    candidate: QobuzCredentialInput,
    pinResolvedSecret = false
  ): Promise<CredentialUpdateResult> {
    const { connection, status } = await this.tryConnect(candidate)
    if (!connection) return { status, applied: false, persisted: false }

    const toSave = pinResolvedSecret
      ? { userToken: connection.token, appId: connection.appId, appSecret: connection.appSecret }
      : candidate

    let persisted = false
    if (this.store) {
      try {
        const saved = await this.store.save(toSave)
        this.savedAt = saved.updatedAt
        persisted = true
      } catch (err) {
        console.error("Could not save Qobuz credentials:", (err as Error).message)
      }
    }

    this.credentials = toSave
    this.source = persisted ? "saved" : "session"
    this.connection = connection
    this.setStatus(status)
    console.log("Qobuz credentials updated via /qobuz-auth")
    return { status, applied: true, persisted }
  }

  private async tryConnect(
    creds: QobuzCredentialInput
  ): Promise<{ connection: QobuzConnection | null; status: QobuzStatus }> {
    try {
      const connection = await this.connectFn(creds)
      return {
        connection,
        status: { state: "ready", appId: connection.appId, secretSource: connection.secretSource },
      }
    } catch (err) {
      return { connection: null, status: statusFromError(err) }
    }
  }

  private setStatus(status: QobuzStatus): void {
    const previous = this.currentStatus
    this.currentStatus = status

    if (status.state === "unreachable" || status.state === "error") {
      this.scheduleRetry()
    } else {
      this.clearRetry()
      if (status.state === "ready") this.retryAttempt = 0
    }

    if (previous.state === status.state) return
    for (const listener of this.listeners) {
      try {
        listener(status, previous)
      } catch (err) {
        console.error("Qobuz status listener failed:", err)
      }
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return
    const delay = RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)]
    this.retryAttempt++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.serialize(async () => {
        if (this.currentStatus.state === "unreachable" || this.currentStatus.state === "error") {
          await this.reconnect()
        }
      })
    }, delay)
    this.retryTimer.unref?.()
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }
}

export function statusFromError(err: unknown): QobuzStatus {
  const error = toQobuzError(err, "Qobuz initialization failed")
  switch (error.kind) {
    case "not_configured":
      return { state: "not_configured" }
    case "auth":
      return { state: "token_invalid", detail: error.message }
    case "signature":
      return { state: "secret_invalid", detail: error.message }
    case "network":
      return { state: "unreachable", detail: error.message }
    default:
      return { state: "error", detail: error.message }
  }
}

export function errorFromStatus(status: QobuzStatus): QobuzError {
  switch (status.state) {
    case "not_configured":
      return new QobuzError("Qobuz is not configured", { kind: "not_configured" })
    case "token_invalid":
      return new QobuzError(status.detail, { kind: "auth" })
    case "secret_invalid":
      return new QobuzError(status.detail, { kind: "signature" })
    case "unreachable":
      return new QobuzError(status.detail, { kind: "network" })
    case "error":
      return new QobuzError(status.detail, { kind: "unavailable" })
    case "ready":
      return new QobuzError("Qobuz is reconnecting", { kind: "unavailable" })
  }
}

function logStatus(status: QobuzStatus): void {
  switch (status.state) {
    case "ready":
      console.log(`Qobuz ready (app ${status.appId}, ${status.secretSource} secret)`)
      break
    case "not_configured":
      console.warn("Qobuz disabled: no user token (set QOBUZ_USER_TOKEN or use /qobuz-auth)")
      break
    default:
      console.error(`Qobuz unavailable (${status.state}):`, status.detail)
  }
}

function definedOnly(input: QobuzCredentialInput): QobuzCredentialInput {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value === "string" && value.length > 0)
  )
}

export function createQobuzClient(
  config: AppConfig,
  options: QobuzServiceOptions = {}
): QobuzService {
  return new QobuzService(config, options)
}
