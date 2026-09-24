import { describe, expect, it, vi } from "vitest"
import type { AppConfig } from "../../src/config.js"
import { createQobuzClient } from "../../src/qobuz/client.js"
import type { QobuzConnection } from "../../src/qobuz/connect.js"
import type {
  QobuzCredentialStore,
  SavedQobuzCredentials,
} from "../../src/qobuz/credential-store.js"
import { QobuzError, type QobuzCredentialInput } from "../../src/qobuz/types.js"

const baseConfig: AppConfig = {
  discordToken: "discord",
  discordClientId: "123",
  qobuzCredentialsPath: "unused",
  ownerIds: [],
  ohdioRegionId: 8,
}

function memoryStore(initial: SavedQobuzCredentials | null = null): QobuzCredentialStore & {
  data: SavedQobuzCredentials | null
} {
  const store = {
    path: "memory",
    data: initial,
    async load() {
      return store.data
    },
    async save(creds: QobuzCredentialInput) {
      store.data = { ...creds, updatedAt: "2026-09-24T12:00:00.000Z" }
      return store.data
    },
    async clear() {
      store.data = null
    },
  }
  return store
}

function connection(overrides: Partial<QobuzConnection> = {}): QobuzConnection {
  return {
    token: "good-token-000000",
    appId: "798273057",
    appSecret: "0123456789abcdef0123456789abcdef",
    secretSource: "derived",
    transport: { get: vi.fn().mockResolvedValue({ most_popular: { items: [] } }) },
    ...overrides,
  }
}

describe("QobuzService.init", () => {
  it("reports token_invalid instead of throwing when auth fails", async () => {
    const connect = vi.fn().mockRejectedValue(new QobuzError("401", { status: 401, kind: "auth" }))
    const client = createQobuzClient({ ...baseConfig, qobuzUserToken: "bad-token" }, { connect })

    expect(await client.init()).toBe(false)
    expect(client.status.state).toBe("token_invalid")
  })

  it("reports secret_invalid when no secret signs requests", async () => {
    const connect = vi
      .fn()
      .mockRejectedValue(new QobuzError("no secret worked", { status: 400, kind: "signature" }))
    const client = createQobuzClient({ ...baseConfig, qobuzUserToken: "token" }, { connect })

    await client.init()

    expect(client.status.state).toBe("secret_invalid")
    await expect(client.search("x")).rejects.toMatchObject({ kind: "signature" })
    client.dispose()
  })

  it("is not_configured without a token", async () => {
    const client = createQobuzClient(baseConfig)

    expect(await client.init()).toBe(false)
    expect(client.status.state).toBe("not_configured")
    await expect(client.search("x")).rejects.toMatchObject({ kind: "not_configured" })
  })

  it("prefers saved credentials over .env", async () => {
    const connect = vi.fn().mockResolvedValue(connection())
    const store = memoryStore({ userToken: "saved-token-1234", updatedAt: "2026-09-01T00:00:00Z" })
    const client = createQobuzClient(
      { ...baseConfig, qobuzUserToken: "env-token-9999" },
      { connect, store }
    )
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    expect(await client.init()).toBe(true)
    expect(connect).toHaveBeenCalledWith({ userToken: "saved-token-1234" })
    expect(client.snapshot()).toMatchObject({ source: "saved", tokenHint: "…1234" })
  })
})

describe("QobuzService.updateCredentials", () => {
  it("applies and persists credentials that connect", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new QobuzError("expired", { status: 401, kind: "auth" }))
      .mockResolvedValueOnce(connection({ token: "fresh-token-abcd" }))
    const store = memoryStore()
    const client = createQobuzClient(
      { ...baseConfig, qobuzUserToken: "old-token", qobuzAppId: "111111111" },
      { connect, store }
    )
    await client.init()

    const result = await client.updateCredentials({ userToken: "fresh-token-abcd" })

    expect(result).toMatchObject({ applied: true, persisted: true, status: { state: "ready" } })
    expect(connect).toHaveBeenLastCalledWith({ userToken: "fresh-token-abcd", appId: "111111111" })
    expect(store.data).toMatchObject({ userToken: "fresh-token-abcd", appId: "111111111" })
    expect(client.isReady).toBe(true)
  })

  it("keeps the current state when the candidate fails", async () => {
    const connect = vi
      .fn()
      .mockResolvedValueOnce(connection())
      .mockRejectedValueOnce(new QobuzError("expired", { status: 401, kind: "auth" }))
    const store = memoryStore()
    const client = createQobuzClient({ ...baseConfig, qobuzUserToken: "good-token" }, { connect, store })
    await client.init()

    const result = await client.updateCredentials({ userToken: "typo-token" })

    expect(result).toMatchObject({ applied: false, status: { state: "token_invalid" } })
    expect(client.isReady).toBe(true)
    expect(store.data).toBeNull()
  })

  it("rederiveSecret pins the resolved pair", async () => {
    const connect = vi.fn().mockResolvedValue(connection({ token: "good-token" }))
    const store = memoryStore()
    const client = createQobuzClient(
      { ...baseConfig, qobuzUserToken: "good-token", qobuzAppSecret: "f".repeat(32) },
      { connect, store }
    )
    await client.init()

    const result = await client.rederiveSecret()

    expect(result.applied).toBe(true)
    expect(connect).toHaveBeenLastCalledWith({ userToken: "good-token" })
    expect(store.data).toMatchObject({
      userToken: "good-token",
      appId: "798273057",
      appSecret: "0123456789abcdef0123456789abcdef",
    })
  })

  it("clearSavedCredentials falls back to .env", async () => {
    const connect = vi.fn().mockResolvedValue(connection())
    const store = memoryStore({ userToken: "saved-token-1234", updatedAt: "" })
    const client = createQobuzClient({ ...baseConfig, qobuzUserToken: "env-token-9999" }, { connect, store })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await client.init()

    await client.clearSavedCredentials()

    expect(store.data).toBeNull()
    expect(connect).toHaveBeenLastCalledWith({ userToken: "env-token-9999" })
    expect(client.snapshot()).toMatchObject({ source: "env", tokenHint: "…9999" })
  })
})

describe("QobuzService runtime failures", () => {
  it("flips to token_invalid and notifies listeners when a request returns 401", async () => {
    const get = vi.fn().mockRejectedValue(Object.assign(new Error("401"), { status: 401 }))
    const connect = vi.fn().mockResolvedValue(connection({ transport: { get } }))
    const client = createQobuzClient({ ...baseConfig, qobuzUserToken: "token" }, { connect })
    await client.init()
    const listener = vi.fn()
    client.onStatusChange(listener)
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    await expect(client.search("x")).rejects.toMatchObject({ kind: "auth" })

    expect(client.status.state).toBe("token_invalid")
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ state: "token_invalid" }),
      expect.objectContaining({ state: "ready" })
    )
    await expect(client.search("x")).rejects.toMatchObject({ kind: "auth" })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("retries automatically after a network failure", async () => {
    vi.useFakeTimers()
    try {
      const connect = vi
        .fn()
        .mockRejectedValueOnce(new QobuzError("fetch failed", { kind: "network" }))
        .mockResolvedValueOnce(connection())
      const client = createQobuzClient({ ...baseConfig, qobuzUserToken: "token" }, { connect })
      vi.spyOn(console, "error").mockImplementation(() => undefined)

      await client.init()
      expect(client.status.state).toBe("unreachable")

      await vi.advanceTimersByTimeAsync(60_000)

      expect(client.status.state).toBe("ready")
      client.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
