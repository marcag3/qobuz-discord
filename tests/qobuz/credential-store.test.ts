import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCredentialStore } from "../../src/qobuz/credential-store.js"

describe("createCredentialStore", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "qobuz-creds-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("returns null when the file does not exist", async () => {
    expect(await createCredentialStore(join(dir, "missing.json")).load()).toBeNull()
  })

  it("saves with owner-only permissions and loads back", async () => {
    const path = join(dir, "nested", "creds.json")
    const store = createCredentialStore(path)

    await store.save({ userToken: "tok", appId: "123456789", appSecret: undefined })
    const loaded = await store.load()

    expect(loaded).toMatchObject({ userToken: "tok", appId: "123456789" })
    expect(loaded).not.toHaveProperty("appSecret")
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, "utf8")).updatedAt).toMatch(/^\d{4}-/)
  })

  it("ignores a corrupt file instead of crashing", async () => {
    const path = join(dir, "creds.json")
    await writeFile(path, "{not json")
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    expect(await createCredentialStore(path).load()).toBeNull()
  })

  it("clear removes the file", async () => {
    const path = join(dir, "creds.json")
    const store = createCredentialStore(path)
    await store.save({ userToken: "tok" })

    await store.clear()

    expect(await store.load()).toBeNull()
  })
})
