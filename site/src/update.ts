import { Array, Match, Option, pipe } from "effect"
import { Command, type Update } from "foldkit"
import { modifyFields } from "foldkit/struct"

import type { AppState } from "./apps/appState"
import * as Diagram from "./apps/diagram"
import * as Dialog from "./apps/dialog"
import * as Explorer from "./apps/explorer"
import * as Help from "./apps/help"
import * as Notepad from "./apps/notepad"
import { appIdOf, type AppDefinition, definition, type Launch, launchFor } from "./apps/registry"
import { Request } from "./apps/request"
import * as Welcome from "./apps/welcome"
import { FocusUacCancel, PlayChime, SaveWelcomeAtStartup, WaitForLoader, WaitForWelcome } from "./command"
import { cascadeRect, keepGrabbable, resize, translate } from "./domain/geometry"
import { Review } from "./domain/review"
import { children, desktopPath, type FilePath, lookup } from "./domain/vfs"
import * as Desk from "./domain/window"
import { Message } from "./message"
import { deskSize, type Flags, Gesture, isPhone, type Model, Session, Switcher, Uac } from "./model"
import { Tour, tourSteps } from "./tour"
import { tourHooks } from "./tourHooks"

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
    uac: Uac.Hidden(),
    tour: Tour.Off(),
    isWelcomeAtStartup: flags.isWelcomeAtStartup,
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
    model: model.desk.windows.length === 0 && !isPhone(model) && model.isWelcomeAtStartup ? startApp(arrived, definition("welcome")) : arrived,
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


// ---------------------------------------------------------------------------------------------------
// Apps built in unit 2c talk to the shell through `Request` (src/apps/request.ts).

type AppReturn<A, M> = Update.ReturnWithOutMessage<A, M, Request>

/** Runs one app's update inside its window, lifts its Commands, and answers its Request. */
const updateApp = <A extends AppState, M>(
  model: Model,
  windowId: Desk.WindowId,
  pick: (app: AppState) => Option.Option<A>,
  step: (app: A) => AppReturn<A, M>,
  toMessage: (message: M) => Message,
): UpdateReturn =>
  pipe(
    Desk.find(model.desk, windowId),
    Option.flatMap((win) => pick(win.app)),
    Option.match({
      onNone: () => ({ model }),
      onSome: (app) => {
        const next = step(app)
        const updated = { ...model, desk: Desk.setApp(model.desk, windowId, next.model) }
        const commands = Command.mapMessages(next.commands, toMessage)
        if (next.outMessage === undefined) return { model: updated, commands }
        const answered = handleRequest(updated, windowId, next.outMessage)
        return { model: answered.model, commands: [...commands, ...(answered.commands ?? [])] }
      },
    }),
  )

const askForApproval = (model: Model): UpdateReturn =>
  model.uac._tag === "Hidden"
    ? { model: { ...model, uac: Uac.Asking({ isDetailsShown: false }), isStartMenuOpen: false, switcher: Switcher.Closed() }, commands: [FocusUacCancel()] }
    : { model }

/** The Commands a window needs when it opens: force-push.bat's pretend crash runs on a timer. */
const openingCommands = (before: Model, after: Model): UpdateReturn => {
  const maybeNew = after.desk.nextId > before.desk.nextId ? Array.last(after.desk.windows) : Option.none()
  return Option.match(
    Option.flatMap(maybeNew, (win) => (win.app._tag === "Dialog" ? Option.some([win.id, win.app] as const) : Option.none())),
    {
      onNone: () => ({ model: after }),
      onSome: ([windowId, dialog]) => ({
        model: after,
        commands: Command.mapMessages(Dialog.initCommands(dialog), (message) => Message.GotDialogMessage({ windowId, message })),
      }),
    },
  )
}

const openPathWithCommands = (model: Model, path: FilePath): UpdateReturn => openingCommands(model, openPath(model, path))

const handleRequest = (model: Model, windowId: Desk.WindowId, request: Request): UpdateReturn =>
  Request.match<UpdateReturn>(request, {
    RequestedOpenPath: ({ path }) => openPathWithCommands(model, path),
    RequestedStartApp: ({ app }) => ({ model: startApp(model, definition(app)) }),
    RequestedApproval: () => askForApproval(model),
    RequestedTour: () => enterTourStep(model, 0),
    RequestedClose: () => ({ model: withDesk(model, (desk) => Desk.close(desk, windowId)) }),
    RequestedWelcomeAtStartup: ({ isShown }) => ({ model: { ...model, isWelcomeAtStartup: isShown }, commands: [SaveWelcomeAtStartup({ isShown })] }),
  })

const byTag =
  <Tag extends AppState["_tag"]>(tag: Tag) =>
  (app: AppState): Option.Option<Extract<AppState, { _tag: Tag }>> =>
    app._tag === tag ? Option.some(app as Extract<AppState, { _tag: Tag }>) : Option.none()

// ---------------------------------------------------------------------------------------------------
// The tour: each step opens or focuses its app, then runs its hook from src/tourHooks.ts.

const focusOrLaunch = (model: Model, app: AppDefinition, maybePath: Option.Option<FilePath>): Model =>
  pipe(
    Array.findLast(model.desk.windows, (win) => appIdOf(win.app) === app.id),
    Option.match({
      onSome: (win) => withDesk(model, (desk) => Desk.focus(desk, win.id)),
      onNone: () => launch(model, { app, maybeNode: Option.flatMap(maybePath, lookup) }),
    }),
  )

const enterTourStep = (model: Model, index: number): UpdateReturn =>
  pipe(
    Array.get(tourSteps, index),
    Option.match({
      onNone: () => ({ model: { ...model, tour: Tour.Off() } }),
      onSome: (step) => {
        const opened = { ...focusOrLaunch(model, definition(step.app), step.maybePath), tour: Tour.On({ step: index }) }
        return Option.match(opened.desk.maybeFocused, {
          onNone: () => ({ model: opened }),
          onSome: (windowId) => tourHooks[step.id](opened, windowId),
        })
      },
    }),
  )

const tourStep = (model: Model, offset: number): UpdateReturn =>
  Tour.match<UpdateReturn>(model.tour, {
    Off: () => ({ model }),
    On: ({ step }) => (step + offset >= tourSteps.length ? { model: { ...model, tour: Tour.Off() } } : enterTourStep(model, Math.max(0, step + offset))),
  })

// ---------------------------------------------------------------------------------------------------
// The secure desktop

const refuse = (model: Model, clicked: "Continue" | "Cancel"): UpdateReturn =>
  model.uac._tag === "Asking" ? { model: { ...model, uac: Uac.Refused({ clicked }) } } : { model }

const baseUpdate = (model: Model, message: Message): UpdateReturn =>
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
    DoubleClickedIcon: ({ path }) => openPathWithCommands({ ...model, maybeSelectedIcon: Option.some(path) }, path),
    ClickedStart: () => ({ model: modifyFields(model, { isStartMenuOpen: (open) => !open }) }),
    ClickedStartPath: ({ path }) => openPathWithCommands(model, path),
    ClickedStartApp: ({ app }) => ({ model: startApp(model, definition(app)) }),
    ClickedPower: () => ({
      model: {
        ...model,
        session: Session.Booting({ stage: "Loader" }),
        desk: Desk.emptyDesk,
        isStartMenuOpen: false,
        review: Review.Idle(),
        uac: Uac.Hidden(),
        tour: Tour.Off(),
      },
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
        Match.when({ uac: { _tag: "Asking" } }, () => refuse(model, "Cancel")),
        Match.when({ uac: { _tag: "Refused" } }, () => ({ model: { ...model, uac: Uac.Hidden() } })),
        Match.when({ switcher: { _tag: "Open" } }, () => ({ model: { ...model, switcher: Switcher.Closed() } })),
        Match.when({ isStartMenuOpen: true }, () => ({ model: { ...model, isStartMenuOpen: false } })),
        Match.orElse(() => ({ model: { ...model, maybeSelectedIcon: Option.none() } })),
      ),
    PressedEnter: () =>
      model.uac._tag !== "Hidden"
        ? { model }
        : model.session._tag === "Booting"
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
    GotDiagramMessage: ({ windowId, message }) =>
      updateApp(model, windowId, byTag("Diagram"), (app) => Diagram.update(app, message), (child) => Message.GotDiagramMessage({ windowId, message: child })),
    GotExplorerMessage: ({ windowId, message }) =>
      updateApp(model, windowId, byTag("Explorer"), (app) => Explorer.update(app, message), (child) => Message.GotExplorerMessage({ windowId, message: child })),
    GotWelcomeMessage: ({ windowId, message }) =>
      updateApp(model, windowId, byTag("Welcome"), (app) => Welcome.update(app, message), (child) => Message.GotWelcomeMessage({ windowId, message: child })),
    GotHelpMessage: ({ windowId, message }) =>
      updateApp(model, windowId, byTag("Help"), (app) => Help.update(app, message), (child) => Message.GotHelpMessage({ windowId, message: child })),
    GotDialogMessage: ({ windowId, message }) =>
      updateApp(model, windowId, byTag("Dialog"), (app) => Dialog.update(app, message), (child) => Message.GotDialogMessage({ windowId, message: child })),
    CompletedSaveWelcomeAtStartup: () => ({ model }),

    RequestedApproval: () => askForApproval(model),
    ClickedUacContinue: () => refuse(model, "Continue"),
    ClickedUacCancel: () => refuse(model, "Cancel"),
    ToggledUacDetails: () => ({
      model: model.uac._tag === "Asking" ? { ...model, uac: Uac.Asking({ isDetailsShown: !model.uac.isDetailsShown }) } : model,
    }),
    ClickedUacClose: () => ({ model: { ...model, uac: Uac.Hidden() } }),
    CompletedFocusUac: () => ({ model }),

    ClickedTourNext: () => tourStep(model, 1),
    ClickedTourBack: () => tourStep(model, -1),
    ClickedTourEnd: () => ({ model: { ...model, tour: Tour.Off() } }),
  })

/** A review that has just finished asks to approve the merge request, and Heron cancels itself. */
export const update = (model: Model, message: Message): UpdateReturn => {
  const next = baseUpdate(model, message)
  if (model.review._tag !== "Running" || next.model.review._tag !== "Done") return next
  const asked = askForApproval(next.model)
  return { model: asked.model, commands: [...(next.commands ?? []), ...(asked.commands ?? [])] }
}
