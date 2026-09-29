import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib"

// A minimal WOFF2 container reader and writer. It exists for two jobs and nothing more: read a font's
// character map (the site's font test) and rewrite its name table (build/rename-font.ts). The glyph
// tables stay in their compressed, transformed form; only the name table is untransformed here.

const knownTags = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG",
  "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc",
  "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
]

type Entry = Readonly<{ tag: string; flags: number; origLength: number; transformLength: number | null; extraTag: Buffer | null }>

export type Woff2 = Readonly<{ header: Buffer; entries: ReadonlyArray<Entry>; tables: ReadonlyMap<string, Buffer>; tail: Buffer }>

const readBase128 = (bytes: Buffer, at: number): readonly [number, number] => {
  let value = 0
  for (let i = 0; i < 5; i++) {
    const byte = bytes[at + i]
    value = value * 128 + (byte & 127)
    if ((byte & 128) === 0) return [value, at + i + 1]
  }
  throw new Error("bad UIntBase128")
}

const writeBase128 = (value: number): Buffer => {
  const out: Array<number> = []
  let rest = value
  do {
    out.unshift(rest & 127)
    rest = Math.floor(rest / 128)
  } while (rest > 0)
  return Buffer.from(out.map((byte, i) => (i < out.length - 1 ? byte | 128 : byte)))
}

export const parse = (bytes: Buffer): Woff2 => {
  if (bytes.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a WOFF2 file")
  const count = bytes.readUInt16BE(12)
  const compressedSize = bytes.readUInt32BE(20)
  let at = 48
  const entries: Array<Entry> = []
  for (let i = 0; i < count; i++) {
    const flags = bytes[at++]
    const index = flags & 63
    let extraTag: Buffer | null = null
    if (index === 63) {
      extraTag = bytes.subarray(at, at + 4)
      at += 4
    }
    const tag = extraTag === null ? knownTags[index] : extraTag.toString("latin1")
    const [origLength, afterOrig] = readBase128(bytes, at)
    at = afterOrig
    const version = flags >> 6
    const isTransformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0
    let transformLength: number | null = null
    if (isTransformed) {
      const [length, afterTransform] = readBase128(bytes, at)
      transformLength = length
      at = afterTransform
    }
    entries.push({ tag, flags, origLength, transformLength, extraTag })
  }
  const header = bytes.subarray(0, 48)
  const stream = brotliDecompressSync(bytes.subarray(at, at + compressedSize))
  const tables = new Map<string, Buffer>()
  let offset = 0
  for (const entry of entries) {
    const length = entry.transformLength ?? entry.origLength
    tables.set(entry.tag, stream.subarray(offset, offset + length))
    offset += length
  }
  return { header, entries, tables, tail: bytes.subarray(at + compressedSize) }
}

/** Every code point the font's Unicode character map maps to a glyph other than .notdef. */
export const codePoints = (font: Woff2): ReadonlySet<number> => {
  const cmap = font.tables.get("cmap")
  if (cmap === undefined) throw new Error("no cmap table")
  const result = new Set<number>()
  const subtables = cmap.readUInt16BE(2)
  for (let i = 0; i < subtables; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8)
    const encoding = cmap.readUInt16BE(6 + i * 8)
    const isUnicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!isUnicode) continue
    const at = cmap.readUInt32BE(8 + i * 8)
    const format = cmap.readUInt16BE(at)
    if (format === 4) {
      const segments = cmap.readUInt16BE(at + 6) / 2
      const ends = at + 14
      const starts = ends + segments * 2 + 2
      const deltas = starts + segments * 2
      const rangeOffsets = deltas + segments * 2
      for (let s = 0; s < segments; s++) {
        const end = cmap.readUInt16BE(ends + s * 2)
        const start = cmap.readUInt16BE(starts + s * 2)
        const delta = cmap.readUInt16BE(deltas + s * 2)
        const rangeOffset = cmap.readUInt16BE(rangeOffsets + s * 2)
        for (let code = start; code <= end && code < 0xffff; code++) {
          const glyph = rangeOffset === 0
            ? (code + delta) & 0xffff
            : (() => {
                const raw = cmap.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (code - start) * 2)
                return raw === 0 ? 0 : (raw + delta) & 0xffff
              })()
          if (glyph !== 0) result.add(code)
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(at + 12)
      for (let g = 0; g < groups; g++) {
        const start = cmap.readUInt32BE(at + 16 + g * 12)
        const end = cmap.readUInt32BE(at + 20 + g * 12)
        const glyph = cmap.readUInt32BE(at + 24 + g * 12)
        for (let code = start; code <= end; code++) if (glyph + (code - start) !== 0) result.add(code)
      }
    }
  }
  return result
}

export type NameRecord = Readonly<{ platform: number; encoding: number; language: number; id: number; value: string }>

const decode = (record: { platform: number; bytes: Buffer }): string =>
  record.platform === 3 || record.platform === 0 ? Buffer.from(record.bytes).swap16().toString("utf16le") : record.bytes.toString("latin1")

export const names = (font: Woff2): ReadonlyArray<NameRecord> => {
  const table = font.tables.get("name")
  if (table === undefined) throw new Error("no name table")
  const count = table.readUInt16BE(2)
  const storage = table.readUInt16BE(4)
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 12
    const platform = table.readUInt16BE(at)
    const length = table.readUInt16BE(at + 8)
    const offset = table.readUInt16BE(at + 10)
    return {
      platform,
      encoding: table.readUInt16BE(at + 2),
      language: table.readUInt16BE(at + 4),
      id: table.readUInt16BE(at + 6),
      value: decode({ platform, bytes: table.subarray(storage + offset, storage + offset + length) }),
    }
  })
}

const encode = (record: NameRecord): Buffer =>
  record.platform === 3 || record.platform === 0 ? Buffer.from(record.value, "utf16le").swap16() : Buffer.from(record.value, "latin1")

export const buildNameTable = (records: ReadonlyArray<NameRecord>): Buffer => {
  const sorted = [...records].sort((a, b) => a.platform - b.platform || a.encoding - b.encoding || a.language - b.language || a.id - b.id)
  const strings = sorted.map(encode)
  const head = Buffer.alloc(6 + sorted.length * 12)
  head.writeUInt16BE(0, 0)
  head.writeUInt16BE(sorted.length, 2)
  head.writeUInt16BE(head.length, 4)
  let offset = 0
  sorted.forEach((record, i) => {
    const at = 6 + i * 12
    head.writeUInt16BE(record.platform, at)
    head.writeUInt16BE(record.encoding, at + 2)
    head.writeUInt16BE(record.language, at + 4)
    head.writeUInt16BE(record.id, at + 6)
    head.writeUInt16BE(strings[i].length, at + 8)
    head.writeUInt16BE(offset, at + 10)
    offset += strings[i].length
  })
  return Buffer.concat([head, ...strings])
}

/** Writes the font back with its name table replaced; every other table is carried over byte for byte. */
export const withNames = (font: Woff2, records: ReadonlyArray<NameRecord>): Buffer => {
  const nameTable = buildNameTable(records)
  const entries = font.entries.map((entry) => (entry.tag === "name" ? { ...entry, origLength: nameTable.length } : entry))
  const directory = Buffer.concat(
    entries.map((entry) =>
      Buffer.concat([
        Buffer.from([entry.flags]),
        entry.extraTag ?? Buffer.alloc(0),
        writeBase128(entry.origLength),
        entry.transformLength === null ? Buffer.alloc(0) : writeBase128(entry.transformLength),
      ]),
    ),
  )
  const stream = Buffer.concat(font.entries.map((entry) => (entry.tag === "name" ? nameTable : font.tables.get(entry.tag) ?? Buffer.alloc(0))))
  const compressed = brotliCompressSync(stream, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: stream.length } })
  const padded = Buffer.concat([compressed, Buffer.alloc((4 - (compressed.length % 4)) % 4)])
  const header = Buffer.from(font.header)
  // totalSfntSize is advisory: recompute it from the change in the name table's size.
  const oldName = font.tables.get("name")?.length ?? 0
  header.writeUInt32BE(font.header.readUInt32BE(16) + (((nameTable.length + 3) & ~3) - ((oldName + 3) & ~3)), 16)
  header.writeUInt32BE(compressed.length, 20)
  const total = 48 + directory.length + padded.length
  header.writeUInt32BE(total, 8)
  return Buffer.concat([header, directory, padded])
}
