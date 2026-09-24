import { describe, expect, it, vi } from "vitest"
import {
  deriveSecretsFromBundle,
  isSignatureRejection,
  resolveAppCredentials,
  signTrackFileUrl,
} from "../../src/qobuz/stream.js"
import { QobuzError } from "../../src/qobuz/types.js"

describe("signTrackFileUrl", () => {
  it("produces deterministic MD5 signature", () => {
    const sig = signTrackFileUrl(5, 54091881, "1700000000", "0123456789abcdef0123456789abcdef")
    expect(sig).toMatch(/^[0-9a-f]{32}$/)
    expect(signTrackFileUrl(5, 54091881, "1700000000", "0123456789abcdef0123456789abcdef")).toBe(sig)
  })
})

describe("deriveSecretsFromBundle", () => {
  it("returns empty array when bundle has no seeds", () => {
    expect(deriveSecretsFromBundle("no seeds here")).toEqual([])
  })
})

describe("isSignatureRejection", () => {
  it("detects Qobuz request_sig errors", () => {
    const body = '{"status":"error","code":400,"message":"Invalid Request Signature parameter (request_sig)"}'
    expect(isSignatureRejection(400, body)).toBe(true)
    expect(isSignatureRejection(400, '{"message":"Invalid track_id"}')).toBe(false)
    expect(isSignatureRejection(401, body)).toBe(false)
  })
})

const signatureError = () => new QobuzError("bad sig", { status: 400, kind: "signature" })
const SECRET = "0123456789abcdef0123456789abcdef"

function bundleWithSecret(secret: string): string {
  const encoded = Buffer.from(secret).toString("base64") + "x".repeat(44)
  const [seed, info, extras] = [encoded.slice(0, 10), encoded.slice(10, 20), encoded.slice(20)]
  return [
    `a.initialSeed("${seed}",window.utimezone.berlin)`,
    `a.initialSeed("AAAA",window.utimezone.london)`,
    `name:"Europe/Berlin",info:"${info}",extras:"${extras}"`,
  ].join(";")
}

describe("resolveAppCredentials", () => {
  const getBundleInfo = vi.fn().mockResolvedValue({ appId: "798273057", bundlePath: "/b.js" })

  it("uses a configured secret that passes the probe", async () => {
    const probe = vi.fn().mockResolvedValue({})

    const result = await resolveAppCredentials(
      { token: "t", appId: "111111111", appSecret: SECRET },
      { getBundleInfo, probe }
    )

    expect(result).toEqual({ appId: "111111111", appSecret: SECRET, secretSource: "configured" })
  })

  it("falls back to derived secrets when the configured one is rejected", async () => {
    const probe = vi.fn().mockRejectedValueOnce(signatureError()).mockResolvedValueOnce({})
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const result = await resolveAppCredentials(
      { token: "t", appId: "111111111", appSecret: "f".repeat(32) },
      { getBundleInfo, probe, fetchBundle: async () => bundleWithSecret(SECRET) }
    )

    expect(result).toEqual({ appId: "798273057", appSecret: SECRET, secretSource: "derived" })
  })

  it("stops on an auth error instead of blaming the secret", async () => {
    const probe = vi.fn().mockRejectedValue(new QobuzError("401", { status: 401, kind: "auth" }))

    await expect(
      resolveAppCredentials({ token: "t" }, { getBundleInfo, probe, fetchBundle: async () => bundleWithSecret(SECRET) })
    ).rejects.toMatchObject({ kind: "auth" })
  })

  it("reports a signature error when every derived secret is rejected", async () => {
    const probe = vi.fn().mockRejectedValue(signatureError())

    await expect(
      resolveAppCredentials({ token: "t" }, { getBundleInfo, probe, fetchBundle: async () => bundleWithSecret(SECRET) })
    ).rejects.toMatchObject({ kind: "signature" })
  })

  it("reports a signature error when nothing can be derived", async () => {
    await expect(
      resolveAppCredentials({ token: "t" }, { getBundleInfo, probe: vi.fn(), fetchBundle: async () => "" })
    ).rejects.toMatchObject({ kind: "signature" })
  })
})
