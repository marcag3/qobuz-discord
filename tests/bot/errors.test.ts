import { describe, expect, it } from "vitest"
import { QobuzError } from "../../src/qobuz/types.js"
import { userFacingError } from "../../src/bot/errors.js"

describe("userFacingError", () => {
  it("maps auth errors to refresh message", () => {
    const err = new QobuzError("expired", { status: 401, kind: "auth" })
    expect(userFacingError(err)).toContain("QOBUZ_USER_TOKEN")
  })

  it("returns message for generic errors", () => {
    expect(userFacingError(new Error("boom"))).toBe("boom")
  })
})
