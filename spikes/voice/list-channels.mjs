import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { Client, GatewayIntentBits, ChannelType } from "discord.js"

const __dir = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dir, "../../.env") })

const token = process.env.DISCORD_TOKEN
if (!token) {
  console.error("Missing DISCORD_TOKEN in .env")
  process.exit(1)
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
})

await client.login(token)

console.log(`Bot: ${client.user.tag} (${client.user.id})`)
console.log()

if (client.guilds.cache.size === 0) {
  console.log("No guilds — invite the bot to a server first.")
  await client.destroy()
  process.exit(1)
}

for (const guild of client.guilds.cache.values()) {
  console.log(`Guild: ${guild.name} (${guild.id})`)
  const channels = await guild.channels.fetch()
  const voice = [...channels.values()].filter(
    (ch) => ch?.type === ChannelType.GuildVoice
  )
  if (voice.length === 0) {
    console.log("  (no voice channels)")
  } else {
    for (const ch of voice) {
      const members = ch.members?.size ?? 0
      console.log(`  voice: ${ch.name} (${ch.id}) — ${members} connected`)
    }
  }
  console.log()
}

console.log("Set DISCORD_VOICE_CHANNEL_ID in .env to the channel you want the spike to join.")
await client.destroy()
