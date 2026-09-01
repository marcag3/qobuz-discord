import { describe, expect, it } from "vitest"
import { GuildQueue, QueueManager } from "../../src/player/queue.js"
import { MAX_QUEUE_SIZE, QueueFullError } from "../../src/player/limits.js"

describe("GuildQueue", () => {
  const track = { id: 1, title: "A", artistName: "Artist" }

  it("enqueues and dequeues tracks", () => {
    const queue = new GuildQueue()
    queue.enqueue([track, { ...track, id: 2, title: "B" }])
    expect(queue.size).toBe(2)
    expect(queue.dequeue()?.title).toBe("A")
    expect(queue.peek()?.title).toBe("B")
  })

  it("clears all items", () => {
    const queue = new GuildQueue()
    queue.enqueue([track])
    queue.clear()
    expect(queue.isEmpty()).toBe(true)
  })

  it("rejects enqueue when queue is full", () => {
    const queue = new GuildQueue()
    const tracks = Array.from({ length: MAX_QUEUE_SIZE }, (_, i) => ({
      id: i,
      title: `Track ${i}`,
      artistName: "Artist",
    }))
    queue.enqueue(tracks)
    expect(() => queue.enqueue([track])).toThrow(QueueFullError)
  })

  it("shuffles items in place", () => {
    const queue = new GuildQueue()
    const tracks = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      title: `Track ${i}`,
      artistName: "Artist",
    }))
    queue.enqueue(tracks)
    const before = queue.list().map((t) => t.id)
    queue.shuffle()
    const after = queue.list().map((t) => t.id)
    expect(after).toHaveLength(before.length)
    expect(after.sort()).toEqual(before.sort())
  })

  it("replaceAll swaps queue contents", () => {
    const queue = new GuildQueue()
    queue.enqueue([track])
    const replacement = [{ id: 99, title: "New", artistName: "Artist" }]
    queue.replaceAll(replacement)
    expect(queue.size).toBe(1)
    expect(queue.peek()?.id).toBe(99)
  })
})

describe("QueueManager", () => {
  it("keeps separate queues per guild", () => {
    const manager = new QueueManager()
    manager.forGuild("g1").enqueue([{ id: 1, title: "One", artistName: "A" }])
    manager.forGuild("g2").enqueue([{ id: 2, title: "Two", artistName: "B" }])

    expect(manager.forGuild("g1").size).toBe(1)
    expect(manager.forGuild("g2").size).toBe(1)
    expect(manager.forGuild("g1").peek()?.title).toBe("One")
  })
})
