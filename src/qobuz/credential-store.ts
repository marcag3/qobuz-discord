import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { QobuzCredentialInput } from "./types.js"

export type SavedQobuzCredentials = QobuzCredentialInput & { updatedAt: string }

export type QobuzCredentialStore = {
  readonly path: string
  load(): Promise<SavedQobuzCredentials | null>
  save(creds: QobuzCredentialInput): Promise<SavedQobuzCredentials>
  clear(): Promise<void>
}

export function createCredentialStore(path: string): QobuzCredentialStore {
  return {
    path,

    async load() {
      let raw: string
      try {
        raw = await readFile(path, "utf8")
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
        throw err
      }

      try {
        return parseSaved(JSON.parse(raw))
      } catch {
        console.warn(`Ignoring unreadable Qobuz credentials file at ${path}`)
        return null
      }
    },

    async save(creds) {
      const saved: SavedQobuzCredentials = {
        ...pickCredentials(creds),
        updatedAt: new Date().toISOString(),
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(saved, null, 2), { mode: 0o600 })
      await chmod(tmp, 0o600)
      await rename(tmp, path)
      return saved
    },

    async clear() {
      await rm(path, { force: true })
    },
  }
}

function parseSaved(value: unknown): SavedQobuzCredentials {
  if (typeof value !== "object" || value === null) throw new Error("not an object")
  const record = value as Record<string, unknown>
  for (const key of ["userToken", "appId", "appSecret", "updatedAt"]) {
    if (record[key] !== undefined && typeof record[key] !== "string") {
      throw new Error(`invalid ${key}`)
    }
  }
  return {
    ...pickCredentials(record as QobuzCredentialInput),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  }
}

function pickCredentials(creds: QobuzCredentialInput): QobuzCredentialInput {
  const picked: QobuzCredentialInput = {}
  if (creds.userToken) picked.userToken = creds.userToken
  if (creds.appId) picked.appId = creds.appId
  if (creds.appSecret) picked.appSecret = creds.appSecret
  return picked
}
