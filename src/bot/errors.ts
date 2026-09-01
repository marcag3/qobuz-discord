import { QobuzError } from "../qobuz/types.js"
import { QueueFullError } from "../player/limits.js"

const GENERIC_ERROR = "Something went wrong. Try again later."

export function userFacingError(err: unknown): string {
  if (QobuzError.isAuthError(err)) {
    return "Qobuz session expired — refresh `QOBUZ_USER_TOKEN` in `.env` and restart the bot."
  }

  if (err instanceof QueueFullError) {
    return err.message
  }

  if (err instanceof Error && err.message === "Invalid Qobuz URL") {
    return err.message
  }

  console.error("Request failed:", err)
  return GENERIC_ERROR
}
