// goapp manager: the store-side half of goapp. A goapp is a plugin with its own
// `dshGo` manifest; this plugin owns the registry that lists them, flips their
// enabled flag, removes them (and the sessions they opened) and opens them.
//
// Host half only: the manifest declares the panel, this file feeds it. Without
// the dsh-go bridge the `ctx.inject(['dshGo'], …)` callback never runs and the
// registry still answers over `ctx.dshGo`-less calls to `apply` (tests).
import { load, noteSession, remove as removeEntry, save, setEnabled, upsert } from './registry.js'
import { scanInbox } from './import.js'
import { loadStore } from './store.js'
import { goappData, goappView, words } from './view.js'

export const name = 'dsh-go-goapp'

/**
 * @param {any} ctx
 * @param {{ env?: Record<string, string | undefined> }} [options] for tests
 */
export function apply(ctx, options = {}) {
  const env = options.env ?? process.env
  const read = () => load(env)
  const write = (next) => {
    save(next, env)
    return next
  }

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
          const id = idOf(event)
          if (id === '') return [{ type: 'toast', text: words(event?.locale).removed }]
          const registry = read()
          const current = registry.goapps.find((g) => g.id === id)
          if (current === undefined) return [{ type: 'toast', text: `${id} — not installed` }]
          write(setEnabled(registry, id, !current.enabled))
          return [{ type: 'refresh' }]
        },

        /** Remove a goapp and forget the sessions it opened. */
        remove: (scope, event) => {
          const id = idOf(event)
          if (id === '') return []
          const { next, gone } = removeEntry(read(), id)
          if (gone === undefined) return []
          write(next)
          return [
            { type: 'toast', text: `${words(event?.locale).removed} ${gone.name} (${gone.sessions.length})` },
            { type: 'refresh' },
          ]
        },

        /** Open a goapp: the full-screen host is the app's job, so say so until it exists. */
        open: (scope, event) => {
          const w = words(event?.locale)
          const id = idOf(event)
          if (id === '') return []
          return [
            { type: 'toast', text: `${w.opening}: ${id}` },
            { type: 'callout', text: w.openingBody },
          ]
        },

        refresh: () => [{ type: 'refresh' }],

        /** Install a store entry that is already unpacked in the inbox. */
        install: (scope, event) => {
          const w = words(event?.locale)
          const id = idOf(event)
          if (id === '') return []
          const local = scanInbox(env).find((entry) => entry.id === id)
          if (local === undefined) return [{ type: 'toast', text: `${w.notDownloaded}: ${id}` }]
          write(upsert(read(), local))
          return [
            { type: 'toast', text: `${w.installed_one} ${local.name}` },
            { type: 'refresh' },
          ]
        },

        /** Register every goapp package dropped into $DSH_HOME/goapps/inbox. */
        import: (scope, event) => {
          const found = scanInbox(env)
          if (found.length === 0) return [{ type: 'toast', text: `${words(event?.locale).imported} 0` }]
          let registry = read()
          for (const entry of found) registry = upsert(registry, entry)
          write(registry)
          return [
            { type: 'toast', text: `${words(event?.locale).imported} ${found.length}` },
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
