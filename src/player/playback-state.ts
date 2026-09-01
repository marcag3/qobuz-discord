export type LoopMode = "off" | "track" | "queue"

export type PlaybackState = {
  loopMode: LoopMode
  shuffle: boolean
  paused: boolean
}

export function createPlaybackState(
  overrides: Partial<PlaybackState> = {}
): PlaybackState {
  return {
    loopMode: "off",
    shuffle: false,
    paused: false,
    ...overrides,
  }
}

export function cycleLoopMode(current: LoopMode): LoopMode {
  if (current === "off") return "track"
  if (current === "track") return "queue"
  return "off"
}

export function toggleShuffle(current: boolean): boolean {
  return !current
}

export function loopModeLabel(mode: LoopMode): string {
  if (mode === "off") return "Loop: Off"
  if (mode === "track") return "Loop: Track"
  return "Loop: Queue"
}
