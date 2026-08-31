import { createHash } from "crypto"
import { spawn } from "child_process"
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
import { fetchAppId } from "@kud/qobuz"

const __dir = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dir, "../../.env") })

const QOBUZ_BASE_URL = "https://www.qobuz.com/api.json/0.2"
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const TRACK_ID = 54091881 // Queen – Bohemian Rhapsody
const FORMAT_ID = Number(process.env.VOICE_SPIKE_FORMAT ?? 5) // MP3 320
const PLAY_SECONDS = Number(process.env.VOICE_SPIKE_SECONDS ?? 30)

const discordToken = process.env.DISCORD_TOKEN
const qobuzToken = process.env.QOBUZ_USER_TOKEN
const voiceChannelId = process.env.DISCORD_VOICE_CHANNEL_ID

if (!discordToken) {
  console.error("Missing DISCORD_TOKEN in .env")
  process.exit(1)
}
if (!qobuzToken) {
  console.error("Missing QOBUZ_USER_TOKEN in .env")
  process.exit(1)
}

function signTrackFileUrl(formatId, trackId, requestTs, appSecret) {
  const input = `trackgetFileUrlformat_id${formatId}intentstreamtrack_id${trackId}${requestTs}${appSecret}`
  return createHash("md5").update(input).digest("hex")
}

function deriveSecretsFromBundle(bundle) {
  const seeds = {}
  for (const m of bundle.matchAll(
    /[a-z]\.initialSeed\("([^"]+)",window\.utimezone\.([a-z]+)\)/g
  )) {
    seeds[m[2]] = [m[1]]
  }

  const timezones = Object.keys(seeds)
  if (timezones.length < 2) return []

  const ordered = [...timezones]
  const second = ordered.splice(1, 1)[0]
  ordered.unshift(second)

  const tzPattern = ordered.map((tz) => tz.charAt(0).toUpperCase() + tz.slice(1)).join("|")
  const infoExtrasRe = new RegExp(
    `name:"\\w+/(${tzPattern})",info:"([^"]+)",extras:"([^"]+)"`,
    "g"
  )

  for (const m of bundle.matchAll(infoExtrasRe)) {
    const tz = m[1].toLowerCase()
    if (seeds[tz]) seeds[tz].push(m[2], m[3])
  }

  const derived = []
  for (const [tz, parts] of Object.entries(seeds)) {
    if (parts.length < 3) continue
    try {
      const decoded = Buffer.from(parts.join("").slice(0, -44), "base64").toString("utf8")
      if (/^[0-9a-f]{32}$/.test(decoded)) derived.push({ tz, secret: decoded })
    } catch {
      // skip
    }
  }
  return derived
}

async function getFileUrl({ appId, appSecret, token, trackId, formatId }) {
  const requestTs = String(Math.floor(Date.now() / 1000))
  const requestSig = signTrackFileUrl(formatId, trackId, requestTs, appSecret)

  const params = new URLSearchParams({
    app_id: appId,
    track_id: String(trackId),
    format_id: String(formatId),
    intent: "stream",
    request_ts: requestTs,
    request_sig: requestSig,
  })

  const res = await fetch(`${QOBUZ_BASE_URL}/track/getFileUrl?${params}`, {
    headers: {
      "User-Agent": USER_AGENT,
      "X-App-Id": appId,
      "X-User-Auth-Token": token,
    },
  })

  const body = await res.text()
  if (!res.ok) throw new Error(`getFileUrl failed (${res.status}): ${body.slice(0, 300)}`)
  return JSON.parse(body)
}

async function fetchAppCredentials() {
  if (process.env.QOBUZ_APP_ID && process.env.QOBUZ_APP_SECRET) {
    return {
      appId: process.env.QOBUZ_APP_ID,
      appSecret: process.env.QOBUZ_APP_SECRET,
      source: "env",
    }
  }

  const { appId, bundlePath } = await fetchAppId()
  const res = await fetch(`https://play.qobuz.com${bundlePath}`, {
    headers: { "User-Agent": USER_AGENT },
  })
  if (!res.ok) throw new Error(`bundle fetch failed (${res.status})`)
  const bundle = await res.text()

  const derived = deriveSecretsFromBundle(bundle)
  for (const { tz, secret } of derived) {
    try {
      await getFileUrl({
        appId,
        appSecret: secret,
        token: qobuzToken,
        trackId: TRACK_ID,
        formatId: FORMAT_ID,
      })
      return { appId, appSecret: secret, source: `bundle (${tz})` }
    } catch {
      // try next
    }
  }

  throw new Error("no derived app_secret worked — refresh QOBUZ_USER_TOKEN")
}

function createFfmpegStream(url) {
  return spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-re",
      "-i",
      url,
      "-analyzeduration",
      "0",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  )
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

  if (!best) throw new Error("no voice channels found — run: node list-channels.mjs")
  return best.channel
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

console.log("Qobuz → Discord voice spike")
console.log(`date: ${new Date().toISOString()}`)
console.log(`track: ${TRACK_ID}, format: ${FORMAT_ID}, duration: ${PLAY_SECONDS}s`)
console.log()

const creds = await fetchAppCredentials()
console.log(`Qobuz creds: app_id ${creds.appId} (${creds.source})`)

const file = await getFileUrl({
  ...creds,
  token: qobuzToken,
  trackId: TRACK_ID,
  formatId: FORMAT_ID,
})
const streamUrl = file.url
if (!streamUrl) throw new Error("getFileUrl returned no url")

console.log(`CDN: ${new URL(streamUrl).hostname}, ${file.mime_type ?? "?"}`)
console.log()
console.log(generateDependencyReport())
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

    const ffmpeg = createFfmpegStream(streamUrl)
    ffmpeg.stderr.on("data", (chunk) => {
      const msg = chunk.toString().trim()
      if (msg) console.error(`ffmpeg: ${msg}`)
    })

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    })

    connection.subscribe(player)
    player.play(resource)

    await entersState(player, AudioPlayerStatus.Playing, 10_000)
    console.log(`Playing — listen in #${channel.name} for ${PLAY_SECONDS}s`)
    console.log("(Spike pass = you hear audio; confirm manually)")

    await sleep(PLAY_SECONDS * 1000)

    player.stop()
    connection.destroy()
    console.log()
    console.log("Done — left voice channel")
    console.log()
    console.log("VOICE SPIKE: technical pass (joined, streamed, no errors)")
    console.log("Confirm audible playback in Discord, then mark spike done in SPIKE_RESULTS.md")
  } catch (err) {
    console.error("FAIL:", err.message)
    process.exitCode = 1
  } finally {
    await client.destroy()
  }
})

await client.login(discordToken)
