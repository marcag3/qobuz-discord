import {
  connect,
  createMemoryStore,
  createTransport,
  fetchAppId,
  validateCredentials,
  type Transport,
} from "@kud/qobuz"
import type { AppConfig } from "../config.js"
import { QobuzError } from "./types.js"

export type AuthSession = {
  appId: string
  token: string
  transport: Transport
}

export async function createAuthSession(config: AppConfig): Promise<AuthSession> {
  const token = config.qobuzUserToken
  const store = createMemoryStore()

  try {
    await connect({ token, store })
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

export async function validateToken(config: AppConfig): Promise<string> {
  const { appId } = await fetchAppId()
  try {
    await validateCredentials({ appId, token: config.qobuzUserToken })
  } catch (err) {
    throw toQobuzError(err, "Invalid Qobuz token — refresh QOBUZ_USER_TOKEN in .env")
  }
  return appId
}

export function toQobuzError(err: unknown, fallback: string): QobuzError {
  if (err instanceof QobuzError) return err

  const status = getStatus(err)
  const message = err instanceof Error ? err.message : fallback
  const kind =
    status === 401 || (err as { kind?: string })?.kind === "auth" ? "auth" : "unknown"

  return new QobuzError(message || fallback, { status, kind })
}

function getStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status?: unknown }).status
    return typeof status === "number" ? status : undefined
  }
  return undefined
}
