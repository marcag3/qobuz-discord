import {
  Client,
  GatewayIntentBits,
  GuildMember,
  MessageFlags,
  type Interaction,
  type VoiceState,
} from "discord.js"
import "@snazzah/davey"
import type { AppConfig } from "../config.js"
import { createQobuzClient } from "../qobuz/client.js"
import { GuildPlayerManager } from "../player/guild-manager.js"
import { QueueManager } from "../player/queue.js"
import { handlePlay } from "./commands/play.js"
import { handleSkip } from "./commands/skip.js"
import { handleQueue } from "./commands/queue.js"
import { handleStop } from "./commands/stop.js"
import { handleSearch, handleSearchSelect } from "./commands/search.js"
import { CONTROL_IDS, formatTrackList } from "./messages.js"
import { handleAutocomplete } from "./autocomplete.js"
import { clearNowPlaying, updateNowPlaying, type NowPlayingRegistry } from "./now-playing.js"
import { registerCommands } from "./register-commands.js"
import { assertPlaybackControl } from "./permissions.js"
import { userFacingError } from "./errors.js"

export type BotHandle = {
  shutdown: () => Promise<void>
}

const AUTO_DISCONNECT_MS = 60_000

export async function startBot(config: AppConfig): Promise<BotHandle> {
  const qobuz = createQobuzClient(config)
  await qobuz.init()

  const queueManager = new QueueManager()
  const nowPlayingMessages: NowPlayingRegistry = new Map()
  const emptyChannelTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  })

  const player = new GuildPlayerManager(qobuz, queueManager, {
    onTrackStart: async (guildId, track, textChannelId) => {
      await updateNowPlaying(
        client,
        nowPlayingMessages,
        guildId,
        track,
        player.getPlaybackState(guildId),
        textChannelId
      )
    },
    onIdle: async (guildId) => {
      clearEmptyChannelTimer(emptyChannelTimers, guildId)
      await clearNowPlaying(client, nowPlayingMessages, guildId)
    },
    onPlaybackStateChange: async (guildId, _track, textChannelId, state) => {
      const track = player.getCurrentTrack(guildId)
      if (!track) return
      await updateNowPlaying(client, nowPlayingMessages, guildId, track, state, textChannelId)
    },
    onError: async (guildId, error) => {
      console.error(`Playback error in ${guildId}:`, error.message)
    },
  })

  client.once("clientReady", () => {
    console.log(`Logged in as ${client.user?.tag}`)
  })

  client.on("interactionCreate", (interaction) => {
    void handleInteraction(interaction, qobuz, player)
  })

  client.on("voiceStateUpdate", (oldState, newState) => {
    void handleVoiceStateUpdate(oldState, newState, player, emptyChannelTimers)
  })

  await registerCommands(config)
  await client.login(config.discordToken)

  return {
    shutdown: async () => {
      for (const timer of emptyChannelTimers.values()) {
        clearTimeout(timer)
      }
      emptyChannelTimers.clear()
      await player.shutdown()
      client.destroy()
    },
  }
}

function clearEmptyChannelTimer(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  guildId: string
): void {
  const timer = timers.get(guildId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(guildId)
  }
}

async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
  player: GuildPlayerManager,
  timers: Map<string, ReturnType<typeof setTimeout>>
): Promise<void> {
  const guildId = oldState.guild.id
  const botChannelId = player.getVoiceChannelId(guildId)
  if (!botChannelId) return

  const affectedBotChannel =
    oldState.channelId === botChannelId || newState.channelId === botChannelId
  if (!affectedBotChannel) return

  const channel = oldState.guild.channels.cache.get(botChannelId)
  if (!channel || !channel.isVoiceBased()) return

  const humanCount = channel.members.filter((m) => !m.user.bot).size

  if (humanCount === 0) {
    if (timers.has(guildId)) return
    const timer = setTimeout(() => {
      timers.delete(guildId)
      void player.stop(guildId)
    }, AUTO_DISCONNECT_MS)
    timers.set(guildId, timer)
    return
  }

  clearEmptyChannelTimer(timers, guildId)
}

async function handleInteraction(
  interaction: Interaction,
  qobuz: ReturnType<typeof createQobuzClient>,
  player: GuildPlayerManager
): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction, qobuz)
      return
    }

    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case "play":
          await handlePlay(interaction, qobuz, player)
          break
        case "search":
          await handleSearch(interaction, qobuz)
          break
        case "skip":
          await handleSkip(interaction, player)
          break
        case "queue":
          await handleQueue(interaction, player)
          break
        case "stop":
          await handleStop(interaction, player)
          break
      }
      return
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "search:select") {
      await handleSearchSelect(interaction, qobuz, player)
      return
    }

    if (interaction.isButton()) {
      await handleButton(interaction, player)
    }
  } catch (err) {
    const content = userFacingError(err)
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined)
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined)
      }
    }
  }
}

async function handleButton(
  interaction: Interaction,
  player: GuildPlayerManager
): Promise<void> {
  if (!interaction.isButton() || !interaction.guildId) return

  const member = interaction.member
  if (!(member instanceof GuildMember)) return

  const denied = assertPlaybackControl(member, player, interaction.guildId)
  if (denied) {
    await interaction.reply({ content: denied, flags: MessageFlags.Ephemeral })
    return
  }

  switch (interaction.customId) {
    case CONTROL_IDS.pause: {
      if (!player.isPlaying(interaction.guildId)) {
        await interaction.reply({ content: "Nothing is playing.", flags: MessageFlags.Ephemeral })
        return
      }
      const ok = await player.togglePause(interaction.guildId)
      if (!ok) {
        await interaction.reply({ content: "Nothing is playing.", flags: MessageFlags.Ephemeral })
        return
      }
      await interaction.deferUpdate()
      break
    }
    case CONTROL_IDS.skip:
      if (!player.isPlaying(interaction.guildId)) {
        await interaction.reply({ content: "Nothing is playing.", flags: MessageFlags.Ephemeral })
        return
      }
      await player.skip(interaction.guildId)
      await interaction.reply({ content: "Skipped.", flags: MessageFlags.Ephemeral })
      break
    case CONTROL_IDS.shuffle: {
      if (!player.isPlaying(interaction.guildId)) {
        await interaction.reply({ content: "Nothing is playing.", flags: MessageFlags.Ephemeral })
        return
      }
      await player.toggleShuffle(interaction.guildId)
      await interaction.deferUpdate()
      break
    }
    case CONTROL_IDS.loop: {
      if (!player.isPlaying(interaction.guildId)) {
        await interaction.reply({ content: "Nothing is playing.", flags: MessageFlags.Ephemeral })
        return
      }
      await player.cycleLoop(interaction.guildId)
      await interaction.deferUpdate()
      break
    }
    case CONTROL_IDS.stop:
      await player.stop(interaction.guildId)
      await interaction.reply({ content: "Stopped.", flags: MessageFlags.Ephemeral })
      break
    case CONTROL_IDS.queue: {
      const current = player.getCurrentTrack(interaction.guildId)
      const upcoming = player.getUpcomingTracks(interaction.guildId)
      const text = current
        ? `**Now playing:** ${current.title} — ${current.artistName}\n\n${formatTrackList(upcoming)}`
        : formatTrackList(upcoming)
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral })
      break
    }
  }
}
