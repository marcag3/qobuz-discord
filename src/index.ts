import { config as loadDotenv } from "dotenv"
import { loadConfig, ConfigError } from "./config.js"

loadDotenv()

let shuttingDown = false

export function isShuttingDown(): boolean {
  return shuttingDown
}

export function markShuttingDown(): void {
  shuttingDown = true
}

async function main(): Promise<void> {
  let appConfig
  try {
    appConfig = loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }

  const { startBot } = await import("./bot/client.js")
  const bot = await startBot(appConfig)

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    markShuttingDown()
    console.log(`Received ${signal}, shutting down...`)
    try {
      await bot.shutdown()
    } catch (err) {
      console.error("Shutdown error:", err)
    }
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
