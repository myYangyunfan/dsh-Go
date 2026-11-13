// Run every check the goapp subsystem can run without a phone or a CI runner:
// the manager suite, the packing suite, and the plugin kit's own validator for
// both plugins. One command, one exit code.
//
// Why this exists: the fork's GitHub Actions are disabled, so nothing verifies a
// goapp change unless someone remembers all four commands. Remembering is not a
// process; this is.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOAPP = path.resolve(HERE, '..') // plugins/goapp
const REPO = path.resolve(GOAPP, '..', '..') // repository root

/**
 * Where the plugin kit's validator lives. Default is the in-repo copy; `--check
 * <path>` exists for a checkout that only carries `plugins/goapp` (a staging
 * copy, for instance) and has to point at another checkout's kit.
 */
function checkPath(argv) {
  const at = argv.indexOf('--check')
  if (at !== -1) {
    const given = argv[at + 1]
    if (given === undefined || given.startsWith('--')) {
      process.stderr.write('verify: --check needs a path to check.mjs\n')
      process.exit(2)
    }
    return path.resolve(given)
  }
  return path.join(REPO, 'sdk', 'plugin-kit', 'bin', 'check.mjs')
}

const CHECK = checkPath(process.argv.slice(2))

/** `.test.js` files of one directory, sorted so output is stable. */
function tests(dir) {
  const full = path.join(GOAPP, dir, 'test')
  if (!fs.existsSync(full)) return []
  return fs
    .readdirSync(full)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join(full, name))
}

/**
 * One step: run a command and keep its exit code. Output is inherited so a red
 * step shows its own assertion instead of a summary that hides which one broke.
 */
function step(label, command, args, cwd = REPO) {
  process.stdout.write(`\n── ${label}\n`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  return { label, ok: result.status === 0, status: result.status }
}

const steps = []

const managerTests = tests('manager')
if (managerTests.length === 0) {
  steps.push({ label: 'manager tests', ok: false, status: 'no test files' })
} else {
  steps.push(step('manager tests', process.execPath, ['--test', ...managerTests], GOAPP))
}

const toolTests = tests('tools')
if (toolTests.length === 0) {
  steps.push({ label: 'packing tests', ok: false, status: 'no test files' })
} else {
  steps.push(step('packing tests', process.execPath, ['--test', ...toolTests], GOAPP))
}

if (!fs.existsSync(CHECK)) {
  steps.push({ label: 'plugin kit check', ok: false, status: `missing ${path.relative(REPO, CHECK)}` })
} else {
  for (const plugin of ['manager', 'demo-word']) {
    steps.push(step(`check ${plugin}`, process.execPath, [CHECK, path.join(GOAPP, plugin), '--load'], REPO))
  }
}

const failed = steps.filter((entry) => !entry.ok)
process.stdout.write('\n── summary\n')
for (const entry of steps) {
  const mark = entry.ok ? 'ok  ' : 'FAIL'
  process.stdout.write(`${mark} ${entry.label}${entry.ok ? '' : ` (status ${entry.status})`}\n`)
}
if (failed.length > 0) {
  process.stdout.write(`\n${failed.length} of ${steps.length} steps failed\n`)
  process.exit(1)
}
process.stdout.write(`\nall ${steps.length} steps passed\n`)
