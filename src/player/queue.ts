import type { Track } from "../qobuz/types.js"
import { MAX_QUEUE_SIZE, QueueFullError } from "./limits.js"

export function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
}

export class GuildQueue {
  private readonly items: Track[] = []

  enqueue(tracks: Track[]): void {
    if (this.items.length + tracks.length > MAX_QUEUE_SIZE) {
      throw new QueueFullError(MAX_QUEUE_SIZE)
    }
    this.items.push(...tracks)
  }

  dequeue(): Track | undefined {
    return this.items.shift()
  }

  prepend(track: Track): void {
    if (this.items.length >= MAX_QUEUE_SIZE) {
      throw new QueueFullError(MAX_QUEUE_SIZE)
    }
    this.items.unshift(track)
  }

  peek(): Track | undefined {
    return this.items[0]
  }

  clear(): void {
    this.items.length = 0
  }

  list(): Track[] {
    return [...this.items]
  }

  get size(): number {
    return this.items.length
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  shuffle(): void {
    shuffleInPlace(this.items)
  }

  replaceAll(tracks: Track[]): void {
    this.items.length = 0
    this.items.push(...tracks)
  }
}

export class QueueManager {
  private readonly queues = new Map<string, GuildQueue>()

  forGuild(guildId: string): GuildQueue {
    let queue = this.queues.get(guildId)
    if (!queue) {
      queue = new GuildQueue()
      this.queues.set(guildId, queue)
    }
    return queue
  }

  removeGuild(guildId: string): void {
    this.queues.delete(guildId)
  }
}
