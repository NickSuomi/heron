import { Clock, Duration, Effect, Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"

import { Message } from "./message"
import type { Model } from "./model"

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))

/** Focus on the page itself or the desktop surface, not inside a window, the taskbar or the Start menu. */
const isOnDesktop = (target: EventTarget | null): boolean =>
  target === document.body || target === document.documentElement || (target instanceof Element && target.closest(".desktop-surface") !== null)

/** Browsers keep Alt+Tab and the Windows key, so Heron OS switches windows with Alt+` and opens Start with Ctrl+Esc. */
const shellKey = (event: KeyboardEvent): Option.Option<Message> => {
  if (event.altKey && event.code === "Backquote") return Option.some(Message.PressedSwitchWindow({ isBackward: event.shiftKey }))
  if (event.ctrlKey && event.key === "Escape") return Option.some(Message.PressedStartKey())
  if (event.key === "Escape") return Option.some(Message.PressedEscape())
  if (isTextField(event.target) || event.altKey || event.ctrlKey || event.metaKey) return Option.none()
  const isDesktopIcon = event.target instanceof Element && event.target.closest(".desktop-icon") !== null
  const isControl = event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement
  if (event.key === "Enter" && (isDesktopIcon || !isControl)) return Option.some(Message.PressedEnter())
  // Arrow keys move the desktop selection only; everywhere else they scroll, and change selects and radio groups.
  if (!isOnDesktop(event.target)) return Option.none()
  if (["ArrowDown", "ArrowRight"].includes(event.key)) return Option.some(Message.PressedArrow({ isForward: true }))
  if (["ArrowUp", "ArrowLeft"].includes(event.key)) return Option.some(Message.PressedArrow({ isForward: false }))
  return Option.none()
}

const viewportNow = () => ({ width: window.innerWidth, height: window.innerHeight })

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  keys: Subscription.persistent(
    Subscription.fromEventFilterMapPreventDefault({ target: document, type: "keydown", filterMapEvent: shellKey }),
  ),
  altRelease: Subscription.persistent(
    Subscription.fromEventFilterMap({
      target: document,
      type: "keyup",
      filterMapEvent: (event) => (event.key === "Alt" ? Option.some(Message.ReleasedAlt()) : Option.none()),
    }),
  ),
  clock: Subscription.persistent(
    Stream.tick(Duration.seconds(1)).pipe(
      Stream.mapEffect(() => Clock.currentTimeMillis),
      Stream.map((now) => Message.TickedClock({ now })),
    ),
  ),
  viewport: Subscription.persistent(
    Subscription.fromEvent({ target: window, type: "resize", mapEvent: () => undefined }).pipe(
      Stream.debounce(Duration.millis(60)),
      Stream.map(() => Message.ResizedViewport({ viewport: viewportNow() })),
    ),
  ),
  // While a review runs, its clock ticks ten times a second; the update emits the events that are due.
  review: entry(
    { isRunning: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isRunning: model.review._tag === "Running" }),
      dependenciesToStream: ({ isRunning }) =>
        Stream.when(
          Stream.tick(Duration.millis(100)).pipe(
            Stream.mapEffect(() => Clock.currentTimeMillis),
            Stream.map((now) => Message.TickedReview({ now })),
          ),
          Effect.sync(() => isRunning),
        ),
    },
  ),
  pointer: entry(
    { isDragging: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isDragging: model.gesture._tag !== "Idle" }),
      dependenciesToStream: ({ isDragging }) =>
        Stream.when(
          Stream.merge(
            Subscription.fromEvent({
              target: document,
              type: "pointermove",
              mapEvent: (event) => Message.MovedPointer({ x: event.clientX, y: event.clientY }),
            }),
            Subscription.fromEvent({ target: document, type: "pointerup", mapEvent: () => Message.ReleasedPointer() }),
          ),
          Effect.sync(() => isDragging),
        ),
    },
  ),
}))
