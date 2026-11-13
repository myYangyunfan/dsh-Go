// Download path: a store listing with `url` + `sha256` unpacks into the inbox,
// and `install` registers the result. No network: the fetch is a stub.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import { download, folderFor, readTar, removeUnpacked, sha256, unpackTarGz } from '../lib/download.js'
import { inboxPath, scanInbox } from '../lib/import.js'
import { apply } from '../lib/index.js'
import { empty, load, save, upsert } from '../lib/registry.js'
import { loadStore, storePath } from '../lib/store.js'

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goapp-dl-'))
  return { DSH_HOME: dir, dir }
}

/** One ustar header; a goapp package is plain files, so no pax extensions. */
function header(name, size) {
  const block = Buffer.alloc(512)
  block.write(name.slice(0, 100), 0, 'utf8')
  block.write('0000644\0', 100)
  block.write('0000000\0', 108)
  block.write('0000000\0', 116)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  block.write('00000000000\0', 136)
  block.write('        ', 148)
  block.write('0', 156)
  block.write('ustar\0', 257)
  block.write('00', 263)
  return block
}

function tarGz(files) {
  const parts = []
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8')
    parts.push(header(name, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(parts))
}

const MANIFEST = JSON.stringify({
  name: 'goapp-demo-word',
  version: '0.1.0',
  dshGo: { title: '单词' },
  dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' },
})

const MANIFEST_V2 = JSON.stringify({
  name: 'goapp-demo-word',
  version: '0.2.0',
  dshGo: { title: '单词' },
  dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' },
})

function listing(payload, extra = {}) {
  return {
    id: 'word',
    name: '单词',
    version: '0.1.0',
    package: 'goapp-demo-word',
    kind: 'native',
    url: 'https://example.test/goapp-demo-word-0.1.0.tar.gz',
    sha256: sha256(payload),
    ...extra,
  }
}

/** Stub fetch: the body is the payload, the status is whatever the test wants. */
function stubFetch(payload, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: async () => payload,
  })
}

test('folderFor uses the package name, else the id, and never leaves the inbox', () => {
  assert.equal(folderFor({ id: 'w', package: 'goapp-demo-word' }), 'goapp-demo-word')
  assert.equal(folderFor({ id: 'w' }), 'w')
  assert.equal(folderFor({ id: '../../etc' }), 'etc')
  assert.equal(folderFor({}), 'goapp')
})

test('download refuses a listing without url', async () => {
  const got = await download({ id: 'word' }, tempEnv())
  assert.deepEqual(got, { ok: false, reason: 'no-url' })
})

test('download refuses a url without a checksum', async () => {
  const payload = tarGz({ 'package.json': MANIFEST })
  const got = await download({ id: 'word', url: 'https://example.test/x.tgz' }, tempEnv(), {
    fetchImpl: stubFetch(payload),
  })
  assert.deepEqual(got, { ok: false, reason: 'no-checksum' })
})

test('download rejects bytes that do not match the checksum', async () => {
  const payload = tarGz({ 'package.json': MANIFEST })
  const other = tarGz({ 'package.json': '{}' })
  const got = await download(listing(payload), tempEnv(), { fetchImpl: stubFetch(other) })
  assert.deepEqual(got, { ok: false, reason: 'checksum' })
  assert.equal(fs.existsSync(inboxPath(tempEnv())), false)
})

test('download rejects a non-2xx response', async () => {
  const payload = tarGz({ 'package.json': MANIFEST })
  const got = await download(listing(payload), tempEnv(), { fetchImpl: stubFetch(payload, 404) })
  assert.deepEqual(got, { ok: false, reason: 'http-404' })
})

test('download unpacks the package into the inbox', async () => {
  const env = tempEnv()
  const payload = tarGz({ 'package.json': MANIFEST, 'lib/view.js': 'export const view = 1' })
  const got = await download(listing(payload), env, { fetchImpl: stubFetch(payload) })
  assert.equal(got.ok, true)
  assert.equal(got.dir, path.join(inboxPath(env), 'goapp-demo-word'))
  const found = scanInbox(env)
  assert.deepEqual(found.map((entry) => entry.id), ['word'])
  assert.equal(fs.readFileSync(path.join(got.dir, 'lib', 'view.js'), 'utf8'), 'export const view = 1')
})

test('unpackTarGz rejects a path that climbs out of the inbox', () => {
  const env = tempEnv()
  const payload = tarGz({ '../escape.txt': 'nope' })
  const got = unpackTarGz(payload, 'goapp-demo-word', env)
  assert.deepEqual(got, { ok: false, reason: 'unsafe-path' })
  assert.equal(fs.existsSync(path.join(env.dir, 'goapps')), false)
})

test('unpackTarGz rejects anything that is not a gzip tar', () => {
  const got = unpackTarGz(Buffer.from('not an archive'), 'goapp-demo-word', tempEnv())
  assert.deepEqual(got, { ok: false, reason: 'not-tar-gz' })
})

test('readTar stops at the end-of-archive block', () => {
  const payload = zlib.gunzipSync(tarGz({ 'a.txt': 'x' }))
  assert.deepEqual(readTar(payload).map((file) => file.name), ['a.txt'])
})

test('the bundled store entry is downloadable and pinned', async () => {
  const env = tempEnv()
  const entry = loadStore(env).goapps.find((goapp) => goapp.id === 'word')
  assert.ok(entry !== undefined)
  assert.match(entry.url, /^https:\/\//)
  assert.match(entry.sha256, /^[0-9a-f]{64}$/)
  assert.equal(folderFor(entry), 'goapp-demo-word')
})

function fakeCtx() {
  const panels = {}
  const ctx = {
    inject: (deps, cb) => {
      assert.deepEqual(deps, ['dshGo'])
      cb({ dshGo: { panel: (id, spec) => { panels[id] = spec } } })
    },
  }
  return { ctx, panels }
}

/** Write a store index for this machine, the way a market would. */
function writeStore(env, entries) {
  const file = storePath(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: 1, goapps: entries }))
}

test('install downloads a store listing and registers it', async () => {
  const env = tempEnv()
  const payload = tarGz({ 'package.json': MANIFEST })
  writeStore(env, [listing(payload)])
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env, fetch: stubFetch(payload) })
  const effects = await panels.goapps.actions.install(null, { id: 'word', locale: 'zh' })
  assert.equal(effects.at(-1).type, 'refresh')
  const registry = load(env)
  assert.deepEqual(registry.goapps.map((entry) => entry.id), ['word'])
  assert.equal(registry.goapps[0].package, 'goapp-demo-word')
})

test('install reports a failed download and still refreshes', async () => {
  const env = tempEnv()
  const payload = tarGz({ 'package.json': MANIFEST })
  writeStore(env, [listing(payload)])
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env, fetch: stubFetch(tarGz({ 'package.json': '{}' })) })
  const effects = await panels.goapps.actions.install(null, { id: 'word', locale: 'en' })
  assert.match(effects[0].text, /Download failed: checksum/)
  assert.equal(effects.at(-1).type, 'refresh')
  assert.equal(load(env).goapps.length, 0)
})

test('install keeps the inbox path when the listing has no url', async () => {
  const env = tempEnv()
  save(upsert(empty(), { id: 'word', name: '单词', version: '0.1.0', package: 'goapp-demo-word', kind: 'native', enabled: true, installedAt: 1, sessions: [] }), env)
  fs.mkdirSync(path.join(inboxPath(env), 'goapp-demo-word'), { recursive: true })
  fs.writeFileSync(path.join(inboxPath(env), 'goapp-demo-word', 'package.json'), MANIFEST)
  writeStore(env, [{ id: 'word', name: '单词' }])
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  const effects = await panels.goapps.actions.install(null, { id: 'word', locale: 'zh' })
  assert.equal(effects.at(-1).type, 'refresh')
  assert.equal(load(env).goapps.length, 1)
})

test('install of an unknown id downloads nothing', async () => {
  const env = tempEnv()
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  const effects = await panels.goapps.actions.install(null, { id: 'ghost', locale: 'zh' })
  assert.equal(effects.length, 1)
  assert.equal(effects[0].type, 'toast')
  assert.equal(fs.existsSync(path.join(env.dir, 'goapps')), false)
})

test('install updates an older copy in place and keeps enabled/sessions', async () => {
  const env = tempEnv()
  const first = tarGz({ 'package.json': MANIFEST })
  assert.equal((await download(listing(first), env, { fetchImpl: stubFetch(first) })).ok, true)
  save(upsert(empty(), { ...scanInbox(env)[0], enabled: false, sessions: ['s1'] }), env)

  const next = tarGz({ 'package.json': MANIFEST_V2, 'lib/view.js': 'v2' })
  writeStore(env, [listing(next, { version: '0.2.0' })])
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env, fetch: stubFetch(next) })
  const effects = await panels.goapps.actions.install(null, { id: 'word', locale: 'zh' })

  assert.match(effects[0].text, /^已更新/)
  const entry = load(env).goapps[0]
  assert.equal(entry.version, '0.2.0')
  assert.equal(entry.enabled, false)
  assert.deepEqual(entry.sessions, ['s1'])
  assert.equal(fs.readFileSync(path.join(inboxPath(env), 'goapp-demo-word', 'lib', 'view.js'), 'utf8'), 'v2')
})

test('install does not downgrade a newer local copy', async () => {
  const env = tempEnv()
  const newer = tarGz({ 'package.json': MANIFEST_V2 })
  assert.equal((await download(listing(newer, { version: '0.2.0' }), env, { fetchImpl: stubFetch(newer) })).ok, true)
  writeStore(env, [listing(tarGz({ 'package.json': MANIFEST }), { version: '0.1.0' })])

  let calls = 0
  const { ctx, panels } = fakeCtx()
  apply(ctx, {
    env,
    fetch: async () => {
      calls += 1
      throw new Error('must not fetch')
    },
  })
  await panels.goapps.actions.install(null, { id: 'word', locale: 'zh' })

  assert.equal(calls, 0)
  assert.equal(load(env).goapps[0].version, '0.2.0')
})

test('a failed update keeps the installed copy', async () => {
  const env = tempEnv()
  const first = tarGz({ 'package.json': MANIFEST })
  assert.equal((await download(listing(first), env, { fetchImpl: stubFetch(first) })).ok, true)
  save(upsert(empty(), scanInbox(env)[0]), env)

  const next = tarGz({ 'package.json': MANIFEST_V2 })
  writeStore(env, [listing(next, { version: '0.2.0' })])
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env, fetch: stubFetch(tarGz({ 'package.json': '{}' })) })
  const effects = await panels.goapps.actions.install(null, { id: 'word', locale: 'en' })

  assert.match(effects[0].text, /Download failed: checksum/)
  assert.equal(load(env).goapps[0].version, '0.1.0')
  assert.equal(fs.existsSync(path.join(inboxPath(env), 'goapp-demo-word', 'package.json')), true)
})

test('removeUnpacked stays inside the inbox and ignores an empty name', () => {
  const env = tempEnv()
  fs.mkdirSync(path.join(inboxPath(env), 'escape'), { recursive: true })
  const outside = path.join(env.dir, 'outside.txt')
  fs.writeFileSync(outside, 'keep me')

  assert.equal(removeUnpacked(env, ''), false)
  assert.equal(removeUnpacked(env, '   '), false)
  assert.equal(removeUnpacked(env, '../escape'), true)
  assert.equal(fs.existsSync(path.join(inboxPath(env), 'escape')), false)
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me', 'a name can never reach outside the inbox')
})

test('removeUnpacked of a package that was never downloaded is a no-op true', () => {
  const env = tempEnv()
  assert.equal(removeUnpacked(env, 'goapp-demo-word'), true)
})
