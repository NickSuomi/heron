import { Clock, Effect } from "effect"
import { Runtime } from "foldkit"

import { welcomeAtStartupKey } from "./command"
import "./styles/index.css"
import { Flags, Model } from "./model"
import { isNativeGlassAvailable } from "./shell/glass"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

const readWelcomeAtStartup = Effect.try(() => window.localStorage.getItem(welcomeAtStartupKey) !== "false").pipe(
  Effect.orElseSucceed(() => true),
)

const flags = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis
  const isWelcomeAtStartup = yield* readWelcomeAtStartup
  return {
    isWelcomeAtStartup,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    now,
    glass: isNativeGlassAvailable() ? ("Native" as const) : ("Css" as const),
  }
})

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById("root"),
})

Runtime.run(application, { flags })
