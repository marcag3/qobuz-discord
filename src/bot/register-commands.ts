import { REST, Routes, SlashCommandBuilder } from "discord.js"
import type { AppConfig } from "../config.js"

const commands = [
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search Qobuz and pick a result")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Song, artist, or album").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play the top Qobuz result or a Qobuz URL")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Search query or Qobuz URL").setRequired(true)
    ),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the upcoming queue"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
].map((cmd) => cmd.toJSON())

export async function registerCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken)

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.guildId), {
      body: commands,
    })
    console.log(`Registered ${commands.length} guild commands`)
    return
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), { body: commands })
  console.log(`Registered ${commands.length} global commands`)
}
