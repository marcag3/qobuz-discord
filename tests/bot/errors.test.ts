import { describe, expect, it } from "vitest"
import { QobuzError } from "../../src/qobuz/types.js"
import { OhdioError } from "../../src/ohdio/errors.js"
import { QueueFullError } from "../../src/player/limits.js"
import { userFacingError } from "../../src/bot/errors.js"

describe("userFacingError", () => {
  it("maps auth errors to a login-expired message pointing at /qobuz-auth", () => {
    const err = new QobuzError("expired", { status: 401, kind: "auth" })
    expect(userFacingError(err)).toContain("Qobuz login expired")
    expect(userFacingError(err)).toContain("/qobuz-auth")
  })

  it("maps signature errors separately from auth errors", () => {
    const err = new QobuzError("no secret worked", { status: 400, kind: "signature" })
    expect(userFacingError(err)).toContain("rejected the bot's app credentials")
  })

  it("maps not-configured Qobuz", () => {
    const err = new QobuzError("Qobuz is not configured", { kind: "not_configured" })
    expect(userFacingError(err)).toContain("isn't connected")
  })

  it("maps network errors to a retry message", () => {
    const err = new QobuzError("fetch failed", { kind: "network" })
    expect(userFacingError(err)).toBe("Couldn't reach Qobuz. Try again in a moment.")
  })

  it("maps unavailable Qobuz errors", () => {
    const err = new QobuzError("bundle changed", { kind: "unavailable" })
    expect(userFacingError(err)).toContain("Qobuz is unavailable")
  })

  it("never echoes Qobuz error details to users", () => {
    const err = new QobuzError("getFileUrl failed: secret body", { kind: "signature" })
    expect(userFacingError(err)).not.toContain("secret body")
  })

  it("returns queue full message", () => {
    const err = new QueueFullError(100)
    expect(userFacingError(err)).toContain("Queue is full")
  })

  it("returns Ohdio errors to the user", () => {
    expect(userFacingError(OhdioError.notFound("No playable episode on that Ohdio show"))).toBe(
      "No playable episode on that Ohdio show"
    )
  })

  it("returns generic message for internal errors", () => {
    expect(userFacingError(new Error("getFileUrl failed (403): secret body"))).toBe(
      "Something went wrong. Try again later."
    )
  })
})
