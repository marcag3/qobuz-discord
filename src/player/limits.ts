/** Max tracks waiting in a guild queue (excluding the track currently playing). */
export const MAX_QUEUE_SIZE = 100

export class QueueFullError extends Error {
  constructor(maxSize: number) {
    super(`Queue is full (max ${maxSize} tracks). Skip or stop before adding more.`)
    this.name = "QueueFullError"
  }
}
