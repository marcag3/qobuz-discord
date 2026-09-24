import type { Transport } from "@kud/qobuz"
import { createAuthSession } from "./auth.js"
import { fetchBundleInfo, resolveAppCredentials, type BundleInfo } from "./stream.js"
import { QobuzError, type QobuzCredentialInput } from "./types.js"

export type QobuzConnection = {
  token: string
  appId: string
  appSecret: string
  secretSource: "configured" | "derived"
  transport: Transport
}

export async function connectQobuz(input: QobuzCredentialInput): Promise<QobuzConnection> {
  const token = input.userToken
  if (!token) {
    throw new QobuzError("Qobuz is not configured", { kind: "not_configured" })
  }

  let bundleInfo: Promise<BundleInfo> | undefined
  const getBundleInfo = () => (bundleInfo ??= fetchBundleInfo())

  const session = await createAuthSession(token, input.appId ?? (await getBundleInfo()).appId)
  const creds = await resolveAppCredentials(
    { token, appId: input.appId, appSecret: input.appSecret },
    { getBundleInfo }
  )

  return {
    token,
    appId: creds.appId,
    appSecret: creds.appSecret,
    secretSource: creds.secretSource,
    transport: session.transport,
  }
}
