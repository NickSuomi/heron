/// <reference types="vite/client" />

declare module "virtual:heron-files" {
  export const heronFiles: ReadonlyArray<{ readonly path: string; readonly content: string }>
}
