// Store index normalisation and fallback.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { loadStore, normalizeIndex, storePath } from '../lib/store.js'

test('normalizeIndex drops entries without an id and de-duplicates', () => {
  const idx = normalizeIndex({
    goapps: [
      { id: 'a', name: 'A', version: '1.0.0', kind: 'web', summary: 's' },
      { id: 'a', name: 'A2' },
      { name: 'no id' },
      null,
    ],
  })
  assert.equal(idx.goapps.length, 1)
  assert.equal(idx.goapps[0].kind, 'web')
  assert.equal(idx.goapps[0].summary, 's')
  assert.equal(idx.goapps[0].package, '')
})

test('the bundled index names the goapp id and the package that ships it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goapp-store-'))
  const bundled = loadStore({ DSH_HOME: dir })
  const demo = bundled.goapps.find((g) => g.id === 'word')
  assert.ok(demo, 'the demo goapp is indexed by its own id, not its package name')
  assert.equal(demo.package, 'goapp-demo-word')
})

test('a missing or broken override falls back to the bundled index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goapp-store-'))
  const env = { DSH_HOME: dir }

  const bundled = loadStore(env)
  assert.ok(bundled.goapps.some((g) => g.id === 'word'))

  fs.mkdirSync(path.dirname(storePath(env)), { recursive: true })
  fs.writeFileSync(storePath(env), 'not json')
  assert.ok(loadStore(env).goapps.some((g) => g.id === 'word'))

  fs.writeFileSync(storePath(env), JSON.stringify({ goapps: [{ id: 'mine', name: 'Mine' }] }))
  const mine = loadStore(env)
  assert.deepEqual(mine.goapps.map((g) => g.id), ['mine'])
})
