// Registry and import behaviour, no bridge needed: pure functions plus a temp dir.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { empty, load, noteSession, parse, registryPath, remove, save, setEnabled, upsert } from '../lib/registry.js'
import { inboxPath, readPackage, scanInbox } from '../lib/import.js'
import { apply } from '../lib/index.js'

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
  assert.equal(entry.package, 'ok')
  assert.equal(entry.kind, 'web')
  assert.equal(entry.entry, 'web/index.html')
  assert.equal(entry.installedAt, 42)
})

/** A ctx that records the panel the host half declares. */
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

test('open reaches another package’s panel through a package/id ref', () => {
  const env = tempEnv()
  save(
    upsert(empty(), {
      id: 'word',
      name: '词',
      version: '0.1.0',
      package: 'goapp-demo-word',
      kind: 'native',
      entry: 'panel:word',
      enabled: true,
      installedAt: 1,
      sessions: [],
    }),
    env,
  )
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  const effects = panels.goapps.actions.open(null, { id: 'word', locale: 'zh' })
  assert.deepEqual(effects.at(-1), { type: 'open', panel: 'goapp-demo-word/word' })
})

test('open falls back to a callout when the goapp has no native panel', () => {
  const env = tempEnv()
  save(
    upsert(empty(), {
      id: 'webapp',
      name: '网页',
      version: '0.1.0',
      package: 'goapp-web',
      kind: 'web',
      entry: 'web/index.html',
      enabled: true,
      installedAt: 1,
      sessions: [],
    }),
    env,
  )
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  const effects = panels.goapps.actions.open(null, { id: 'webapp', locale: 'zh' })
  assert.equal(effects.some((e) => e.type === 'open'), false)
  assert.equal(effects.at(-1).type, 'callout')
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

test('remove deletes the unpacked package, so 导入 cannot bring it back', () => {
  const env = tempEnv()
  const pkgDir = path.join(inboxPath(env), 'goapp-demo-word')
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'goapp-demo-word', version: '0.2.0', dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' } }),
  )
  save(
    upsert(empty(), {
      id: 'word',
      name: '词',
      version: '0.2.0',
      package: 'goapp-demo-word',
      kind: 'native',
      entry: 'panel:word',
      enabled: true,
      installedAt: 1,
      sessions: ['s1'],
    }),
    env,
  )
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })

  const effects = panels.goapps.actions.remove(null, { id: 'word', locale: 'zh' })

  assert.equal(fs.existsSync(pkgDir), false, 'the unpacked folder has to go with it')
  assert.equal(load(env).goapps.length, 0)
  assert.match(effects[0].text, /1\)$/)
  assert.match(panels.goapps.actions.import(null, { locale: 'zh' })[0].text, /0$/, 'no package left for 导入 to find')
})

test('remove of an entry with no files on disk still succeeds', () => {
  const env = tempEnv()
  save(upsert(empty(), { id: 'ghost', name: 'Ghost', version: '1', kind: 'native', enabled: true, installedAt: 1, sessions: [] }), env)
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  const effects = panels.goapps.actions.remove(null, { id: 'ghost', locale: 'zh' })
  assert.equal(load(env).goapps.length, 0)
  assert.equal(effects.length, 2)
})

test('open refuses a goapp the manager was told to stop offering', () => {
  const env = tempEnv()
  save(
    upsert(empty(), {
      id: 'word',
      name: '词',
      version: '0.2.0',
      package: 'goapp-demo-word',
      kind: 'native',
      entry: 'panel:word',
      enabled: false,
      installedAt: 1,
      sessions: [],
    }),
    env,
  )
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })

  const effects = panels.goapps.actions.open(null, { id: 'word', locale: 'zh' })

  assert.equal(effects.length, 1, 'no open effect while stopped')
  assert.equal(effects[0].type, 'toast')
  assert.match(effects[0].text, /已停用/)
})

test('open and toggle of an id nobody installed say so in the asked language', () => {
  const env = tempEnv()
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })

  const opened = panels.goapps.actions.open(null, { id: 'ghost', locale: 'zh' })
  assert.deepEqual(opened, [{ type: 'toast', text: '没有安装: ghost' }], 'no callout for a goapp that is not there')
  const toggled = panels.goapps.actions.toggle(null, { id: 'ghost', locale: 'en' })
  assert.deepEqual(toggled, [{ type: 'toast', text: 'Not installed: ghost' }])
})

/** Drop a goapp package into the inbox under an arbitrary folder name. */
function drop(env, folder, pkg) {
  const dir = path.join(inboxPath(env), folder)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
  return dir
}

test('import remembers the folder the package was unzipped into', () => {
  const env = tempEnv()
  drop(env, 'my-word', {
    name: 'goapp-demo-word',
    version: '0.2.2',
    dshGo: { title: 'go单词' },
    dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' },
  })
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  panels.goapps.actions.import(null, { locale: 'zh' })
  const entry = load(env).goapps[0]
  assert.equal(entry.id, 'word')
  assert.equal(entry.package, 'goapp-demo-word')
  assert.equal(entry.folder, 'my-word', 'the folder, not the package name, is what delete needs')
})

test('remove deletes the folder a hand-dropped package actually lives in', () => {
  const env = tempEnv()
  const dir = drop(env, 'my-word', {
    name: 'goapp-demo-word',
    version: '0.2.2',
    dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' },
  })
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  panels.goapps.actions.import(null, { locale: 'zh' })

  panels.goapps.actions.remove(null, { id: 'word', locale: 'zh' })

  assert.equal(fs.existsSync(dir), false, 'the real folder has to go, not a folder named after the package')
  assert.match(panels.goapps.actions.import(null, { locale: 'zh' })[0].text, /0$/, 'nothing left for 导入 to resurrect')
})

test('a folder in the registry that points outside the inbox is ignored', () => {
  const env = tempEnv()
  const outside = path.join(env.dir, 'keep')
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'x')
  const dir = drop(env, 'goapp-demo-word', {
    name: 'goapp-demo-word',
    version: '0.2.2',
    dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' },
  })
  fs.mkdirSync(path.join(env.dir, 'goapps'), { recursive: true })
  fs.writeFileSync(
    registryPath(env),
    JSON.stringify({
      version: 1,
      goapps: [
        { id: 'word', name: '词', package: 'goapp-demo-word', folder: '../../keep', kind: 'native', entry: 'panel:word', enabled: true, sessions: [] },
      ],
    }),
  )
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })

  panels.goapps.actions.remove(null, { id: 'word', locale: 'zh' })

  assert.equal(fs.existsSync(path.join(outside, 'keep.txt')), true, 'nothing outside the inbox may be deleted')
  assert.equal(fs.existsSync(dir), false, 'the sanitized package name still finds the package')
})

test('upsert keeps enabled/sessions across an update of the same package', () => {
  let reg = upsert(empty(), { id: 'w', name: 'A', version: '1.0.0', package: 'a-pkg', kind: 'native', enabled: false, installedAt: 1, sessions: ['s1'] })
  reg = upsert(reg, { id: 'w', name: 'A', version: '2.0.0', package: 'a-pkg', kind: 'native', enabled: true, installedAt: 2, sessions: [] })
  assert.equal(reg.goapps.length, 1)
  assert.equal(reg.goapps[0].version, '2.0.0')
  assert.equal(reg.goapps[0].enabled, false, 'a new version must not turn a stopped goapp back on')
  assert.deepEqual(reg.goapps[0].sessions, ['s1'], 'the removal list survives an update')
})

test('a different package claiming the same id inherits nothing from it', () => {
  let reg = upsert(empty(), { id: 'w', name: 'A', version: '1.0.0', package: 'a-pkg', kind: 'native', enabled: false, installedAt: 1, sessions: ['s1'] })
  reg = upsert(reg, { id: 'w', name: 'B', version: '1.0.0', package: 'b-pkg', kind: 'native', enabled: true, installedAt: 2, sessions: [] })
  assert.equal(reg.goapps.length, 1)
  assert.equal(reg.goapps[0].package, 'b-pkg')
  assert.equal(reg.goapps[0].enabled, true, 'another app must not start out stopped')
  assert.deepEqual(reg.goapps[0].sessions, [], 'nor inherit sessions it never opened')
})

test('a second package claiming the same id takes it over, and remove clears both folders', () => {
  const env = tempEnv()
  const first = drop(env, 'a-pkg', {
    name: 'a-pkg',
    version: '1.0.0',
    dshGoGoapp: { id: 'w', kind: 'native', entry: 'panel:w' },
  })
  const second = drop(env, 'b-pkg', {
    name: 'b-pkg',
    version: '1.0.0',
    dshGoGoapp: { id: 'w', kind: 'native', entry: 'panel:w' },
  })
  // Two different packages, one id: the newest folder is the one that holds it.
  // Stated with mtimes so the assertion does not depend on the filesystem clock.
  age(first, 10)
  age(second, 20)
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })

  panels.goapps.actions.import(null, { locale: 'zh' })

  const registry = load(env).goapps
  assert.equal(registry.length, 1, 'one id, one entry')
  assert.equal(registry[0].folder, 'b-pkg')
  assert.equal(fs.existsSync(second), true)
  assert.equal(fs.existsSync(first), true, 'the losing package keeps its files until the id is removed')

  // While the id is taken, the loser cannot come back: it is not what 导入 picks.
  assert.match(panels.goapps.actions.import(null, { locale: 'zh' })[0].text, /跳过重复 1/)

  panels.goapps.actions.remove(null, { id: 'w', locale: 'zh' })

  assert.equal(fs.existsSync(second), false, 'the goapp\'s own folder goes')
  assert.equal(fs.existsSync(first), false, 'and so does the folder that had claimed the same id')
  assert.match(panels.goapps.actions.import(null, { locale: 'zh' })[0].text, /已导入 0/, 'nothing left to resurrect')
})

/** Give a folder a distinct mtime so "newest wins" is decided by the test, not by the clock. */
function age(dir, seconds) {
  const when = 1_600_000_000 + seconds
  fs.utimesSync(dir, when, when)
}

test('two folders holding the same package are one goapp, and the newest folder wins', () => {
  const env = tempEnv()
  const pkg = { name: 'goapp-demo-word', version: '0.2.2', dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' } }
  const older = drop(env, 'aaa-word', pkg)
  const newer = drop(env, 'zzz-word', pkg)
  age(older, 10)
  age(newer, 20)
  assert.equal(scanInbox(env).length, 1, 'the same package must not be listed twice')

  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  const toast = panels.goapps.actions.import(null, { locale: 'zh' })[0].text

  const registry = load(env).goapps
  assert.equal(registry.length, 1)
  assert.equal(registry[0].folder, 'zzz-word', 'the newest folder represents the package')
  assert.match(toast, /已导入 1/, 'one goapp was registered')
  assert.match(toast, /跳过重复 1/, 'the ignored folder is reported, not silently dropped')
  assert.equal(fs.existsSync(older), true, 'the loser is left alone: it may be a build the user unzipped')
})

test('the same package under the same mtime folds deterministically, not by listing order', () => {
  const env = tempEnv()
  const pkg = { name: 'goapp-demo-word', version: '0.2.2', dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' } }
  const a = drop(env, 'b-word', pkg)
  const b = drop(env, 'a-word', pkg)
  age(a, 5)
  age(b, 5)
  assert.deepEqual(scanInbox(env).map((e) => e.folder), ['a-word'], 'ties break on the folder name')
})

test('remove deletes every folder of the package, so a twin cannot resurrect it', () => {
  const env = tempEnv()
  const pkg = { name: 'goapp-demo-word', version: '0.2.2', dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' } }
  const first = drop(env, 'my-word', pkg)
  const second = drop(env, 'goapp-demo-word', pkg)
  age(first, 10)
  age(second, 20)
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  panels.goapps.actions.import(null, { locale: 'zh' })

  panels.goapps.actions.remove(null, { id: 'word', locale: 'zh' })

  assert.equal(fs.existsSync(first), false, 'the twin folder has to go too')
  assert.equal(fs.existsSync(second), false)
  assert.match(panels.goapps.actions.import(null, { locale: 'zh' })[0].text, /已导入 0/, 'nothing left to resurrect')
})

test('a registry that cannot be written answers with a toast, not an exception', () => {
  const env = tempEnv()
  save(
    upsert(empty(), { id: 'word', name: '词', version: '0.1.0', package: 'goapp-demo-word', kind: 'native', entry: 'panel:word', enabled: true, installedAt: 1, sessions: [] }),
    env,
  )
  // A directory where save() wants its temp file makes the write fail with EISDIR
  // while the registry itself stays readable — the only broken part is the write.
  fs.mkdirSync(`${registryPath(env)}.tmp`, { recursive: true })
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })

  const effects = panels.goapps.actions.toggle(null, { id: 'word', locale: 'zh' })

  assert.equal(effects[0].type, 'toast')
  assert.match(effects[0].text, /保存失败: EISDIR/, 'a stable code, so the user can tell why nothing changed')
  assert.match(effects[0].text, /词/, 'and which goapp it was about')
  assert.equal(load(env).goapps[0].enabled, true, 'a refused write must not look like a flip')
})

test('a refused save on remove keeps the files, so the goapp is still openable', () => {
  const env = tempEnv()
  const dir = drop(env, 'my-word', {
    name: 'goapp-demo-word',
    version: '0.2.2',
    dshGoGoapp: { id: 'word', kind: 'native', entry: 'panel:word' },
  })
  const { ctx, panels } = fakeCtx()
  apply(ctx, { env })
  panels.goapps.actions.import(null, { locale: 'zh' })
  fs.mkdirSync(`${registryPath(env)}.tmp`, { recursive: true })

  const effects = panels.goapps.actions.remove(null, { id: 'word', locale: 'zh' })

  assert.match(effects[0].text, /保存失败/)
  assert.equal(fs.existsSync(dir), true, 'the registry still lists it, so its files must stay')
  assert.equal(load(env).goapps.length, 1, 'the goapp is still installed')
})
