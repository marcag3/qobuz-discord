import { connect, createMemoryStore, createTransport, type Transport } from "@kud/qobuz"
import { QobuzError } from "./types.js"

export type AuthSession = {
  appId: string
  token: string
  transport: Transport
}

export async function createAuthSession(token: string, appId?: string): Promise<AuthSession> {
  const store = createMemoryStore()

  try {
    await connect({ token, appId, store })
  } catch (err) {
    throw toQobuzError(err, "Failed to connect to Qobuz")
  }

  const creds = await store.load()
  if (!creds?.appId) {
    throw new QobuzError("Qobuz app_id missing after connect")
  }

  return {
    appId: creds.appId,
    token,
    transport: createTransport({ appId: creds.appId, token }),
  }
}

export function toQobuzError(err: unknown, fallback: string): QobuzError {
  if (err instanceof QobuzError) return err

  const status = getStatus(err)
  const message = err instanceof Error ? err.message : fallback
  const kind =
    status === 401 || (err as { kind?: string })?.kind === "auth"
      ? "auth"
      : isNetworkFailure(err)
        ? "network"
        : "unknown"

  return new QobuzError(message || fallback, { status, kind })
}

export function isNetworkFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === "AbortError" || err.name === "TimeoutError") return true
  return err instanceof TypeError && /fetch failed/i.test(err.message)
}

function getStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status?: unknown }).status
    return typeof status === "number" ? status : undefined
  }
  return undefined
}
