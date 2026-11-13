// Publish a goapp: turn a package directory into the `.tar.gz` the store
// downloads, and print the index entry that points at it.
//
// Byte-stable on purpose. The store trusts `sha256`, so an archive that differs
// between two machines would force a new hash (and a new index commit) for
// identical sources. Everything that is not source is pinned here: entries are
// sorted by path, every mtime is fixed, modes are 0644, uid/gid are 0, and the
// gzip header carries no timestamp. Same directory in, same bytes out.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

/** The manager refuses downloads above this; packing must not produce one. */
export const MAX_BYTES = 32 * 1024 * 1024

/** Warn (loudly) once a package gets heavy for something that is UI code. */
const WARN_BYTES = 4 * 1024 * 1024

const SKIP_DIRS = new Set(['node_modules', '.git'])
const SKIP_FILES = new Set(['.DS_Store'])

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`
}

function tarHeader(name, size) {
  if (name.length > 100) {
    const cut = name.lastIndexOf('/', 155)
    const prefix = cut === -1 ? '' : name.slice(0, cut)
    const rest = cut === -1 ? name : name.slice(cut + 1)
    if (prefix === '' || rest.length > 100 || prefix.length > 155) {
      throw new Error(`path too long for ustar: ${name}`)
    }
    const header = Buffer.alloc(512)
    header.write(rest, 0, 100, 'utf8')
    header.write(prefix, 345, 155, 'utf8')
    writeStandard(header, size)
    return header
  }
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  writeStandard(header, size)
  return header
}

function writeStandard(header, size) {
  header.write(octal(0o644, 8), 100, 'ascii')
  header.write(octal(0, 8), 108, 'ascii')
  header.write(octal(0, 8), 116, 'ascii')
  header.write(octal(size, 12), 124, 'ascii')
  header.write(octal(0, 12), 136, 'ascii')
  header.write(' '.repeat(8), 148, 'ascii')
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
}

/** Every regular file under `dir`, as sorted `/`-separated relative paths. */
export function listFiles(dir, base = '') {
  const out = []
  const entries = fs.readdirSync(path.join(dir, base), { withFileTypes: true })
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const rel = base === '' ? entry.name : `${base}/${entry.name}`
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...listFiles(dir, rel))
      continue
    }
    if (!entry.isFile()) continue
    if (SKIP_FILES.has(entry.name)) continue
    out.push(rel)
  }
  return out.sort()
}

/**
 * Build the package bytes for `dir`.
 * Returns `{ buffer, files, manifest }` where `manifest` is the parsed package.json.
 */
export function packDirectory(dir) {
  const manifestPath = path.join(dir, 'package.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`no package.json in ${dir}`)
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`package.json is not valid JSON: ${error.message}`)
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw new Error('package.json needs a name')
  }
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(manifest.version ?? ''))) {
    throw new Error(`package.json version must be x.y.z[-pre], got ${JSON.stringify(manifest.version)}`)
  }
  const marker = manifest.dshGoGoapp
  if (marker === null || typeof marker !== 'object' || typeof marker.id !== 'string' || marker.id.trim() === '') {
    throw new Error('package.json needs dshGoGoapp.id — the store cannot list a goapp without one')
  }

  const files = listFiles(dir)
  if (!files.includes('package.json')) throw new Error('package.json must sit at the archive root')

  const blocks = []
  for (const rel of files) {
    const data = fs.readFileSync(path.join(dir, rel))
    blocks.push(tarHeader(rel, data.length), data)
    const pad = (512 - (data.length % 512)) % 512
    if (pad > 0) blocks.push(Buffer.alloc(pad))
  }
  blocks.push(Buffer.alloc(1024))
  const tar = Buffer.concat(blocks)
  const buffer = zlib.gzipSync(tar, { level: 9 })
  return { buffer, files, manifest }
}

/** The store-index entry for a packed goapp. `url` is null without a base URL. */
export function indexEntry({ manifest, buffer, baseUrl, file }) {
  const marker = manifest.dshGoGoapp
  const title = manifest.dshGo?.title
  const name =
    typeof title === 'string'
      ? title
      : (title !== null && typeof title === 'object' && (title.zh ?? title.en)) || manifest.name
  const entry = {
    id: marker.id,
    name,
    version: String(manifest.version),
    package: manifest.name,
    kind: typeof marker.kind === 'string' ? marker.kind : 'native',
    summary: marker.summary ?? manifest.description ?? '',
    url: baseUrl ? `${baseUrl.replace(/\/$/, '')}/${file}` : null,
    sha256: sha256(buffer),
  }
  return entry
}

export function artifactName(manifest) {
  return `${manifest.name}-${manifest.version}.tar.gz`
}

function main(argv) {
  const args = argv.slice(2)
  const dir = args.find((arg) => !arg.startsWith('--'))
  const flag = (name) => {
    const index = args.indexOf(`--${name}`)
    return index === -1 ? null : args[index + 1] ?? ''
  }
  if (!dir) {
    console.error('usage: pack.mjs <goappDir> [--out <dir>] [--base-url <url>] [--check <sha256>] [--json]')
    process.exit(2)
  }

  const { buffer, files, manifest } = packDirectory(path.resolve(dir))
  const file = artifactName(manifest)
  const outDir = path.resolve(flag('out') ?? path.join(path.resolve(dir), '..', 'store'))
  const outPath = path.join(outDir, file)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, buffer)

  const entry = indexEntry({ manifest, buffer, baseUrl: flag('base-url'), file })
  const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2)
  console.log(`packed ${manifest.name}@${manifest.version}`)
  console.log(`  file    ${outPath}`)
  console.log(`  files   ${files.length} (package.json at the root)`)
  console.log(`  size    ${buffer.length} B (${sizeMb} MiB)`)
  console.log(`  sha256  ${entry.sha256}`)

  if (buffer.length > MAX_BYTES) {
    console.error(`refusing: ${buffer.length} B exceeds the ${MAX_BYTES} B install cap — the store would reject this drop`)
    process.exit(1)
  }
  if (buffer.length > WARN_BYTES) {
    console.warn(`warning: ${sizeMb} MiB is heavy for UI code; the download lands on the phone's storage`)
  }

  const expected = flag('check')
  if (expected !== null) {
    if (expected.toLowerCase() !== entry.sha256) {
      console.error(`check failed: index says ${expected}, the sources hash to ${entry.sha256}`)
      process.exit(1)
    }
    console.log('  check   sha256 matches the index')
  }
  if (args.includes('--json')) console.log(JSON.stringify(entry, null, 2))
  return entry
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv)
}
