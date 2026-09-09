import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  generateDependencyReport,
} from "@discordjs/voice"
import { Client, GatewayIntentBits, ChannelType } from "discord.js"
import {
  createPcmStream,
  fetchLiveSchedules,
  fetchPlaybackItems,
  parseEpisodeUrl,
  uniqueMediaIds,
  validateMedia,
} from "./lib.mjs"

const __dir = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dir, "../../.env") })

/**
 * Discord voice pipe for Ohdio HLS.
 *
 * Plays unique catch-up mediaIds in order (not every cue), then optional live.
 * Same ffmpeg raw PCM path as the Qobuz voice spike.
 */

const CATCHUP_URL =
  process.env.OHDIO_VOICE_URL ??
  "https://ici.radio-canada.ca/ohdio/premiere/emissions/penelope/episodes/1091696/mercredi-3-juin-2026"

const PLAY_SECONDS = Number(process.env.VOICE_SPIKE_SECONDS ?? 8)
const MAX_FILES = Number(process.env.OHDIO_VOICE_FILES ?? 2)
const INCLUDE_LIVE = process.argv.includes("--live")

const discordToken = process.env.DISCORD_TOKEN
const voiceChannelId = process.env.DISCORD_VOICE_CHANNEL_ID

if (!discordToken) {
  console.error("Missing DISCORD_TOKEN in .env")
  process.exit(1)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function pickVoiceChannel(client) {
  if (voiceChannelId) {
    const ch = await client.channels.fetch(voiceChannelId)
    if (!ch || ch.type !== ChannelType.GuildVoice) {
      throw new Error(`DISCORD_VOICE_CHANNEL_ID ${voiceChannelId} is not a voice channel`)
    }
    return ch
  }

  let best = null
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch()
    for (const ch of channels.values()) {
      if (ch?.type !== ChannelType.GuildVoice) continue
      const members = ch.members?.size ?? 0
      if (!best || members > best.members) {
        best = { channel: ch, members }
      }
    }
  }

  if (!best) throw new Error("no voice channels found — run: node ../voice/list-channels.mjs")
  return best.channel
}

async function resolveCatchupResources() {
  const parsed = parseEpisodeUrl(CATCHUP_URL)
  if (!parsed) throw new Error(`not an Ohdio episode URL: ${CATCHUP_URL}`)
  const playback = await fetchPlaybackItems(parsed.episodeId)
  if (playback.message || playback.__typename?.endsWith("Error")) {
    throw new Error(`playbackListByGlobalId ${playback.__typename} ${playback.message ?? ""}`)
  }
  const files = uniqueMediaIds(playback.items ?? []).slice(0, MAX_FILES)
  const resources = []
  for (const f of files) {
    const v = await validateMedia(f.mediaId, f.appCode)
    if (!v.hlsUrl) throw new Error(`no HLS for mediaId ${f.mediaId}: ${v.message}`)
    resources.push({
      label: `catch-up mediaId=${f.mediaId} (${f.cues.length} cue(s))`,
      hlsUrl: v.hlsUrl,
      tokenId: v.tokenId,
      akamaiTtl: v.akamaiTtl,
    })
  }
  return { episodeId: parsed.episodeId, playbackType: playback.__typename, resources }
}

async function resolveLiveResource() {
  const schedules = await fetchLiveSchedules()
  const premiere = schedules.schedules?.find((s) => s.broadcastingNetwork?.id === 3)
  if (!premiere) throw new Error("no ICI Première schedule")
  const callSign = premiere.broadcastingStationCallSign
  const v = await validateMedia(callSign, "medianetlive")
  if (!v.hlsUrl) throw new Error(`no live HLS for ${callSign}: ${v.message}`)
  return {
    label: `live ${premiere.broadcastingNetwork.title} callSign=${callSign} (${premiere.broadcasts?.[0]?.title ?? "?"})`,
    hlsUrl: v.hlsUrl,
    tokenId: v.tokenId,
    akamaiTtl: v.akamaiTtl,
  }
}

async function playUrl(player, hlsUrl, seconds) {
  const ffmpeg = createPcmStream(hlsUrl)
  ffmpeg.stderr.on("data", (chunk) => {
    const msg = chunk.toString().trim()
    if (msg) console.error(`ffmpeg: ${msg}`)
  })
  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  })
  player.play(resource)
  await entersState(player, AudioPlayerStatus.Playing, 15_000)
  await sleep(seconds * 1000)
  player.stop()
  ffmpeg.kill("SIGKILL")
  try {
    await entersState(player, AudioPlayerStatus.Idle, 5_000)
  } catch {
    // stop already tore down the resource
  }
}

console.log("Ohdio HLS → Discord voice spike")
console.log(`date: ${new Date().toISOString()}`)
console.log(`catch-up: ${CATCHUP_URL}`)
console.log(`seconds/file: ${PLAY_SECONDS}  files: ${MAX_FILES}  live: ${INCLUDE_LIVE}`)
console.log()
console.log(generateDependencyReport())
console.log()

const catchup = await resolveCatchupResources()
console.log(`playback: ${catchup.playbackType} episode ${catchup.episodeId}`)
for (const r of catchup.resources) {
  console.log(`  ${r.label}  tokenId=${r.tokenId} ttl=${r.akamaiTtl ?? "none"}s`)
  console.log(`    ${new URL(r.hlsUrl).host}${new URL(r.hlsUrl).pathname}`)
}

const playlist = [...catchup.resources]
if (INCLUDE_LIVE) {
  const live = await resolveLiveResource()
  console.log(`  ${live.label}  tokenId=${live.tokenId} ttl=${live.akamaiTtl ?? "none"}s`)
  playlist.push(live)
}
console.log()

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
})

client.on("ready", async () => {
  try {
    const channel = await pickVoiceChannel(client)
    console.log(`Joining: ${channel.guild.name} / ${channel.name} (${channel.id})`)

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
    })
    const player = createAudioPlayer()
    connection.on("stateChange", (oldState, newState) => {
      console.log(`connection: ${oldState.status} → ${newState.status}`)
    })
    player.on("stateChange", (oldState, newState) => {
      console.log(`player: ${oldState.status} → ${newState.status}`)
    })
    player.on("error", (err) => {
      console.error("player error:", err.message)
    })

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000)
    console.log("Voice connection ready")
    connection.subscribe(player)

    for (const item of playlist) {
      // Re-validate immediately before play (hdnea TTL can be 120s)
      const fresh = item.label.startsWith("live")
        ? await resolveLiveResource()
        : item
      if (!item.label.startsWith("live")) {
        const mediaId = item.label.match(/mediaId=(\d+)/)?.[1]
        if (mediaId) {
          const v = await validateMedia(mediaId, "medianet")
          if (v.hlsUrl) fresh.hlsUrl = v.hlsUrl
        }
      }
      console.log(`Playing ${PLAY_SECONDS}s — ${fresh.label ?? item.label}`)
      await playUrl(player, fresh.hlsUrl, PLAY_SECONDS)
    }

    connection.destroy()
    console.log()
    console.log("Done — left voice channel")
    console.log("OHDIO VOICE SPIKE: technical pass (joined, streamed unique HLS files, no errors)")
    console.log("Confirm audible playback in Discord, then mark spike done in SPIKE_RESULTS.md")
  } catch (err) {
    console.error("FAIL:", err.message)
    process.exitCode = 1
  } finally {
    await client.destroy()
  }
})

await client.login(discordToken)
