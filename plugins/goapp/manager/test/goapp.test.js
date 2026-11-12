// Registry and import behaviour, no bridge needed: pure functions plus a temp dir.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { empty, load, noteSession, parse, registryPath, remove, save, setEnabled, upsert } from '../lib/registry.js'
import { inboxPath, readPackage, scanInbox } from '../lib/import.js'

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goapp-'))
  return { DSH_HOME: dir, dir }
}

test('parse keeps well-formed entries and drops the rest', () => {
  const reg = parse(
    JSON.stringify({
      version: 1,
      goapps: [
        { id: 'a', name: 'A', version: '1.0.0', kind: 'native', enabled: false, sessions: ['s1', 2] },
        { name: 'no id' },
        null,
      ],
    }),
  )
  assert.equal(reg.goapps.length, 1)
  assert.deepEqual(reg.goapps[0].sessions, ['s1'])
  assert.equal(reg.goapps[0].enabled, false)
})

test('parse of garbage is an empty registry, not a throw', () => {
  assert.deepEqual(parse('not json'), empty())
  assert.deepEqual(parse('{"goapps":{}}'), empty())
})

test('save then load round-trips through $DSH_HOME', () => {
  const env = tempEnv()
  assert.equal(registryPath(env), path.join(env.dir, 'goapps', 'registry.json'))
  const reg = upsert(empty(), { id: 'w', name: '词', version: '0.1.0', kind: 'native', enabled: true, installedAt: 1, sessions: [] })
  save(reg, env)
  const back = load(env)
  assert.equal(back.goapps.length, 1)
  assert.equal(back.goapps[0].id, 'w')
  assert.equal(fs.existsSync(`${registryPath(env)}.tmp`), false)
})

test('upsert replaces by id and puts the newest first', () => {
  let reg = upsert(empty(), { id: 'a', name: 'A', version: '1', kind: 'native', enabled: true, installedAt: 1, sessions: [] })
  reg = upsert(reg, { id: 'b', name: 'B', version: '1', kind: 'native', enabled: true, installedAt: 2, sessions: [] })
  reg = upsert(reg, { id: 'a', name: 'A2', version: '2', kind: 'native', enabled: true, installedAt: 3, sessions: [] })
  assert.deepEqual(reg.goapps.map((g) => g.id), ['a', 'b'])
  assert.equal(reg.goapps[0].name, 'A2')
})

test('remove returns the entry it dropped', () => {
  const reg = upsert(empty(), { id: 'a', name: 'A', version: '1', kind: 'native', enabled: true, installedAt: 1, sessions: ['s'] })
  const { next, gone } = remove(reg, 'a')
  assert.equal(next.goapps.length, 0)
  assert.deepEqual(gone.sessions, ['s'])
})

test('setEnabled only touches the named entry', () => {
  let reg = upsert(empty(), { id: 'a', name: 'A', version: '1', kind: 'native', enabled: true, installedAt: 1, sessions: [] })
  reg = upsert(reg, { id: 'b', name: 'B', version: '1', kind: 'native', enabled: true, installedAt: 1, sessions: [] })
  reg = setEnabled(reg, 'a', false)
  assert.equal(reg.goapps.find((g) => g.id === 'a').enabled, false)
  assert.equal(reg.goapps.find((g) => g.id === 'b').enabled, true)
})

test('noteSession de-duplicates', () => {
  let reg = upsert(empty(), { id: 'a', name: 'A', version: '1', kind: 'native', enabled: true, installedAt: 1, sessions: [] })
  reg = noteSession(reg, 'a', 's1')
  reg = noteSession(reg, 'a', 's1')
  assert.deepEqual(reg.goapps[0].sessions, ['s1'])
})

test('readPackage needs dshGo.goapp.id', () => {
  const env = tempEnv()
  const dir = path.join(env.dir, 'pkg')
  fs.mkdirSync(dir)
  const write = (pkg) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))

  write({ name: 'plain', dshGo: { v: 1 } })
  assert.equal(readPackage(dir), null)

  write({ name: 'no-id', dshGo: { goapp: true } })
  assert.equal(readPackage(dir), null)

  write({ name: 'ok', version: '2.0.0', dshGo: { title: { zh: '词' }, goapp: { id: 'w', kind: 'web', entry: 'web/index.html' } } })
  const entry = readPackage(dir, 42)
  assert.equal(entry.id, 'w')
  assert.equal(entry.name, '词')
  assert.equal(entry.kind, 'web')
  assert.equal(entry.entry, 'web/index.html')
  assert.equal(entry.installedAt, 42)
})

test('scanInbox skips files and non-goapp folders', () => {
  const env = tempEnv()
  const inbox = inboxPath(env)
  fs.mkdirSync(path.join(inbox, 'one'), { recursive: true })
  fs.writeFileSync(path.join(inbox, 'one', 'package.json'), JSON.stringify({ dshGo: { goapp: { id: 'one' } } }))
  fs.mkdirSync(path.join(inbox, 'two'))
  fs.writeFileSync(path.join(inbox, 'loose.json'), '{}')
  const found = scanInbox(env, 7)
  assert.deepEqual(found.map((f) => f.id), ['one'])
})
