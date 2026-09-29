import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import * as Render from "foldkit/render"

import { loadFileContents } from "./domain/vfs"
import { Message } from "./message"

export const WaitForLoader = Command.define("WaitForLoader", {
  messages: [Message.CompletedWaitForLoader],
  execute: Effect.all([Effect.sleep(Duration.millis(900)), Effect.promise(loadFileContents)]).pipe(Effect.as(Message.CompletedWaitForLoader())),
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

export const welcomeAtStartupKey = "heron-os.welcome-at-startup"

/** Remembers the Welcome Center's "Show this at startup" checkbox. Storage failures are ignored. */
export const SaveWelcomeAtStartup = Command.define("SaveWelcomeAtStartup", {
  args: { isShown: Schema.Boolean },
  messages: [Message.CompletedSaveWelcomeAtStartup],
  execute: ({ isShown }) =>
    Effect.try(() => window.localStorage.setItem(welcomeAtStartupKey, String(isShown))).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedSaveWelcomeAtStartup()),
    ),
})

/** The secure desktop opens with Cancel focused, so Enter or Space cancels. */
export const FocusUacCancel = Command.define("FocusUacCancel", {
  messages: [Message.CompletedFocusUac],
  execute: Dom.focus("#uac-cancel").pipe(Effect.ignore, Effect.as(Message.CompletedFocusUac())),
})

/**
 * Keyboard input follows the active window: its marked primary input takes focus, or the window itself. Focus that is
 * already inside the window, such as a field the visitor just clicked, stays where it is.
 */
export const FocusWindow = Command.define("FocusWindow", {
  args: { windowId: Schema.Number },
  messages: [Message.CompletedFocusWindow],
  execute: ({ windowId }) =>
    Render.afterCommit.pipe(
      Effect.andThen(Effect.sync(() => {
        const win = document.querySelector(`[data-window-id="${windowId}"]`)
        if (!(win instanceof HTMLElement) || win.contains(document.activeElement)) return
        const primary = win.querySelector("[data-primary-input]")
        ;(primary instanceof HTMLElement ? primary : win).focus({ preventScroll: true })
      })),
      Effect.ignore,
      Effect.as(Message.CompletedFocusWindow()),
    ),
})
