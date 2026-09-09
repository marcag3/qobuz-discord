import { describe, expect, it } from "vitest"
import { QobuzError } from "../../src/qobuz/types.js"
import { OhdioError } from "../../src/ohdio/errors.js"
import { QueueFullError } from "../../src/player/limits.js"
import { userFacingError } from "../../src/bot/errors.js"

describe("userFacingError", () => {
  it("maps auth errors to refresh message", () => {
    const err = new QobuzError("expired", { status: 401, kind: "auth" })
    expect(userFacingError(err)).toContain("QOBUZ_USER_TOKEN")
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
