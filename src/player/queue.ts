import type { Track } from "../qobuz/types.js"

export class GuildQueue {
  private readonly items: Track[] = []

  enqueue(tracks: Track[]): void {
    this.items.push(...tracks)
  }

  dequeue(): Track | undefined {
    return this.items.shift()
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

  clearGuild(guildId: string): void {
    this.forGuild(guildId).clear()
  }

  removeGuild(guildId: string): void {
    this.queues.delete(guildId)
  }
}
