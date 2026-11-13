// goapp manager: the store-side half of goapp. A goapp is a plugin with its own
// `dshGo` manifest; this plugin owns the registry that lists them, flips their
// enabled flag, removes them (and the sessions they opened) and opens them.
//
// Host half only: the manifest declares the panel, this file feeds it. Without
// the dsh-go bridge the `ctx.inject(['dshGo'], …)` callback never runs and the
// registry still answers over `ctx.dshGo`-less calls to `apply` (tests).
import { load, noteSession, remove as removeEntry, save, setEnabled, upsert } from './registry.js'
import { download, removeUnpacked } from './download.js'
import { scanInbox, scanInboxDetailed, inboxFoldersFor } from './import.js'
import { loadStore, versionNewer } from './store.js'
import { goappData, goappView, words } from './view.js'

export const name = 'dsh-go-goapp'

/**
 * `<package>/<panel id>` for a goapp that declares a native panel, else `null`.
 * The app resolves that form through its plugin registry, so one plugin can open
 * another plugin's panel; a bare id would only be looked up in this plugin.
 */
function panelRef(entry) {
  if (entry === undefined || entry.kind !== 'native') return null
  const declared = typeof entry.entry === 'string' ? entry.entry : ''
  const panelId = declared.startsWith('panel:') ? declared.slice(6) : ''
  const host = typeof entry.package === 'string' ? entry.package : ''
  return panelId === '' || host === '' ? null : `${host}/${panelId}`
}

/**
 * Before `next` takes an id, drop the files of a *different* package that holds
 * it. Ids are plain words (`word`), so two authors can pick the same one; the
 * losing package keeps nothing the user can reach, and leaving its folder in the
 * inbox would let 导入 bring it back. Same package (or unknown on either side)
 * is an update, not a displacement.
 */
function dropDisplaced(env, registry, next) {
  const previous = registry.goapps.find((g) => g.id === next.id)
  if (previous === undefined) return
  if (previous.package === '' || next.package === '') return
  if (previous.package === next.package) return
  removeUnpacked(env, previous.package, previous.folder)
}

/**
 * @param {any} ctx
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch }} [options] for tests
 */
export function apply(ctx, options = {}) {
  const env = options.env ?? process.env
  const read = () => load(env)
  const write = (next) => {
    save(next, env)
    return next
  }
  /**
   * Save, and report a refusal instead of throwing into the host. A registry
   * that cannot be written (read-only home, full disk, ENOTDIR because
   * `goapps` is a file) must come back as a stable reason the user can read:
   * AGENTS.md asks for a stable error and no silent swallow, and an exception
   * here would surface as an unexplained panel failure.
   * @returns {null | string} the error code, or null when the write landed
   */
  const tryWrite = (next) => {
    try {
      save(next, env)
      return null
    } catch (error) {
      return typeof error?.code === 'string' && error.code !== '' ? error.code : 'ERROR'
    }
  }
  /** The one toast an action returns when nothing could be saved. */
  const failed = (code, w, detail = '') => [
    { type: 'toast', text: `${w.writeFailed}: ${code}${detail === '' ? '' : ` — ${detail}`}` },
    { type: 'refresh' },
  ]

  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.panel('goapps', {
      view: (scope, caps) => goappView(scope, caps),
      data: (scope, emit) => {
        emit(goappData(read(), loadStore(env)))
        return () => {}
      },
      actions: {
        /** Flip one goapp's enabled flag. */
        toggle: (scope, event) => {
          const w = words(event?.locale)
          const id = idOf(event)
          if (id === '') return [{ type: 'toast', text: w.removed }]
          const registry = read()
          const current = registry.goapps.find((g) => g.id === id)
          if (current === undefined) return [{ type: 'toast', text: `${w.notInstalled}: ${id}` }]
          const code = tryWrite(setEnabled(registry, id, !current.enabled))
          if (code !== null) return failed(code, w, current.name)
          return [{ type: 'refresh' }]
        },

        /** Remove a goapp, the folders it lives in, and the sessions it opened. */
        remove: (scope, event) => {
          const w = words(event?.locale)
          const id = idOf(event)
          if (id === '') return []
          const { next, gone } = removeEntry(read(), id)
          if (gone === undefined) return []
          // The files go only after the registry forgot the goapp: a failed save
          // that deleted them first would leave a listing whose package is gone.
          const code = tryWrite(next)
          if (code !== null) return failed(code, w, gone.name)
          for (const folder of inboxFoldersFor(gone, env)) removeUnpacked(env, gone.package ?? gone.id, folder)
          return [
            { type: 'toast', text: `${w.removed} ${gone.name} (${gone.sessions.length})` },
            { type: 'refresh' },
          ]
        },

        /** Open a goapp full screen; a package without a native panel still says so. */
        open: (scope, event) => {
          const w = words(event?.locale)
          const id = idOf(event)
          if (id === '') return []
          const current = read().goapps.find((g) => g.id === id)
          if (current === undefined) return [{ type: 'toast', text: `${w.notInstalled}: ${id}` }]
          if (current.enabled === false) {
            return [{ type: 'toast', text: `${w.disabled}: ${current.name}` }]
          }
          const target = panelRef(current)
          if (target === null) {
            return [
              { type: 'toast', text: `${w.opening}: ${id}` },
              { type: 'callout', text: w.openingBody },
            ]
          }
          return [
            { type: 'toast', text: `${w.opening}: ${id}` },
            { type: 'open', panel: target },
          ]
        },

        refresh: () => [{ type: 'refresh' }],

        /**
         * Install one store entry: register it from the inbox, or — when the
         * listing carries `url` + `sha256` — download and unpack it first. The
         * same action updates: a store version newer than the unpacked one is
         * downloaded over it, so the store button is not a no-op after the
         * first install. A failed download keeps the installed copy.
         */
        install: async (scope, event) => {
          const w = words(event?.locale)
          const id = idOf(event)
          if (id === '') return []
          const listing = loadStore(env).goapps.find((entry) => entry.id === id)
          const scan = () => scanInbox(env).find((entry) => entry.id === id)
          let local = scan()
          const replacing = local !== undefined
          const remote = listing !== undefined && typeof listing.url === 'string' && listing.url !== ''
          if (remote && (local === undefined || versionNewer(listing.version, local.version))) {
            const got = await download(listing, env, { fetchImpl: options.fetch })
            if (!got.ok) {
              const why = got.reason === 'no-url' ? w.notDownloaded : `${w.downloadFailed}: ${got.reason}`
              return local === undefined
                ? [{ type: 'toast', text: `${why} (${id})` }, { type: 'refresh' }]
                : [{ type: 'toast', text: `${why} (${id}) — ${w.installed_one} ${local.name}` }]
            }
            local = scan()
          }
          if (local === undefined) {
            // Nothing landed: a listing without a url cannot install by itself,
            // and an id the store does not know changed nothing at all.
            return listing === undefined
              ? [{ type: 'toast', text: `${w.notDownloaded}: ${id}` }]
              : [{ type: 'toast', text: `${w.notDownloaded}: ${id}` }, { type: 'refresh' }]
          }
          // A different package can claim the same id (ids are plain words, not
          // qualified names). Then nothing of the user's carries over, and the
          // files of the package that lost the id are removed instead of being
          // left in the inbox for 导入 to resurrect.
          dropDisplaced(env, read(), local)
          // The bytes are already in the inbox at this point, so a refused save
          // costs the registry entry, not the download: 导入 picks it up later.
          const code = tryWrite(upsert(read(), local))
          if (code !== null) return failed(code, w, local.name)
          return [
            { type: 'toast', text: `${replacing ? w.updated_one : w.installed_one} ${local.name}` },
            { type: 'refresh' },
          ]
        },

        /**
         * Register every goapp package dropped into $DSH_HOME/goapps/inbox.
         * Folders holding the same package are one goapp: the newest folder is
         * registered and the rest are reported as ignored, not deleted.
         */
        import: (scope, event) => {
          const w = words(event?.locale)
          const { entries: found, duplicates } = scanInboxDetailed(env)
          if (found.length === 0) {
            return [{ type: 'toast', text: `${w.imported} 0${duplicates === 0 ? '' : ` (${w.duplicates} ${duplicates})`}` }]
          }
          let registry = read()
          for (const entry of found) {
            dropDisplaced(env, registry, entry)
            registry = upsert(registry, entry)
          }
          const code = tryWrite(registry)
          if (code !== null) return failed(code, w)
          return [
            {
              type: 'toast',
              text: `${w.imported} ${found.length}${duplicates === 0 ? '' : ` (${w.duplicates} ${duplicates})`}`,
            },
            { type: 'refresh' },
          ]
        },
      },
    })
  })

  return { read, write, upsert: (entry) => write(upsert(read(), entry)), noteSession: (id, sessionId) => write(noteSession(read(), id, sessionId)) }
}

/** The goapp id a tap carries: `{ id }` in action args, or a bare string. */
function idOf(event) {
  const args = event?.args ?? event
  if (typeof args === 'string') return args
  if (args !== null && typeof args === 'object' && typeof args.id === 'string') return args.id
  return ''
}
