import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
  type TextChannel,
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
import {
  CONTROL_IDS,
  buildControlRow,
  buildNowPlayingEmbed,
  formatTrackList,
} from "./messages.js"
import { registerCommands } from "./register-commands.js"
import { userFacingError } from "./errors.js"

export type BotHandle = {
  shutdown: () => Promise<void>
}

export async function startBot(config: AppConfig): Promise<BotHandle> {
  const qobuz = createQobuzClient(config)
  await qobuz.init()

  const queueManager = new QueueManager()
  const nowPlayingMessages = new Map<string, string>()

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  })

  const player = new GuildPlayerManager(qobuz, queueManager, {
    onTrackStart: async (guildId, track) => {
      const guild = await client.guilds.fetch(guildId).catch(() => null)
      if (!guild) return

      const channel = guild.systemChannel ?? guild.channels.cache.find((c) => c.isTextBased())
      if (!channel?.isTextBased()) return

      const embed = buildNowPlayingEmbed(track)
      const row = buildControlRow()

      const previousId = nowPlayingMessages.get(guildId)
      if (previousId) {
        await channel.messages.delete(previousId).catch(() => undefined)
      }

      const message = await (channel as TextChannel).send({ embeds: [embed], components: [row] })
      nowPlayingMessages.set(guildId, message.id)
    },
    onIdle: async (guildId) => {
      const messageId = nowPlayingMessages.get(guildId)
      if (!messageId) return

      const guild = await client.guilds.fetch(guildId).catch(() => null)
      const channel = guild?.systemChannel ?? guild?.channels.cache.find((c) => c.isTextBased())
      if (channel?.isTextBased()) {
        await channel.messages.delete(messageId).catch(() => undefined)
      }
      nowPlayingMessages.delete(guildId)
    },
    onError: async (guildId, error) => {
      console.error(`Playback error in ${guildId}:`, error.message)
    },
  })

  client.once("ready", () => {
    console.log(`Logged in as ${client.user?.tag}`)
  })

  client.on("interactionCreate", (interaction) => {
    void handleInteraction(interaction, qobuz, player, nowPlayingMessages)
  })

  await registerCommands(config)
  await client.login(config.discordToken)

  return {
    shutdown: async () => {
      await player.shutdown()
      client.destroy()
    },
  }
}

async function handleInteraction(
  interaction: Interaction,
  qobuz: ReturnType<typeof createQobuzClient>,
  player: GuildPlayerManager,
  nowPlayingMessages: Map<string, string>
): Promise<void> {
  try {
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
      await handleButton(interaction, player, nowPlayingMessages)
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
  player: GuildPlayerManager,
  nowPlayingMessages: Map<string, string>
): Promise<void> {
  if (!interaction.isButton() || !interaction.guildId) return

  switch (interaction.customId) {
    case CONTROL_IDS.skip:
      if (!player.isPlaying(interaction.guildId)) {
        await interaction.reply({ content: "Nothing is playing.", flags: MessageFlags.Ephemeral })
        return
      }
      await player.skip(interaction.guildId)
      await interaction.reply({ content: "Skipped.", flags: MessageFlags.Ephemeral })
      break
    case CONTROL_IDS.stop:
      await player.stop(interaction.guildId)
      nowPlayingMessages.delete(interaction.guildId)
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
