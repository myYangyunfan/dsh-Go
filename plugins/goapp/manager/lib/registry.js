// The goapp registry: one JSON file next to the DSH home, so a goapp survives
// engine restarts and the manager can list it before anything is loaded.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const VERSION = 1

/** `$DSH_HOME`, else `~/.dsh` — the same root the engine uses for its state. */
export function home(env = process.env) {
  const explicit = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME.trim() : ''
  return explicit !== '' ? explicit : path.join(os.homedir(), '.dsh')
}

export function registryPath(env = process.env) {
  return path.join(home(env), 'goapps', 'registry.json')
}

/** A fresh, empty registry. */
export function empty() {
  return { version: VERSION, goapps: [] }
}

/** Parse a registry file's text; anything unreadable or unexpected becomes empty. */
export function parse(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return empty()
  }
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.goapps)) return empty()
  const goapps = raw.goapps
    .filter((g) => g !== null && typeof g === 'object' && typeof g.id === 'string' && g.id !== '')
    .map((g) => ({
      id: g.id,
      name: typeof g.name === 'string' && g.name !== '' ? g.name : g.id,
      version: typeof g.version === 'string' ? g.version : '0.0.0',
      package: typeof g.package === 'string' ? g.package : '',
      entry: typeof g.entry === 'string' ? g.entry : '',
      kind: g.kind === 'web' ? 'web' : 'native',
      enabled: g.enabled !== false,
      installedAt: typeof g.installedAt === 'number' ? g.installedAt : 0,
      sessions: Array.isArray(g.sessions) ? g.sessions.filter((s) => typeof s === 'string') : [],
    }))
  return { version: VERSION, goapps }
}

export function load(env = process.env) {
  try {
    return parse(fs.readFileSync(registryPath(env), 'utf8'))
  } catch {
    return empty()
  }
}

/** Write through a temp file so a kill mid-write cannot truncate the registry. */
export function save(registry, env = process.env) {
  const file = registryPath(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ version: VERSION, goapps: registry.goapps }, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

/**
 * Insert or replace by id, newest first. An update keeps the two fields that
 * belong to the user rather than to the package: `enabled` (installing a new
 * version must not silently turn a goapp back on) and `sessions` (the removal
 * IOU list, which the store download cannot know).
 */
export function upsert(registry, entry) {
  const previous = registry.goapps.find((g) => g.id === entry.id)
  const rest = registry.goapps.filter((g) => g.id !== entry.id)
  const merged =
    previous === undefined
      ? entry
      : { ...entry, enabled: previous.enabled, sessions: previous.sessions }
  return { ...registry, goapps: [merged, ...rest] }
}

export function remove(registry, id) {
  const gone = registry.goapps.find((g) => g.id === id)
  return { next: { ...registry, goapps: registry.goapps.filter((g) => g.id !== id) }, gone }
}

export function setEnabled(registry, id, enabled) {
  return {
    ...registry,
    goapps: registry.goapps.map((g) => (g.id === id ? { ...g, enabled } : g)),
  }
}

/** Remember the session ids a goapp opened, so removing it can clean them up. */
export function noteSession(registry, id, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return registry
  return {
    ...registry,
    goapps: registry.goapps.map((g) =>
      g.id === id && !g.sessions.includes(sessionId) ? { ...g, sessions: [...g.sessions, sessionId] } : g,
    ),
  }
}
