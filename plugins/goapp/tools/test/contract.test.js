// The goapp contract has two ends that no single compiler sees: the plugin side
// (this repository's `plugins/goapp`, plain JS) and the App side (Dart + Kotlin in
// `app/`). A rename on either end silently breaks the other — the icon stops
// opening, or the payload key stops matching — and neither `node --test` nor
// `flutter test` would notice.
//
// So this test pins the seams by name. It is deliberately textual: these files
// cannot be compiled here (no Flutter SDK, and the fork's Actions are off), so a
// grep is the only check that runs. When a seam is renamed on purpose, update the
// anchor here in the same commit — that is the point, not an obstacle.
//
// A checkout without `app/` (a staging copy of `plugins/goapp` only) SKIPS with a
// message and does not count as passing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..', '..')
const APP = path.join(REPO, 'app')

/** `[file, anchors]` — each anchor is a string the file must still contain. */
const SEAMS = [
  [
    'app/lib/links/launcher_entries.dart',
    ["'goapp'", 'class GoappEntry', 'class GoappShortcut', 'goappPackage'],
  ],
  [
    'app/lib/links/page_links.dart',
    ['panelLinkTarget', 'panelLinkPage'],
  ],
  [
    'app/lib/ui/plugins/native/native_taps.dart',
    ['_panelNamed', "lastIndexOf('/')"],
  ],
  [
    'app/lib/ui/plugins/native/goapp_page.dart',
    ['GoappPanelPage'],
  ],
  [
    'app/lib/ui/plugins/native/goapp_link_host.dart',
    ['GoappLinkHost'],
  ],
  [
    'app/lib/state/goapp_sessions.dart',
    ['mintGoappSession', 'forgetPackage'],
  ],
  [
    'app/android/app/src/main/kotlin/io/github/ccch1mneyyy/dsh_app/shortcuts/ShortcutsPlugin.kt',
    ['KIND_GOAPP', 'EXTRA_GOAPP_PACKAGE', 'EXTRA_GOAPP_PANEL'],
  ],
  [
    'app/android/app/src/main/kotlin/io/github/ccch1mneyyy/dsh_app/shortcuts/EntryActivity.kt',
    ['ACTION_OPEN_GOAPP', 'openGoapp'],
  ],
]

test('the App side still carries every seam the plugin side depends on', (t) => {
  if (!fs.existsSync(APP)) {
    t.skip(`no app/ under ${REPO} — this checkout cannot check the App side`)
    return
  }
  const missing = []
  for (const [file, anchors] of SEAMS) {
    const full = path.join(REPO, file)
    if (!fs.existsSync(full)) {
      missing.push(`${file} is gone`)
      continue
    }
    const body = fs.readFileSync(full, 'utf8')
    for (const anchor of anchors) {
      if (!body.includes(anchor)) missing.push(`${file} no longer contains ${anchor}`)
    }
  }
  assert.deepEqual(
    missing,
    [],
    'the goapp seams moved. Fix the App side, or update SEAMS in this file in the same commit',
  )
})

test('both ends agree on the shortcut payload key', (t) => {
  if (!fs.existsSync(APP)) {
    t.skip(`no app/ under ${REPO} — this checkout cannot check the App side`)
    return
  }
  const dart = fs.readFileSync(path.join(REPO, 'app/lib/links/launcher_entries.dart'), 'utf8')
  assert.ok(dart.includes("'goapps'"), 'the Dart publisher must send a `goapps` list')

  for (const relative of [
    'app/android/app/src/main/kotlin/io/github/ccch1mneyyy/dsh_app/shortcuts/ShortcutsPlugin.kt',
    'plugins/goapp/manager/lib/import.js',
  ]) {
    const body = fs.readFileSync(path.join(REPO, relative), 'utf8')
    assert.ok(
      body.includes('goapps'),
      `${relative} must read or write the same key the Dart side sends`,
    )
  }
})
