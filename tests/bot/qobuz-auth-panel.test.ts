import { describe, expect, it } from "vitest"
import {
  buildAuthPanelRows,
  buildCredentialsModal,
  formatAuthPanel,
  formatUpdateOutcome,
  parseCredentialForm,
} from "../../src/bot/qobuz-auth-panel.js"

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_"

describe("parseCredentialForm", () => {
  it("accepts a token and strips a pasted header name", () => {
    expect(parseCredentialForm({ token: ` X-User-Auth-Token: ${TOKEN} `, appId: "", appSecret: "" })).toEqual({
      ok: true,
      input: { userToken: TOKEN },
    })
  })

  it("rejects an empty form", () => {
    expect(parseCredentialForm({ token: "", appId: " ", appSecret: "" }).ok).toBe(false)
  })

  it("rejects malformed values without echoing them", () => {
    const result = parseCredentialForm({ token: '"quoted token"', appId: "", appSecret: "" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toContain("quoted")

    expect(parseCredentialForm({ token: "", appId: "abc", appSecret: "" }).ok).toBe(false)
    expect(parseCredentialForm({ token: "", appId: "", appSecret: "123" }).ok).toBe(false)
  })

  it("accepts an app ID and secret pair", () => {
    expect(
      parseCredentialForm({ token: "", appId: "798273057", appSecret: "0123456789ABCDEF0123456789abcdef" })
    ).toEqual({
      ok: true,
      input: { appId: "798273057", appSecret: "0123456789ABCDEF0123456789abcdef" },
    })
  })
})

describe("formatAuthPanel", () => {
  it("shows only the token hint, never the token", () => {
    const text = formatAuthPanel({
      status: { state: "ready", appId: "798273057", secretSource: "derived" },
      source: "saved",
      tokenHint: "…abcd",
      savedAt: "2026-09-24T12:00:00.000Z",
    })

    expect(text).toContain("Connected")
    expect(text).toContain("`…abcd`")
    expect(text).toContain("<t:")
  })

  it("explains how to get a token when it was rejected", () => {
    const text = formatAuthPanel({
      status: { state: "token_invalid", detail: "401" },
      source: "env",
      tokenHint: "…abcd",
    })

    expect(text).toContain("X-User-Auth-Token")
  })

  it("suggests re-deriving when the secret is rejected", () => {
    const text = formatAuthPanel({
      status: { state: "secret_invalid", detail: "no secret worked" },
      source: "env",
      tokenHint: "…abcd",
    })

    expect(text).toContain("Re-derive secret")
  })
})

describe("buildAuthPanelRows", () => {
  it("only offers clearing when credentials were saved via the bot", () => {
    const ids = (source: "saved" | "env") =>
      buildAuthPanelRows({ status: { state: "not_configured" }, source, tokenHint: "…abcd" })[0]
        .toJSON()
        .components.map((c) => ("custom_id" in c ? c.custom_id : undefined))

    expect(ids("saved")).toContain("qobuz-auth:clear")
    expect(ids("env")).not.toContain("qobuz-auth:clear")
  })
})

describe("buildCredentialsModal", () => {
  it("builds a valid modal without prefilling secrets", () => {
    const json = buildCredentialsModal({
      status: { state: "token_invalid", detail: "401" },
      source: "env",
      tokenHint: "…abcd",
    }).toJSON()

    expect(json.custom_id).toBe("qobuz-auth:modal")
    expect(json.components).toHaveLength(3)
    expect(JSON.stringify(json)).not.toContain('"value"')
  })
})

describe("formatUpdateOutcome", () => {
  it("says nothing changed when validation fails", () => {
    expect(
      formatUpdateOutcome({ applied: false, persisted: false, status: { state: "token_invalid", detail: "401" } })
    ).toBe("Nothing was changed: Qobuz rejected the token.")
  })
})
