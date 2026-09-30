"use strict"
// Heron's tsserver. It runs TypeScript 5.9.3 from Heron's `typescript-5` dependency and loads exactly two tsserver
// plugins, each from Heron's own install by a fixed path: the Effect language service and the Vue TypeScript plugin.
// A plugin that the reviewed repository's tsconfig names is refused, and no plugin is looked up by walking directories,
// so nothing in the reviewed tree, and no other package installed near Heron, runs inside this process.
const { realpathSync } = require("node:fs")
const { basename, dirname, join, resolve, sep } = require("node:path")

const PLUGINS = new Map([
  ["@effect/language-service", require.resolve("@effect/language-service")],
  ["@vue/typescript-plugin", require.resolve("@vue/typescript-plugin")]
])

const load = (entry, log) => {
  const path = PLUGINS.get(entry.name)
  if (path === undefined) {
    const refused = `Heron loads only its own tsserver plugins; refused ${JSON.stringify(entry.name)}`
    log(refused)
    return { pluginConfigEntry: entry, resolvedModule: undefined, errorLogs: [refused] }
  }
  const module = require(path)
  return { pluginConfigEntry: entry, resolvedModule: entry.name === "@vue/typescript-plugin" ? withVueSymbols(module) : module, errorLogs: undefined }
}

/**
 * The Vue plugin answers a navigation tree for a .vue file with no children, because its items point into the code
 * it generates. This wrapper maps each item's name back to the .vue file and keeps the items that land there.
 */
const withVueSymbols = (factory) => (modules) => {
  const plugin = factory(modules)
  return {
    ...plugin,
    create(info) {
      const generated = info.languageService
      const service = plugin.create(info)
      const getNavigationTree = (fileName) => {
        const language = info.project.__vue__?.language
        if (language === undefined || !fileName.endsWith(".vue")) return service.getNavigationTree(fileName)
        const at = (span) => volar.transform.transformSpan(language, fileName, span, true, volar.core.isDefinitionEnabled)
        const mapped = (item) => {
          const children = (item.childItems ?? []).flatMap(mapped)
          const name = item.nameSpan === undefined ? undefined : at(item.nameSpan)
          if (name === undefined || name.fileName !== fileName) return children
          const spans = item.spans.map(at).filter((s) => s?.fileName === fileName).map((s) => s.textSpan)
          return [{ ...item, nameSpan: name.textSpan, spans: spans.length > 0 ? spans : [name.textSpan], childItems: children }]
        }
        const tree = generated.getNavigationTree(fileName)
        return { ...tree, childItems: (tree.childItems ?? []).flatMap(mapped) }
      }
      // The Vue plugin's service is a Proxy that ignores assignments to the methods it maps, so wrap it instead.
      return new Proxy(service, { get: (target, key) => (key === "getNavigationTree" ? getNavigationTree : Reflect.get(target, key)) })
    }
  }
}

const ts = require("typescript-5/lib/typescript.js")
if (ts.version !== require("../package.json").version) {
  // typescript-language-server reads the version from ../package.json and picks its protocol by it.
  throw new Error(`tsserver/package.json says ${require("../package.json").version}, but typescript-5 is ${ts.version}`)
}
ts.server.Project.importServicePluginSync = (entry, _searchPaths, _host, log) => load(entry, log)
ts.server.Project.importServicePluginAsync = async (entry, _searchPaths, _host, log) => load(entry, log)

const resolveFrom = (dir, id) => require.resolve(id, { paths: [dir] })
const VUE_PLUGIN = dirname(PLUGINS.get("@vue/typescript-plugin"))
const VOLAR_TYPESCRIPT = dirname(resolveFrom(VUE_PLUGIN, "@volar/typescript"))
const volar = {
  transform: require(`${VOLAR_TYPESCRIPT}/lib/node/transform`),
  core: require(resolveFrom(VOLAR_TYPESCRIPT, "@volar/language-core"))
}

// A tsconfig's `vueCompilerOptions.plugins` names modules that the Vue plugin would resolve from the tsconfig's
// directory and `require`. Heron drops that key before the Vue plugin reads it; every other Vue option still applies.
const { CompilerOptionsResolver } = require(resolveFrom(VUE_PLUGIN, "@vue/language-core"))
const addConfig = CompilerOptionsResolver.prototype.addConfig
CompilerOptionsResolver.prototype.addConfig = function(options, rootDir) {
  const { plugins: _refused, ...rest } = options ?? {}
  return addConfig.call(this, rest, rootDir)
}

// Heron never installs the reviewed repository's dependencies, and without `vue` and `effect` types the Vue and Effect
// plugins have nothing to check. An import of either that the tree cannot resolve resolves to Heron's own pinned
// declarations of the major version the nearest package.json declares; with no such declaration it stays unresolved.
// tsserver only reads these .d.ts files. Imports inside them resolve the same way, from Heron's install.
const SUPPLIED = new Map([["vue", new Map([["3", "vue"]])], ["effect", new Map([["3", "effect-3"], ["4", "effect"]])]])
const OWN_MODULES = `${dirname(dirname(__dirname))}/node_modules/`
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
const RESOLUTION = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }

const declared = new Map()
/** The dependencies the package.json nearest to `dir` declares, read once per directory. */
const declaredAt = (dir) => {
  if (!declared.has(dir)) {
    const text = ts.sys.readFile(`${dir}/package.json`)
    let deps = null
    if (text !== undefined) {
      try {
        const json = JSON.parse(text)
        deps = Object.assign({}, ...DEPENDENCY_FIELDS.map((f) => (typeof json[f] === "object" && json[f] !== null ? json[f] : {})))
      } catch {
        deps = {}
      }
    }
    const parent = dirname(dir)
    declared.set(dir, deps ?? (parent === dir ? {} : declaredAt(parent)))
  }
  return declared.get(dir)
}

/** The Heron package that stands in for `name` imported from `containingFile`, or null. */
const suppliedFor = (name, containingFile) => {
  const pkg = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]
  const majors = SUPPLIED.get(pkg)
  if (majors === undefined) return null
  const deps = declaredAt(dirname(containingFile))
  const range = Object.hasOwn(deps, pkg) ? deps[pkg] : undefined
  const major = typeof range === "string" ? /(\d+)/.exec(range.replace(/^npm:[^@]+@/, ""))?.[1] : undefined
  const own = major === undefined ? undefined : majors.get(major)
  return own === undefined ? null : own + name.slice(pkg.length)
}

const resolveModuleNameLiterals = ts.server.Project.prototype.resolveModuleNameLiterals
ts.server.Project.prototype.resolveModuleNameLiterals = function(literals, containingFile, redirected, options, sourceFile, reused) {
  const results = resolveModuleNameLiterals.call(this, literals, containingFile, redirected, options, sourceFile, reused)
  const own = containingFile.startsWith(OWN_MODULES)
  return results.map((result, i) => {
    if (result.resolvedModule !== undefined) return result
    const name = literals[i].text
    const from = own ? { name, file: containingFile } : { name: suppliedFor(name, containingFile), file: __filename }
    if (from.name === null) return result
    const mode = ts.getModeForUsageLocation(sourceFile, literals[i], options)
    const found = ts.resolveModuleName(from.name, from.file, RESOLUTION, ts.sys, undefined, undefined, mode)
    return found.resolvedModule === undefined ? result : found
  })
}

// tsserver reads what the reviewed tsconfig names: `include` and `files` entries, `extends`, `typeRoots`, `paths` and
// `references` can all be absolute paths or symbolic links anywhere on the host, and tsserver also walks up from the
// tree looking for tsconfig.json, package.json and node_modules. tsserver and both plugins reach the file system only
// through `ts.sys`, so Heron wraps it: a path whose real path, symbolic links resolved, lies outside the tree
// (`HERON_TSSERVER_ROOT`, set by Heron's language-server client) and outside Heron's own node_modules does not exist,
// as far as tsserver can tell.
const TREE = process.env["HERON_TSSERVER_ROOT"]
if (TREE === undefined || TREE === "") throw new Error("HERON_TSSERVER_ROOT names no tree for Heron's tsserver")

/** The real path of `path`, or of its nearest existing ancestor with the rest appended when `path` does not exist. */
const realOf = (path) => {
  try {
    return realpathSync.native(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realOf(parent), basename(path))
  }
}
const READABLE = [TREE, OWN_MODULES].map((dir) => realOf(resolve(dir)))
const readable = new Map()
const canRead = (path) => {
  if (typeof path !== "string") return false
  const absolute = resolve(path)
  if (!readable.has(absolute)) {
    const real = realOf(absolute)
    readable.set(absolute, READABLE.some((dir) => real === dir || real.startsWith(dir + sep)))
  }
  return readable.get(absolute)
}

const wrap = (name, wrapper) => {
  ts.sys[name] = wrapper(ts.sys[name].bind(ts.sys))
}
const refusing = (refused) => (original) => (path, ...rest) => (canRead(path) ? original(path, ...rest) : refused)
wrap("readFile", refusing(undefined))
wrap("fileExists", refusing(false))
wrap("directoryExists", refusing(false))
wrap("getModifiedTime", refusing(undefined))
wrap("getFileSize", refusing(0))
wrap("watchFile", refusing({ close() {} }))
wrap("watchDirectory", refusing({ close() {} }))
// A symbolic link that leads outside keeps its own path, which canRead then refuses.
wrap("realpath", (original) => (path) => {
  const real = original(path)
  return canRead(real) ? real : path
})
// An absolute `include` makes readDirectory list outside directories even when `path` is the tree, so each result is checked.
wrap("readDirectory", (original) => (...args) => original(...args).filter(canRead))
wrap("getDirectories", (original) => (path) => (canRead(path) ? original(path).filter((name) => canRead(join(path, name))) : []))

require("typescript-5/lib/tsserver.js")
