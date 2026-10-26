// Canonicalization of the request members that enter the attempt identity, as section 5.5 of the x402 specification
// v2 defines them (pull request 3776, commit c207612). Pure functions, no network, no account.
//
//   query  : parse the raw query string into ordered (name, value) pairs, percent-decode each per RFC 3986, re-encode
//            with uppercase hex over the unreserved set, sort by encoded name then encoded value, join with "&".
//   body   : reverse content-encoding (gzip, deflate, br), decode the charset from Content-Type (UTF-8 if undeclared),
//            then SHA-256; for JSON bodies the decoded body is first canonicalized with RFC 8785.
//
// What this does NOT settle, and says so: the text is silent on "+" in a query (RFC 3986 reads it as a literal plus,
// form decoding reads it as a space), on an empty query versus no query, and on JSON with duplicate keys. This file
// follows RFC 3986 for "+" and refuses duplicate-key JSON as "not JSON" so that the choice is visible and not hidden.
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'

const UNRESERVED = /[A-Za-z0-9\-._~]/

function percentDecode(s) {
  // Decode %XX byte sequences, then read the bytes as UTF-8. "+" stays a literal plus (RFC 3986).
  const bytes = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2 }
    else for (const b of Buffer.from(s[i], 'utf8')) bytes.push(b)
  }
  return Buffer.from(bytes)
}

function percentEncode(buf) {
  let uit = ''
  for (const b of buf) {
    const ch = String.fromCharCode(b)
    uit += b < 128 && UNRESERVED.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0')
  }
  return uit
}

export function canonicalQuery(raw) {
  const q = String(raw ?? '').replace(/^\?/, '')
  if (q === '') return ''
  const paren = []
  for (const stuk of q.split('&')) {
    if (stuk === '') continue
    const i = stuk.indexOf('=')
    const naam = i === -1 ? stuk : stuk.slice(0, i)
    const waarde = i === -1 ? '' : stuk.slice(i + 1)
    paren.push([percentEncode(percentDecode(naam)), percentEncode(percentDecode(waarde))])
  }
  paren.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return paren.map(([n, w]) => `${n}=${w}`).join('&')
}

// RFC 8785 for the data types that occur here (strings, integers, booleans, null, arrays, objects). Property names are
// sorted by UTF-16 code units, which is what Array.prototype.sort does by default; numbers use the ES6 serialization,
// which JSON.stringify implements. A document with duplicate keys is not I-JSON and is refused by the caller.
export function jcs(w) {
  if (Array.isArray(w)) return '[' + w.map(jcs).join(',') + ']'
  if (w && typeof w === 'object') return '{' + Object.keys(w).sort().map((k) => JSON.stringify(k) + ':' + jcs(w[k])).join(',') + '}'
  return JSON.stringify(w)
}

function heeftDubbeleSleutels(tekst) {
  // Light check on the text: the same key twice in one object. A parser differential here is exactly the bug class.
  let dubbel = false
  const stap = (t) => {
    const stack = []
    let i = 0
    while (i < t.length) {
      const c = t[i]
      if (c === '{') stack.push(new Set())
      else if (c === '}') stack.pop()
      else if (c === '"') {
        let j = i + 1
        while (j < t.length && !(t[j] === '"' && t[j - 1] !== '\\')) j++
        const s = t.slice(i, j + 1)
        let k = j + 1
        while (/\s/.test(t[k] ?? '')) k++
        if (t[k] === ':' && stack.length) { const set = stack[stack.length - 1]; if (set.has(s)) dubbel = true; set.add(s) }
        i = j
      }
      i++
    }
  }
  stap(tekst)
  return dubbel
}

export function decodeBody({ bodyBase64 = '', contentEncoding = '', contentType = '' }) {
  let bytes = Buffer.from(bodyBase64, 'base64')
  const codes = String(contentEncoding).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).reverse()
  for (const c of codes) {
    if (c === 'gzip' || c === 'x-gzip') bytes = zlib.gunzipSync(bytes)
    else if (c === 'deflate') bytes = zlib.inflateSync(bytes)
    else if (c === 'br') bytes = zlib.brotliDecompressSync(bytes)
    else if (c === 'identity') continue
    else throw new Error('unsupported content-encoding ' + c)
  }
  const m = /charset\s*=\s*"?([A-Za-z0-9_\-.:]+)"?/i.exec(String(contentType))
  const label = m ? m[1] : 'utf-8'
  return new TextDecoder(label, { fatal: true }).decode(bytes)
}

export function bodyDigest(raw) {
  const tekst = decodeBody(raw)
  const isJson = /^application\/(?:[\w.+-]*\+)?json\b/i.test(String(raw.contentType ?? '').trim())
  let canoniek = tekst
  if (isJson && !heeftDubbeleSleutels(tekst)) {
    try { canoniek = jcs(JSON.parse(tekst)) } catch { canoniek = tekst }
  }
  return createHash('sha256').update(canoniek, 'utf8').digest('hex')
}

/** The canonical members of a request wire form, ready to be hashed into an identity. */
export function canonicalMembers(wire) {
  return { method: String(wire.method ?? '').toUpperCase(), path: wire.path ?? '', query: canonicalQuery(wire.query), body: bodyDigest(wire) }
}
