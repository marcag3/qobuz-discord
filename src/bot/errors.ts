import { QobuzError } from "../qobuz/types.js"
import { OhdioError } from "../ohdio/errors.js"
import { QueueFullError } from "../player/limits.js"

const GENERIC_ERROR = "Something went wrong. Try again later."

export function qobuzUserMessage(err: unknown): string | undefined {
  if (QobuzError.isNotConfigured(err)) {
    return "Qobuz isn't connected on this bot yet. The bot owner can set it up with `/qobuz-auth`. Ohdio still works."
  }

  if (QobuzError.isAuthError(err)) {
    return "Qobuz login expired. The bot owner can reconnect it with `/qobuz-auth`. Ohdio still works."
  }

  if (QobuzError.isSignatureError(err)) {
    return "Qobuz rejected the bot's app credentials. The bot owner can fix it with `/qobuz-auth`. Ohdio still works."
  }

  if (QobuzError.isNetworkError(err)) {
    return "Couldn't reach Qobuz. Try again in a moment."
  }

  if (QobuzError.isUnavailable(err)) {
    return "Qobuz is unavailable right now. The bot retries automatically; the bot owner can check `/qobuz-auth`."
  }

  return undefined
}

export function userFacingError(err: unknown): string {
  const qobuzMessage = qobuzUserMessage(err)
  if (qobuzMessage) return qobuzMessage

  if (err instanceof QueueFullError) {
    return err.message
  }

  if (err instanceof OhdioError) {
    return err.message
  }

  if (err instanceof Error && err.message === "Invalid Qobuz URL") {
    return err.message
  }

  console.error("Request failed:", err)
  return GENERIC_ERROR
}
