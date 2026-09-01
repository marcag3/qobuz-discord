export type LoopMode = "off" | "track" | "queue"

export type PlaybackState = {
  loopMode: LoopMode
  shuffle: boolean
  paused: boolean
}

const LOOP_MODES: LoopMode[] = ["off", "track", "queue"]

const LOOP_MODE_LABELS: Record<LoopMode, string> = {
  off: "Loop: Off",
  track: "Loop: Track",
  queue: "Loop: Queue",
}

export function createPlaybackState(): PlaybackState {
  return {
    loopMode: "off",
    shuffle: false,
    paused: false,
  }
}

export function cycleLoopMode(current: LoopMode): LoopMode {
  const idx = LOOP_MODES.indexOf(current)
  return LOOP_MODES[(idx + 1) % LOOP_MODES.length]
}

export function loopModeLabel(mode: LoopMode): string {
  return LOOP_MODE_LABELS[mode]
}
