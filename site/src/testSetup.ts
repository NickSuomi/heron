import { loadFileContents } from "./domain/vfs"

// The tests read file text synchronously, so they load it before the first test, as the shell does before the desktop.
await loadFileContents()
