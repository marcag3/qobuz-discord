import { ActivityType, type Client } from "discord.js"
import type { PlaybackState } from "../player/playback-state.js"
import type { Track } from "../qobuz/types.js"

const MAX_ACTIVITY_LENGTH = 128

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

export function formatListeningActivity(
  track: Track,
  paused: boolean
): { name: string; state: string } {
  const name = truncate(track.title, MAX_ACTIVITY_LENGTH)
  const artist = track.artistName
  const state = paused ? `Paused · ${artist}` : artist
  return {
    name,
    state: truncate(state, MAX_ACTIVITY_LENGTH),
  }
}

type GuildPresence = {
  track: Track
  paused: boolean
}

export type PresenceManager = ReturnType<typeof createPresenceManager>

export function createPresenceManager(client: Client) {
  const guilds = new Map<string, GuildPresence>()
  let activeGuildId: string | null = null

  async function apply(): Promise<void> {
    if (!client.user) return

    if (activeGuildId === null || !guilds.has(activeGuildId)) {
      activeGuildId = guilds.keys().next().value ?? null
    }

    const entry = activeGuildId ? guilds.get(activeGuildId) : undefined
    if (!entry) {
      client.user.setPresence({ activities: [] })
      activeGuildId = null
      return
    }

    const { name, state } = formatListeningActivity(entry.track, entry.paused)
    client.user.setPresence({
      activities: [
        {
          name,
          type: ActivityType.Listening,
          state,
        },
      ],
    })
  }

  return {
    async setTrack(guildId: string, track: Track, paused = false): Promise<void> {
      guilds.set(guildId, { track, paused })
      activeGuildId = guildId
      await apply()
    },

    async updateState(guildId: string, state: PlaybackState): Promise<void> {
      const entry = guilds.get(guildId)
      if (!entry) return
      guilds.set(guildId, { ...entry, paused: state.paused })
      if (activeGuildId === guildId) {
        await apply()
      }
    },

    async clearGuild(guildId: string): Promise<void> {
      guilds.delete(guildId)
      if (activeGuildId === guildId) {
        activeGuildId = guilds.keys().next().value ?? null
      }
      await apply()
    },

    async clear(): Promise<void> {
      guilds.clear()
      activeGuildId = null
      await apply()
    },
  }
}
