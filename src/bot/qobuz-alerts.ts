import type { Client } from "discord.js"
import type { QobuzService } from "../qobuz/client.js"
import { QobuzError, type QobuzStatus } from "../qobuz/types.js"
import { qobuzAuthPanelMessage } from "./commands/qobuz-auth.js"
import { qobuzUserMessage } from "./errors.js"
import type { OwnerResolver } from "./owner.js"

const ALERT_STATES: ReadonlySet<QobuzStatus["state"]> = new Set([
  "token_invalid",
  "secret_invalid",
  "error",
])
const REPEAT_ALERT_MS = 6 * 60 * 60_000

export function startQobuzOwnerAlerts(
  client: Client,
  qobuz: QobuzService,
  owners: OwnerResolver
): () => void {
  let lastAlert: { state: QobuzStatus["state"]; at: number } | null = null

  const alert = async (status: QobuzStatus) => {
    if (!ALERT_STATES.has(status.state)) {
      if (status.state === "ready") lastAlert = null
      return
    }

    const now = Date.now()
    if (lastAlert?.state === status.state && now - lastAlert.at < REPEAT_ALERT_MS) return
    lastAlert = { state: status.state, at: now }

    let ownerIds: string[] = []
    try {
      ownerIds = await owners.getOwnerIds()
    } catch (err) {
      console.error("Could not resolve bot owner for Qobuz alert:", (err as Error).message)
    }
    if (ownerIds.length === 0) {
      console.warn("Qobuz needs attention, but no bot owner is known to notify (set OWNER_ID)")
      return
    }

    const message = qobuzAuthPanelMessage(qobuz, "**Qobuz needs attention.** Users can still play Ohdio.")
    for (const id of ownerIds) {
      try {
        const user = await client.users.fetch(id)
        await user.send(message)
      } catch (err) {
        console.warn(`Could not DM bot owner ${id} about Qobuz:`, (err as Error).message)
      }
    }
  }

  void alert(qobuz.status)
  return qobuz.onStatusChange((status) => void alert(status))
}

export function createQobuzChannelNotices(client: Client, qobuz: QobuzService) {
  const noticed = new Map<string, QobuzStatus["state"]>()

  qobuz.onStatusChange((status) => {
    if (status.state === "ready") noticed.clear()
  })

  return async (guildId: string, error: Error, textChannelId: string | null): Promise<void> => {
    if (!(error instanceof QobuzError) || !textChannelId) return
    const message = qobuzUserMessage(error)
    if (!message) return

    const state = qobuz.status.state
    if (state === "ready" || noticed.get(guildId) === state) return
    noticed.set(guildId, state)

    try {
      const channel = await client.channels.fetch(textChannelId)
      if (channel?.isSendable()) {
        await channel.send(`Skipping Qobuz tracks: ${message}`)
      }
    } catch (err) {
      console.warn(`Could not post Qobuz notice in ${guildId}:`, (err as Error).message)
    }
  }
}
