import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import {
  connect,
  createMemoryStore,
  createTransport,
  fetchAppId,
  validateCredentials,
} from "@kud/qobuz"

const __dir = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dir, "../../.env") })

const token = process.env.QOBUZ_USER_TOKEN
if (!token) {
  console.error("Missing QOBUZ_USER_TOKEN in .env")
  process.exit(1)
}

function maskToken(t) {
  if (t.length <= 8) return "***"
  return `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} chars)`
}

async function tryEndpoint(transport, endpoint, params = {}) {
  try {
    const data = await transport.get(endpoint, params)
    return { ok: true, status: 200, data }
  } catch (err) {
    return {
      ok: false,
      status: err.status ?? null,
      message: err.message ?? String(err),
      kind: err.kind ?? "unknown",
    }
  }
}

console.log("Qobuz auth spike")
console.log(`date: ${new Date().toISOString()}`)
console.log(`token: ${maskToken(token)}`)
console.log()

// 1. Bootstrap app_id (same path connect() uses)
console.log("1. Bootstrap app_id from play.qobuz.com bundle")
let appId
try {
  const boot = await fetchAppId()
  appId = boot.appId
  console.log(`   app_id: ${appId}`)
  console.log(`   bundle: ${boot.bundlePath}`)
} catch (err) {
  console.error(`   FAIL: ${err.message}`)
  process.exit(1)
}
console.log()

// 2. validateCredentials (what @kud/qobuz connect() calls)
console.log("2. validateCredentials (favorite/getUserFavorites)")
try {
  await validateCredentials({ appId, token })
  console.log("   PASS — token accepted (200 on favorites probe)")
} catch (err) {
  console.error(`   FAIL: ${err.message}`)
  if (err.kind === "auth" || err.status === 401) {
    console.error()
    console.error("Token rejected. Refresh from play.qobuz.com DevTools → api.json → X-User-Auth-Token")
  }
  process.exit(1)
}
console.log()

const transport = createTransport({ appId, token })

// 3. user/get — documented spike endpoint
console.log("3. user/get (profile)")
const userGet = await tryEndpoint(transport, "user/get")
if (userGet.ok) {
  const u = userGet.data
  console.log(`   PASS — user id: ${u.id}`)
  console.log(`   login: ${u.login ?? "(none)"}`)
  console.log(`   display: ${u.display_name ?? u.nickname ?? "(none)"}`)
  console.log(`   subscription: ${u.subscription?.offer ?? u.credential?.label ?? "(unknown)"}`)
  if (u.last_update) {
    const lu = typeof u.last_update === "object" ? JSON.stringify(u.last_update) : u.last_update
    console.log(`   last_update: ${lu}`)
  }
} else {
  console.log(`   FAIL — ${userGet.status ?? "?"} ${userGet.message}`)
}
console.log()

// 4. Additional authenticated probes (playback-relevant)
console.log("4. Other authenticated endpoints")
const probes = [
  ["favorite/getUserFavorites", { type: "albums", limit: 1 }],
  ["playlist/getUserPlaylists", { limit: 1 }],
  ["catalog/search", { query: "test", limit: 1 }],
]

for (const [endpoint, params] of probes) {
  const result = await tryEndpoint(transport, endpoint, params)
  const label = result.ok ? "PASS" : `FAIL (${result.status ?? result.kind})`
  console.log(`   ${endpoint}: ${label}`)
}
console.log()

// 5. connect() end-to-end
console.log("5. connect() full flow")
const store = createMemoryStore()
try {
  const client = await connect({ token, store })
  const saved = await store.load()
  console.log(`   PASS — client ready, stored app_id=${saved.appId}`)
  const probe = await client.search.search("test", { limit: 1 })
  console.log(`   search probe: ${probe.tracks?.length ?? 0} track(s) returned`)
  await client.signOut()
} catch (err) {
  console.error(`   FAIL: ${err.message}`)
  process.exit(1)
}
console.log()

// 6. Invalid token sanity check
console.log("6. Invalid token sanity check (expect 401)")
const bad = await tryEndpoint(
  createTransport({ appId, token: "invalid-token-for-spike" }),
  "user/get"
)
if (!bad.ok && (bad.status === 401 || bad.kind === "auth")) {
  console.log("   PASS — invalid token rejected as expected")
} else {
  console.log(`   WARN — expected 401, got: ${bad.status ?? bad.message}`)
}
console.log()

console.log("=".repeat(60))
console.log("AUTH SPIKE SUMMARY")
console.log()
console.log("Token works: yes")
console.log(`app_id: ${appId}`)
console.log(`user/get: ${userGet.ok ? `yes (id ${userGet.data.id})` : "no"}`)
console.log()
console.log("Refresh cadence: not measured in this run (requires waiting for expiry).")
console.log("Operational note: re-copy X-User-Auth-Token from browser when API returns 401.")
console.log("@kud/qobuz connect() validates via favorite/getUserFavorites, not user/get.")
