import { QobuzError } from "../qobuz/types.js"

export function userFacingError(err: unknown): string {
  if (QobuzError.isAuthError(err)) {
    return "Qobuz session expired — refresh `QOBUZ_USER_TOKEN` in `.env` and restart the bot."
  }

  if (err instanceof Error) return err.message
  return "Something went wrong."
}
