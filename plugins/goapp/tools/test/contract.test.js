// The goapp contract has two ends that no single compiler sees: the plugin side
// (this repository's `plugins/goapp`, plain JS) and the App side (Dart + Kotlin in
// `app/`). A rename on either end silently breaks the other - the icon stops
// opening, or the payload key stops matching - and neither `node --test` nor
// `flutter test` would notice.
//
// So this test pins the seams. It is deliberately textual: these files cannot be
// compiled here (no Flutter SDK in the author's checkout, and a fork's Actions may
// be off), so a grep is the only check that runs. When a seam is renamed on
// purpose, update the anchor here in the same commit - that is the point, not an
// obstacle.
//
// Two kinds of anchor:
//   SEAMS      - the names the plugin side depends on (`class GoappEntry`, a
//                Kotlin extra constant). A rename here breaks behaviour.
//   SIGNATURES - the exact shape of every App API the goapp Dart calls into. A
//                name survives a signature change (a renamed parameter, one more
//                required argument) and then the goapp code no longer compiles
//                while the name check stays green. These anchors come from reading
//                the sources, not from guessing: see the comment on each entry.
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

/** `[file, anchors]` - each anchor is a string the file must still contain. */
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

/**
 * `[file, anchors]` - the shape of each App API `goapp_page.dart` builds on.
 * Every anchor below was read out of the source at the time of writing; if one
 * moves, the goapp page needs the same edit in the same commit.
 */
const SIGNATURES = [
  // `showAppSheet<void>(context, isScrollControlled: true, builder: ...)`
  [
    'app/lib/ui/common/app_sheet.dart',
    [
      'Future<T?> showAppSheet<T>(',
      'required WidgetBuilder builder',
      'bool isScrollControlled = false',
    ],
  ],
  // `AppPage.list(title: ..., actions: ..., children: ...)`
  // `GlassIconButton(key: ..., icon: ..., tooltip: ..., onPressed: ...)`
  [
    'app/lib/ui/shell/page_frame.dart',
    [
      'static Widget list({',
      'required List<Widget> children',
      'class GlassIconButton extends StatelessWidget',
      'required this.onPressed',
    ],
  ],
  // `p.package` and `p.id` are what the goapp page matches a link against.
  [
    'app/lib/plugins/native/native_model.dart',
    ['class NativePanel {', 'required this.package,', 'required this.id,', 'final String package;'],
  ],
  // `NativePanelView(key: ..., panel: ..., sessionId: ...)`
  [
    'app/lib/ui/plugins/native/native_panel.dart',
    ['const NativePanelView({super.key, required this.panel, this.sessionId});'],
  ],
  // `l10n.monthDay(session.startedAt)` through the L10nFormat extension.
  [
    'app/lib/l10n/l10n.dart',
    ['extension L10nFormat on L10n {', 'String monthDay(DateTime d)'],
  ],
  // Every icon the goapp page and its conversation sheet use.
  [
    'app/lib/ui/theme/app_icons.dart',
    [
      'abstract final class AppIcons {',
      'static const history =',
      'static const add =',
      'static const delete =',
      'static const checkboxOn =',
      'static const checkboxOff =',
    ],
  ],
  // `DshGoPanel.goapp` - the placement that makes a panel a goapp.
  [
    'packages/dsh_client/lib/src/dsh_go_api.dart',
    ['class DshGoPanel {', "static const goapp = 'goapp';"],
  ],
]

/** The call shapes in the goapp page that the SIGNATURES above are there to serve. */
const CALLS = [
  'showAppSheet<void>(',
  'AppPage.list(',
  'GlassIconButton(',
  'NativePanelView(',
  'l10n.monthDay(',
  'AppIcons.history',
  'AppIcons.checkboxOn',
  'p.package == widget.package && p.id == widget.id',
]

const skipWithoutApp = (t) => {
  if (fs.existsSync(APP)) return false
  t.skip(`no app/ under ${REPO} - this checkout cannot check the App side`)
  return true
}

test('the App side still carries every seam the plugin side depends on', (t) => {
  if (skipWithoutApp(t)) return
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

test('the App APIs the goapp page calls still have the shape it was written against', (t) => {
  if (skipWithoutApp(t)) return
  const drifted = []
  for (const [file, anchors] of SIGNATURES) {
    const full = path.join(REPO, file)
    if (!fs.existsSync(full)) {
      drifted.push(`${file} is gone`)
      continue
    }
    const body = fs.readFileSync(full, 'utf8')
    for (const anchor of anchors) {
      if (!body.includes(anchor)) drifted.push(`${file} no longer contains ${anchor}`)
    }
  }
  assert.deepEqual(
    drifted,
    [],
    'an App API the goapp page builds on changed shape. Read the new signature, update ' +
      'app/lib/ui/plugins/native/goapp_page.dart, then update SIGNATURES here in the same commit',
  )
})

test('the goapp page still calls those APIs the way SIGNATURES describes', (t) => {
  if (skipWithoutApp(t)) return
  const page = path.join(REPO, 'app/lib/ui/plugins/native/goapp_page.dart')
  const body = fs.readFileSync(page, 'utf8')
  const missing = CALLS.filter((call) => !body.includes(call))
  assert.deepEqual(missing, [], `goapp_page.dart no longer contains ${missing.join(', ')}`)
})

test('both ends agree on the shortcut payload key', (t) => {
  if (skipWithoutApp(t)) return
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
