import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import { MAX_BYTES, artifactName, indexEntry, listFiles, packDirectory } from '../pack.mjs'
import { readTar, sha256 } from '../../manager/lib/download.js'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const GOAPP_ROOT = path.resolve(HERE, '..', '..')
const DEMO = path.join(GOAPP_ROOT, 'demo-word')
const STORE = path.join(GOAPP_ROOT, 'store')

function fixture(manifest, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goapp-pack-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(dir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, body)
  }
  return dir
}

const baseManifest = {
  name: 'goapp-fixture',
  version: '1.2.3',
  description: 'fixture',
  dshGoGoapp: { id: 'fixture', kind: 'native', entry: 'panel:fixture' },
  dshGo: { v: 1, title: { zh: '样例', en: 'fixture' } },
}

test('packing the same directory twice produces the same bytes', () => {
  const dir = fixture(baseManifest, { 'lib/index.js': 'export const x = 1\n' })
  const first = packDirectory(dir)
  const second = packDirectory(dir)
  assert.deepEqual(first.buffer, second.buffer)
  assert.equal(sha256(first.buffer), sha256(second.buffer))
})

test('a changed mtime does not change the archive', () => {
  const dir = fixture(baseManifest, { 'lib/index.js': 'export const x = 1\n' })
  const before = sha256(packDirectory(dir).buffer)
  const file = path.join(dir, 'lib', 'index.js')
  fs.utimesSync(file, new Date('2001-02-03T04:05:06Z'), new Date('2001-02-03T04:05:06Z'))
  fs.utimesSync(path.join(dir, 'package.json'), new Date('1999-01-01T00:00:00Z'), new Date('1999-01-01T00:00:00Z'))
  assert.equal(sha256(packDirectory(dir).buffer), before)
})

test('package.json sits at the archive root, with no wrapper directory', () => {
  const dir = fixture(baseManifest, { 'lib/index.js': 'export const x = 1\n', 'cordis.patch.yml': 'plugins: {}\n' })
  const records = readTar(zlib.gunzipSync(packDirectory(dir).buffer))
  const names = records.map((record) => record.name).sort()
  assert.deepEqual(names, ['cordis.patch.yml', 'lib/index.js', 'package.json'])
  const manifest = records.find((record) => record.name === 'package.json')
  assert.equal(JSON.parse(manifest.data.toString('utf8')).name, 'goapp-fixture')
})

test('the archive round-trips through the manager reader', () => {
  const dir = fixture(baseManifest, { 'lib/index.js': 'export const x = 1\n' })
  const records = readTar(zlib.gunzipSync(packDirectory(dir).buffer))
  assert.ok(records !== null, 'readTar must accept what packDirectory writes')
  const library = records.find((record) => record.name === 'lib/index.js')
  assert.equal(library.data.toString('utf8'), 'export const x = 1\n')
})

test('node_modules and .git are not shipped', () => {
  const dir = fixture(baseManifest, {
    'lib/index.js': 'x\n',
    'node_modules/dep/index.js': 'nope\n',
    '.git/HEAD': 'ref: refs/heads/main\n',
  })
  const names = listFiles(dir)
  assert.deepEqual(names, ['lib/index.js', 'package.json'])
})

test('the index entry carries what the store needs', () => {
  const dir = fixture(baseManifest, { 'lib/index.js': 'x\n' })
  const { buffer, manifest } = packDirectory(dir)
  const entry = indexEntry({
    manifest,
    buffer,
    baseUrl: 'https://example.test/plugins/goapp/store/',
    file: artifactName(manifest),
  })
  assert.deepEqual(entry, {
    id: 'fixture',
    name: '样例',
    version: '1.2.3',
    package: 'goapp-fixture',
    kind: 'native',
    summary: 'fixture',
    url: 'https://example.test/plugins/goapp/store/goapp-fixture-1.2.3.tar.gz',
    sha256: sha256(buffer),
  })
  assert.equal(artifactName(manifest), 'goapp-fixture-1.2.3.tar.gz')
})

test('a locale title map lists under its Chinese label, never the object', () => {
  const dir = fixture(baseManifest, { 'lib/index.js': 'x\n' })
  const { buffer, manifest } = packDirectory(dir)
  const entry = indexEntry({ manifest, buffer, baseUrl: null, file: 'x.tar.gz' })
  assert.equal(entry.name, '样例', 'a {zh,en} title lists as text, not as [object Object]')
  assert.equal(entry.url, null, 'no base URL means no download, not a broken one')

  const untitled = fixture({ ...baseManifest, dshGo: { v: 1 } }, { 'lib/index.js': 'x\n' })
  const plain = packDirectory(untitled)
  assert.equal(indexEntry({ manifest: plain.manifest, buffer: plain.buffer, file: 'x.tar.gz' }).name, 'goapp-fixture')
})

test('packing refuses a package the store cannot install', () => {
  const missingManifest = fs.mkdtempSync(path.join(os.tmpdir(), 'goapp-empty-'))
  assert.throws(() => packDirectory(missingManifest), /no package\.json/)

  const badVersion = fixture({ ...baseManifest, version: '1.2' }, { 'lib/index.js': 'x\n' })
  assert.throws(() => packDirectory(badVersion), /version must be x\.y\.z/)

  const noId = fixture({ ...baseManifest, dshGoGoapp: { kind: 'native' } }, { 'lib/index.js': 'x\n' })
  assert.throws(() => packDirectory(noId), /dshGoGoapp\.id/)

  const noMarker = fixture({ name: 'x', version: '1.0.0' }, { 'lib/index.js': 'x\n' })
  assert.throws(() => packDirectory(noMarker), /dshGoGoapp\.id/)
})

test('the committed demo artifact matches the demo sources', () => {
  const { buffer, manifest } = packDirectory(DEMO)
  const file = path.join(STORE, artifactName(manifest))
  assert.ok(fs.existsSync(file), `${artifactName(manifest)} is missing from plugins/goapp/store`)
  const committed = fs.readFileSync(file)
  assert.equal(
    sha256(committed),
    sha256(buffer),
    'the store tarball drifted from plugins/goapp/demo-word — repack it with tools/pack.mjs',
  )

  const index = JSON.parse(fs.readFileSync(path.join(GOAPP_ROOT, 'manager', 'data', 'index.json'), 'utf8'))
  const listing = index.goapps.find((item) => item.id === manifest.dshGoGoapp.id)
  assert.ok(listing, 'the bundled index lists the demo')
  assert.equal(listing.sha256, sha256(committed), 'the index hash must match the published bytes')
  assert.equal(listing.version, manifest.version)
  assert.equal(listing.package, manifest.name)
})

test('the demo panel shows the version it is packaged as', () => {
  const source = fs.readFileSync(path.join(DEMO, 'lib', 'index.js'), 'utf8')
  const shown = /const VERSION = '([^']+)'/.exec(source)
  assert.ok(shown, 'the panel prints a version so a device check can tell builds apart')
  const { manifest } = packDirectory(DEMO)
  assert.equal(shown[1], manifest.version, 'VERSION and package.json version must agree')
})

test('the install cap is not exceeded by a normal package', () => {
  const dir = fixture(baseManifest, { 'lib/index.js': 'x\n' })
  assert.ok(packDirectory(dir).buffer.length < MAX_BYTES)
  assert.ok(fs.readFileSync(path.join(STORE, 'goapp-demo-word-0.2.0.tar.gz')).length < MAX_BYTES)
})
