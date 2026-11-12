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
    enabled: true,
    installedAt: now,
    sessions: [],
  }
}

/**
 * Every goapp package waiting in the inbox, newest folder first. Unreadable
 * folders are skipped rather than failing the whole import.
 */
export function scanInbox(env = process.env, now = Date.now()) {
  const inbox = inboxPath(env)
  let names
  try {
    names = fs.readdirSync(inbox, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of names) {
    if (!e.isDirectory()) continue
    const entry = readPackage(path.join(inbox, e.name), now)
    if (entry !== null) out.push(entry)
  }
  return out
}
