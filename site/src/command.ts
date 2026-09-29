import { Duration, Effect } from "effect"
import { Command } from "foldkit"

import { Message } from "./message"

export const WaitForLoader = Command.define("WaitForLoader", {
  messages: [Message.CompletedWaitForLoader],
  execute: Effect.sleep(Duration.millis(900)).pipe(Effect.as(Message.CompletedWaitForLoader())),
})

export const WaitForWelcome = Command.define("WaitForWelcome", {
  messages: [Message.CompletedWaitForWelcome],
  execute: Effect.sleep(Duration.millis(650)).pipe(Effect.as(Message.CompletedWaitForWelcome())),
})

/** An original four-note chime: a rising major arpeggio on soft sine bells with a slow tail. */
const playChime = (): void => {
  const context = new AudioContext()
  const master = context.createGain()
  master.gain.value = 0.18
  master.connect(context.destination)
  const notes: ReadonlyArray<readonly [frequency: number, at: number]> = [
    [392.0, 0],
    [587.33, 0.16],
    [783.99, 0.34],
    [987.77, 0.56],
  ]
  for (const [frequency, at] of notes) {
    for (const [ratio, level] of [[1, 1], [2, 0.18], [3.01, 0.06]] as const) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = "sine"
      oscillator.frequency.value = frequency * ratio
      const start = context.currentTime + at
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(level, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.4)
      oscillator.connect(gain).connect(master)
      oscillator.start(start)
      oscillator.stop(start + 2.5)
    }
  }
  setTimeout(() => void context.close(), 3500)
}

export const PlayChime = Command.define("PlayChime", {
  messages: [Message.CompletedPlayChime],
  execute: Effect.sync(playChime).pipe(
      Effect.catchCause(() => Effect.void),
      Effect.as(Message.CompletedPlayChime()),
    ),
})
