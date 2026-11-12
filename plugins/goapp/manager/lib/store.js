// The goapp store index. First version: a bundled list, plus an optional
// override at `$DSH_HOME/goapps/store/index.json` so a machine can point at its
// own market without a rebuild. An entry may carry `url` + `sha256`; `download.js`
// fetches and unpacks it, otherwise `install` only registers what the inbox has.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { home } from './registry.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** `$DSH_HOME/goapps/store/index.json`, when the machine has one. */
export function storePath(env = process.env) {
  return path.join(home(env), 'goapps', 'store', 'index.json')
}

/** The index shipped inside this plugin. */
export function bundledPath() {
  return path.join(HERE, '..', 'data', 'index.json')
}

/** Coerce one index entry; an entry without an id is dropped. */
function entry(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') return null
  return {
    id,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : id,
    version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    // The npm package that ships the goapp. `id` is the goapp's own id (what the
    // registry and the inbox agree on), so the store needs both to say which
    // package to look for and to open it by `<package>/<panel>`.
    package: typeof raw.package === 'string' ? raw.package : '',
    kind: raw.kind === 'web' ? 'web' : 'native',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    // Optional download: `url` points at a `.tar.gz`, `sha256` pins its bytes.
    // Both are kept as given; `download.js` decides whether they are usable.
    url: typeof raw.url === 'string' ? raw.url.trim() : '',
    sha256: typeof raw.sha256 === 'string' ? raw.sha256.trim() : '',
  }
}

/** Normalize a whole index document; anything unreadable becomes an empty list. */
export function normalizeIndex(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.goapps) ? raw.goapps : []
  const seen = new Set()
  const out = []
  for (const item of list) {
    const e = entry(item)
    if (e === null || seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return { version: 1, goapps: out }
}

/**
 * The index the store page shows: the machine's own file when it exists, else
 * the bundled one. A broken file falls back to the bundled list rather than
 * showing an empty store.
 */
export function loadStore(env = process.env) {
  try {
    return normalizeIndex(JSON.parse(fs.readFileSync(storePath(env), 'utf8')))
  } catch {
    try {
      return normalizeIndex(JSON.parse(fs.readFileSync(bundledPath(), 'utf8')))
    } catch {
      return { version: 1, goapps: [] }
    }
  }
}
