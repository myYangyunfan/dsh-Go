// Import a goapp from a local folder. The folder is a normal plugin package; the
// only thing that makes it a goapp is `dshGo.goapp` in its package.json.
import fs from 'node:fs'
import path from 'node:path'
import { home } from './registry.js'

/** Where dropped packages are looked for: `$DSH_HOME/goapps/inbox`. */
export function inboxPath(env = process.env) {
  return path.join(home(env), 'goapps', 'inbox')
}

/**
 * Read one package folder into a registry entry, or `null` when it is not a goapp.
 * The marker is `dshGoGoapp` at the top level of package.json, NOT a key inside
 * `dshGo`: the bridge ignores unknown `dshGo` keys but reports each one as a
 * warning, so a goapp declaring itself there would carry a permanent warning.
 * `dshGo.goapp` is still read first for packages that were imported before the
 * marker moved. Accepts an object only; a bare `true`/string is rejected on
 * purpose — an id has to be stated, not guessed from the folder name.
 */
export function readPackage(dir, now = Date.now()) {
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const goapp = pkg?.dshGoGoapp ?? pkg?.dshGo?.goapp
  if (goapp === null || typeof goapp !== 'object') return null
  const id = typeof goapp.id === 'string' ? goapp.id.trim() : ''
  if (id === '') return null
  const title = pkg?.dshGo?.title
  const name = typeof title === 'string'
    ? title
    : typeof title?.zh === 'string' && title.zh !== ''
      ? title.zh
      : typeof pkg.name === 'string'
        ? pkg.name
        : id
  return {
    id,
    name,
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    package: typeof pkg.name === 'string' ? pkg.name : '',
    kind: goapp.kind === 'web' ? 'web' : 'native',
    entry: typeof goapp.entry === 'string' ? goapp.entry : '',
    dir,
    // The folder name, not the package name: a package dropped in by hand keeps
    // whatever folder the user unzipped it into, and removal has to delete that
    // exact folder or the files stay behind and 导入 resurrects the goapp.
    folder: path.basename(dir),
    enabled: true,
    installedAt: now,
    sessions: [],
  }
}

/** The identity two inbox folders share: the package name, else the goapp id. */
function keyOf(entry) {
  return entry.package !== '' ? entry.package : entry.id
}

/** Folder mtime, or 0 when it cannot be read. */
function mtimeOf(dir) {
  try {
    return fs.statSync(dir).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Every goapp package waiting in the inbox, with folders carrying the same
 * package folded onto one entry, newest folder first.
 *
 * The same package can sit in the inbox twice — a store download under its
 * package name plus a hand-unzipped copy, or two unzips of the same archive.
 * Without folding, `scanInbox(...).find(id)` picks whichever folder the
 * filesystem lists first, so install/import flip between two copies and a
 * removal deletes only one of them, leaving the other for 导入 to resurrect.
 *
 * OLDEST WINS NOTHING: the newest folder (mtime, then name) represents the
 * package. Losers are counted, not deleted — they may be a build the user
 * unpacked by hand, and deleting files the user put there is not this
 * function's call. `remove` deletes every folder of the package afterwards, so
 * nothing survives to come back.
 *
 * @returns {{ entries: any[], duplicates: number }} `duplicates` counts the
 * folders that lost, so the import toast can say how many were ignored.
 */
export function scanInboxDetailed(env = process.env, now = Date.now()) {
  const inbox = inboxPath(env)
  let names
  try {
    names = fs.readdirSync(inbox, { withFileTypes: true })
  } catch {
    return { entries: [], duplicates: 0 }
  }
  const found = []
  for (const e of names) {
    if (!e.isDirectory()) continue
    const dir = path.join(inbox, e.name)
    const entry = readPackage(dir, now)
    if (entry !== null) found.push({ entry, at: mtimeOf(dir) })
  }
  // Deterministic before folding: newest first, then folder name, so a tie
  // resolves the same way on every platform and every scan.
  found.sort((a, b) => b.at - a.at || a.entry.folder.localeCompare(b.entry.folder))
  const byPackage = new Map()
  let duplicates = 0
  for (const { entry } of found) {
    const key = keyOf(entry)
    if (byPackage.has(key)) {
      duplicates += 1
      continue
    }
    byPackage.set(key, entry)
  }
  // Two different packages can still declare the same id (ids are plain words).
  // Keep the newest of those too, so `find(id)` is never ambiguous.
  const byId = new Map()
  for (const entry of byPackage.values()) {
    if (byId.has(entry.id)) {
      duplicates += 1
      continue
    }
    byId.set(entry.id, entry)
  }
  return { entries: [...byId.values()], duplicates }
}

/** Every goapp package waiting in the inbox, one entry per package. */
export function scanInbox(env = process.env, now = Date.now()) {
  return scanInboxDetailed(env, now).entries
}

/**
 * Every folder in the inbox that belongs to `entry`, its own included: the same
 * package, or a different package claiming the same goapp id. Deletion uses
 * this instead of the single recorded folder — a twin left behind is exactly
 * what makes a removed goapp come back on the next 导入, and an id is what the
 * registry (and the user) calls the goapp.
 */
export function inboxFoldersFor(entry, env = process.env) {
  const inbox = inboxPath(env)
  const key = keyOf(entry)
  const out = []
  let names
  try {
    names = fs.readdirSync(inbox, { withFileTypes: true })
  } catch {
    return entry.folder === '' ? out : [entry.folder]
  }
  for (const e of names) {
    if (!e.isDirectory()) continue
    const found = readPackage(path.join(inbox, e.name))
    if (found !== null && (found.id === entry.id || keyOf(found) === key)) out.push(e.name)
  }
  if (out.length === 0 && entry.folder !== '') out.push(entry.folder)
  return out
}
