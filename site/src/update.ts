import { Array, Match, Option, pipe } from "effect"
import type { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"

import * as Notepad from "./apps/notepad"
import { appIdOf, type AppDefinition, definition, type Launch, launchFor } from "./apps/registry"
import { PlayChime, WaitForLoader, WaitForWelcome } from "./command"
import { cascadeRect, keepGrabbable, resize, translate } from "./domain/geometry"
import { Review } from "./domain/review"
import { children, desktopPath, type FilePath, lookup } from "./domain/vfs"
import * as Desk from "./domain/window"
import { Message } from "./message"
import { deskSize, type Flags, Gesture, isPhone, type Model, Session, Switcher } from "./model"

type UpdateReturn = Update.Return<Model, Message>

export const init = (flags: Flags): UpdateReturn => ({
  model: {
    session: Session.Booting({ stage: "Loader" }),
    desk: Desk.emptyDesk,
    gesture: Gesture.Idle(),
    maybeSelectedIcon: Option.none(),
    isStartMenuOpen: false,
    switcher: Switcher.Closed(),
    viewport: flags.viewport,
    now: flags.now,
    isMuted: false,
    isAudioUnlocked: false,
    glass: flags.glass,
    review: Review.Idle(),
  },
  commands: [WaitForLoader()],
})

const launch = (model: Model, { app, maybeNode }: Launch): Model => {
  const existing = app.isSingleInstance ? Array.findFirst(model.desk.windows, (win) => appIdOf(win.app) === app.id) : Option.none()
  const desk = Option.match(existing, {
    onSome: (win) => Desk.focus(model.desk, win.id),
    onNone: () =>
      Desk.open(
        model.desk,
        app.launch(maybeNode),
        cascadeRect(app.size, deskSize(model), model.desk.nextId - 1),
        isPhone(model) ? "Maximised" : "Normal",
      ),
  })
  return { ...model, desk, isStartMenuOpen: false }
}

const openPath = (model: Model, path: FilePath): Model =>
  pipe(
    lookup(path),
    Option.flatMap(launchFor),
    Option.match({ onNone: () => model, onSome: (target) => launch(model, target) }),
  )

const startApp = (model: Model, app: AppDefinition): Model => launch(model, { app, maybeNode: Option.none() })

// The desktop opens on the Welcome Center; the phone opens on its Today screen.
const enterDesktop = (model: Model, isAudioUnlocked: boolean): UpdateReturn => {
  const arrived = { ...model, session: Session.Desktop(), isAudioUnlocked }
  return {
    model: model.desk.windows.length === 0 && !isPhone(model) ? startApp(arrived, definition("welcome")) : arrived,
    commands: isAudioUnlocked && !model.isMuted ? [PlayChime()] : [],
  }
}

const withDesk = (model: Model, f: (desk: Desk.Desk) => Desk.Desk): Model => ({ ...model, desk: f(model.desk), isStartMenuOpen: false })

const desktopIcons = (): ReadonlyArray<FilePath> => children(desktopPath).map((node) => node.path)

const moveSelection = (model: Model, isForward: boolean): Model => {
  const icons = desktopIcons()
  const index = Option.match(model.maybeSelectedIcon, {
    onNone: () => (isForward ? 0 : icons.length - 1),
    onSome: (path) => Math.min(Math.max(icons.indexOf(path) + (isForward ? 1 : -1), 0), icons.length - 1),
  })
  return { ...model, maybeSelectedIcon: Array.get(icons, index) }
}

const isDesktopActive = (model: Model): boolean =>
  model.session._tag === "Desktop" && Option.isNone(model.desk.maybeFocused) && !model.isStartMenuOpen

const drag = (model: Model, x: number, y: number): Model =>
  Gesture.match<Model>(model.gesture, {
    Idle: () => model,
    Moving: ({ windowId, origin, start }) =>
      withDesk(model, (desk) => Desk.setBounds(desk, windowId, keepGrabbable(translate(start, x - origin.x, y - origin.y), deskSize(model)))),
    Resizing: ({ windowId, edge, origin, start }) =>
      withDesk(model, (desk) => Desk.setBounds(desk, windowId, resize(start, edge, x - origin.x, y - origin.y))),
  })

const gestureStart = (model: Model, windowId: Desk.WindowId, gesture: (start: Desk.Window) => Gesture): Model =>
  pipe(
    Desk.find(model.desk, windowId),
    Option.filter((win) => win.display === "Normal" && !isPhone(model)),
    Option.match({
      onNone: () => withDesk(model, (desk) => Desk.focus(desk, windowId)),
      onSome: (win) => ({ ...withDesk(model, (desk) => Desk.focus(desk, windowId)), gesture: gesture(win) }),
    }),
  )

const switchWindow = (model: Model, isBackward: boolean): Model => {
  const count = model.desk.windows.length
  if (model.session._tag !== "Desktop" || count === 0) return model
  const step = isBackward ? -1 : 1
  const index = Switcher.match<number>(model.switcher, {
    Closed: () => (count > 1 ? (step + count) % count : 0),
    Open: (open) => (open.index + step + count) % count,
  })
  return { ...model, switcher: Switcher.Open({ index }), isStartMenuOpen: false }
}

const commitSwitch = (model: Model): Model =>
  Switcher.match<Model>(model.switcher, {
    Closed: () => model,
    Open: ({ index }) =>
      pipe(
        Array.get(Desk.switchOrder(model.desk), index),
        Option.match({
          onNone: () => ({ ...model, switcher: Switcher.Closed() }),
          onSome: (win) => ({ ...withDesk(model, (desk) => Desk.focus(desk, win.id)), switcher: Switcher.Closed() }),
        }),
      ),
  })

const updateNotepad = (model: Model, windowId: Desk.WindowId, message: Notepad.Message): UpdateReturn =>
  pipe(
    Desk.find(model.desk, windowId),
    Option.flatMap((win) => (win.app._tag === "Notepad" ? Option.some(win.app) : Option.none())),
    Option.match({
      onNone: () => ({ model }),
      onSome: (notepad) => {
        const next = Notepad.update(notepad, message)
        const updated = { ...model, desk: Desk.setApp(model.desk, windowId, next.model) }
        return next.outMessage === undefined
          ? { model: updated }
          : Notepad.OutMessage.match<UpdateReturn>(next.outMessage, {
              RequestedClose: () => ({ model: { ...updated, desk: Desk.close(updated.desk, windowId) } }),
            })
      },
    }),
  )

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    CompletedWaitForLoader: () =>
      model.session._tag === "Booting" && model.session.stage === "Loader"
        ? { model: { ...model, session: Session.Booting({ stage: "Welcome" }) }, commands: [WaitForWelcome()] }
        : { model },
    CompletedWaitForWelcome: () =>
      model.session._tag === "Booting" && model.session.stage === "Welcome" ? enterDesktop(model, model.isAudioUnlocked) : { model },
    SkippedBoot: () => (model.session._tag === "Booting" ? enterDesktop(model, true) : { model }),

    PressedDesktop: () => ({
      model: { ...withDesk(model, Desk.blur), maybeSelectedIcon: Option.none(), switcher: Switcher.Closed() },
    }),
    ClickedIcon: ({ path }) => ({ model: { ...withDesk(model, Desk.blur), maybeSelectedIcon: Option.some(path) } }),
    DoubleClickedIcon: ({ path }) => ({ model: openPath({ ...model, maybeSelectedIcon: Option.some(path) }, path) }),
    ClickedStart: () => ({ model: modifyFields(model, { isStartMenuOpen: (open) => !open }) }),
    ClickedStartPath: ({ path }) => ({ model: openPath(model, path) }),
    ClickedStartApp: ({ app }) => ({ model: startApp(model, definition(app)) }),
    ClickedPower: () => ({
      model: { ...model, session: Session.Booting({ stage: "Loader" }), desk: Desk.emptyDesk, isStartMenuOpen: false, review: Review.Idle() },
      commands: [WaitForLoader()],
    }),
    ClickedLock: () => ({
      model: { ...model, session: Session.Booting({ stage: "Welcome" }), isStartMenuOpen: false },
      commands: [WaitForWelcome()],
    }),

    ClickedToday: () => ({
      model: withDesk(model, (desk) => model.desk.windows.reduce((next, win) => Desk.minimise(next, win.id), desk)),
    }),
    ClickedTaskbarButton: ({ windowId }) => ({ model: withDesk(model, (desk) => Desk.activateFromTaskbar(desk, windowId)) }),
    ToggledMute: () => ({
      model: { ...model, isMuted: !model.isMuted, isAudioUnlocked: true },
      commands: model.isMuted ? [PlayChime()] : [],
    }),

    PressedWindow: ({ windowId }) => ({
      model: Desk.isFocused(model.desk, windowId) && !model.isStartMenuOpen ? model : withDesk(model, (desk) => Desk.focus(desk, windowId)),
    }),
    PressedTitleBar: ({ windowId, x, y }) => ({
      model: gestureStart(model, windowId, (win) => Gesture.Moving({ windowId, origin: { x, y }, start: win.bounds })),
    }),
    PressedResizeHandle: ({ windowId, edge, x, y }) => ({
      model: gestureStart(model, windowId, (win) => Gesture.Resizing({ windowId, edge, origin: { x, y }, start: win.bounds })),
    }),
    DoubleClickedTitleBar: ({ windowId }) => ({
      model: isPhone(model) ? model : { ...withDesk(model, (desk) => Desk.toggleMaximise(desk, windowId)), gesture: Gesture.Idle() },
    }),
    MovedPointer: ({ x, y }) => ({ model: drag(model, x, y) }),
    ReleasedPointer: () => ({ model: { ...model, gesture: Gesture.Idle() } }),
    ClickedMinimise: ({ windowId }) => ({ model: withDesk(model, (desk) => Desk.minimise(desk, windowId)) }),
    ClickedMaximise: ({ windowId }) => ({ model: withDesk(model, (desk) => Desk.toggleMaximise(desk, windowId)) }),
    ClickedClose: ({ windowId }) => ({ model: withDesk(model, (desk) => Desk.close(desk, windowId)) }),

    PressedSwitchWindow: ({ isBackward }) => ({ model: switchWindow(model, isBackward) }),
    ReleasedAlt: () => ({ model: commitSwitch(model) }),
    PressedStartKey: () => ({
      model: model.session._tag === "Desktop" ? modifyFields(model, { isStartMenuOpen: (open) => !open }) : model,
    }),
    PressedEscape: () =>
      Match.value(model).pipe(
        Match.withReturnType<UpdateReturn>(),
        Match.when({ session: { _tag: "Booting" } }, () => enterDesktop(model, true)),
        Match.when({ switcher: { _tag: "Open" } }, () => ({ model: { ...model, switcher: Switcher.Closed() } })),
        Match.when({ isStartMenuOpen: true }, () => ({ model: { ...model, isStartMenuOpen: false } })),
        Match.orElse(() => ({ model: { ...model, maybeSelectedIcon: Option.none() } })),
      ),
    PressedEnter: () =>
      model.session._tag === "Booting"
        ? enterDesktop(model, true)
        : {
            model: isDesktopActive(model)
              ? Option.match(model.maybeSelectedIcon, { onNone: () => model, onSome: (path) => openPath(model, path) })
              : model,
          },
    PressedArrow: ({ isForward }) => ({ model: isDesktopActive(model) && !isPhone(model) ? moveSelection(model, isForward) : model }),

    TickedClock: ({ now }) => ({ model: { ...model, now } }),
    ResizedViewport: ({ viewport }) => ({ model: { ...model, viewport } }),
    CompletedPlayChime: () => ({ model }),
    CompletedMountGlass: () => ({ model }),
    FailedMountGlass: () => ({ model: { ...model, glass: "Css" } }),

    GotNotepadMessage: ({ windowId, message }) => updateNotepad(model, windowId, message),
  })
