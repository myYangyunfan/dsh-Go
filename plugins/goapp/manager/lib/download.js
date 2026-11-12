// Fetch a goapp package into the inbox. A store listing that carries `url` and
// `sha256` installs without the user dropping a folder into the inbox by hand; a
// listing without them stays a catalogue line and `install` keeps answering
// "not downloaded yet".
//
// `sha256` is mandatory whenever `url` is set: installing UI code from a URL
// without checking the bytes is a supply-chain hole, and a store index is a
// file a machine may have pointed somewhere else.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { inboxPath } from './import.js'

/** A goapp package is UI code, not an engine: cap the download. */
const MAX_BYTES = 32 * 1024 * 1024

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** `true` for an archive path the package is not allowed to contain. */
function unsafe(name) {
  const clean = name.replace(/\\/g, '/')
  if (clean === '' || clean.startsWith('/') || /^[A-Za-z]:/.test(clean)) return true
  return clean.split('/').some((part) => part === '..')
}

/**
 * Walk a tar buffer into `{ name, data }` file records. GNU/pax metadata blocks
 * are skipped on purpose: a goapp package is plain files plus package.json, and
 * silently honouring a long-name override would make the path checks weaker.
 */
export function readTar(buffer) {
  const out = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '').trim()
    const size = Number.parseInt(field(124, 12) || '0', 8)
    if (!Number.isFinite(size) || size < 0) return null
    const type = field(156, 1) || '0'
    const prefix = field(345, 155)
    const name = prefix === '' ? field(0, 100) : `${prefix}/${field(0, 100)}`
    const start = offset + 512
    const end = start + size
    if (end > buffer.length) return null
    if (type === '0' || type === '\0' || type === '7') out.push({ name, data: buffer.subarray(start, end) })
    offset = start + Math.ceil(size / 512) * 512
  }
  return out
}

/**
 * Unpack a `.tar.gz` payload into `$DSH_HOME/goapps/inbox/<folder>`. The folder
 * is built beside the target and renamed into place, so an interrupted download
 * never leaves a half package for `scanInbox` to read.
 */
export function unpackTarGz(payload, folder, env = process.env) {
  let files
  try {
    files = readTar(zlib.gunzipSync(payload))
  } catch {
    return { ok: false, reason: 'not-tar-gz' }
  }
  if (files === null || files.length === 0) return { ok: false, reason: 'not-tar-gz' }
  for (const file of files) if (unsafe(file.name)) return { ok: false, reason: 'unsafe-path' }
  const inbox = inboxPath(env)
  const target = path.join(inbox, folder)
  const temp = path.join(inbox, `.${folder}.${process.pid}`)
  fs.rmSync(temp, { recursive: true, force: true })
  try {
    fs.mkdirSync(inbox, { recursive: true })
    for (const file of files) {
      const dest = path.join(temp, file.name)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, file.data)
    }
    fs.rmSync(target, { recursive: true, force: true })
    fs.renameSync(temp, target)
  } catch {
    fs.rmSync(temp, { recursive: true, force: true })
    return { ok: false, reason: 'write' }
  }
  return { ok: true, dir: target }
}

/** Inbox folder for one listing: the npm package name, else the goapp id. */
export function folderFor(listing) {
  const raw = typeof listing?.package === 'string' && listing.package !== '' ? listing.package : String(listing?.id ?? '')
  const clean = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '')
  return clean === '' ? 'goapp' : clean
}

/**
 * Fetch one store listing into the inbox. `options.fetchImpl` exists so tests can
 * hand in a fake response; the runtime uses the global fetch.
 */
export async function download(listing, env = process.env, options = {}) {
  const url = typeof listing?.url === 'string' ? listing.url.trim() : ''
  if (url === '') return { ok: false, reason: 'no-url' }
  const want = typeof listing?.sha256 === 'string' ? listing.sha256.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(want)) return { ok: false, reason: 'no-checksum' }
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'bad-url' }
  const doFetch = options.fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, reason: 'no-fetch' }
  let payload
  try {
    const response = await doFetch(url)
    if (response === null || response === undefined || response.ok === false) {
      return { ok: false, reason: `http-${response?.status ?? 'error'}` }
    }
    const declared = Number(response.headers?.get?.('content-length') ?? 0)
    if (declared > MAX_BYTES) return { ok: false, reason: 'too-large' }
    payload = Buffer.from(await response.arrayBuffer())
  } catch {
    return { ok: false, reason: 'network' }
  }
  if (payload.length > MAX_BYTES) return { ok: false, reason: 'too-large' }
  if (sha256(payload) !== want) return { ok: false, reason: 'checksum' }
  return unpackTarGz(payload, folderFor(listing), env)
}
