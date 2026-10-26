// Canonicalization of the request members that enter the attempt identity, as section 5.5 of the x402 specification
// v2 defines them (pull request 3776, commit 8494922). Pure functions, no network, no account.
//
//   query  : parse the raw query string into ordered (name, value) pairs, percent-decode each per RFC 3986, re-encode
//            with uppercase hex over the unreserved set, sort by encoded name then encoded value, join with "&".
//            A literal "+" stays a plus. An empty query and no query are the same case: the member is omitted.
//   body   : reverse content-encoding (gzip, deflate, br), decode the charset from Content-Type (UTF-8 if undeclared),
//            then SHA-256; for JSON bodies the decoded body is first canonicalized with RFC 8785. JSON with duplicate
//            object keys is not I-JSON and is hashed as its decoded UTF-8 bytes, without canonicalization.
//
// Choices the text does not make, and this file makes visible: empty segments in a query ("a=1&&b=2") are dropped,
// and a "%" that is not followed by two hex digits is kept as a literal percent sign (so "%zz" and "%25zz" give the
// same canonical query). Numbers are serialized as JSON.stringify does, which matches RFC 8785 for the values that occur.
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'

const UNRESERVED = /[A-Za-z0-9\-._~]/

function percentDecode(s) {
  // "%XX" becomes a byte, the bytes are read as UTF-8 by the caller. "+" stays a literal plus (RFC 3986).
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

// RFC 8785 for the data types that occur here: property names sorted by UTF-16 code units (the default sort), numbers as
// JSON.stringify writes them (the ES6 serialization), strings as JSON.stringify writes them.
export function jcs(w) {
  if (Array.isArray(w)) return '[' + w.map(jcs).join(',') + ']'
  if (w && typeof w === 'object') return '{' + Object.keys(w).sort().map((k) => JSON.stringify(k) + ':' + jcs(w[k])).join(',') + '}'
  return JSON.stringify(w)
}

/**
 * A small strict JSON reader that reports duplicate object keys AFTER unescaping them, which a text scan cannot do
 * ("a" and "a" are the same key). Returns { value, duplicate }. Throws on anything that is not valid JSON.
 */
export function parseJsonStrict(tekst) {
  let i = 0
  let duplicate = false
  const spatie = () => { while (i < tekst.length && /[ \t\n\r]/.test(tekst[i])) i++ }
  const fout = (m) => { throw new Error(`invalid JSON at ${i}: ${m}`) }
  function tekenreeks() {
    if (tekst[i] !== '"') fout('expected a string')
    let j = i + 1
    let uit = ''
    while (j < tekst.length) {
      const c = tekst[j]
      if (c === '"') { const raw = tekst.slice(i, j + 1); i = j + 1; try { return JSON.parse(raw) } catch { return fout('bad string') } }
      if (c === '\\') { j += 2 } else { if (c < ' ') fout('control character in string'); j++ }
    }
    return fout('unterminated string')
  }
  function waarde() {
    spatie()
    const c = tekst[i]
    if (c === '{') {
      i++; spatie()
      const o = Object.create(null)
      if (tekst[i] === '}') { i++; return o }
      for (;;) {
        spatie()
        const k = tekenreeks()
        if (k in o) duplicate = true
        spatie(); if (tekst[i] !== ':') fout('expected ":"'); i++
        o[k] = waarde()
        spatie()
        if (tekst[i] === ',') { i++; continue }
        if (tekst[i] === '}') { i++; return o }
        fout('expected "," or "}"')
      }
    }
    if (c === '[') {
      i++; spatie()
      const a = []
      if (tekst[i] === ']') { i++; return a }
      for (;;) {
        a.push(waarde()); spatie()
        if (tekst[i] === ',') { i++; continue }
        if (tekst[i] === ']') { i++; return a }
        fout('expected "," or "]"')
      }
    }
    if (c === '"') return tekenreeks()
    const m = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(tekst.slice(i))
    if (!m) fout('unexpected token')
    i += m[0].length
    return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'null' ? null : Number(m[0])
  }
  const value = waarde()
  spatie()
  if (i !== tekst.length) fout('trailing characters')
  return { value, duplicate }
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
  const label = (m ? m[1] : 'utf-8').toLowerCase()
  // ISO-8859-1 maps byte for byte to the first 256 code points. The WHATWG label table maps that name to windows-1252,
  // which turns 0x80 into the euro sign: not what the declared charset says.
  if (label === 'iso-8859-1' || label === 'latin1' || label === 'l1' || label === 'iso_8859-1') return bytes.toString('latin1')
  return new TextDecoder(label, { fatal: true }).decode(bytes)
}

export function bodyDigest(raw) {
  const tekst = decodeBody(raw)
  const isJson = /^application\/(?:[\w.+-]*\+)?json\b/i.test(String(raw.contentType ?? '').trim())
  let canoniek = tekst
  if (isJson) {
    try {
      const { value, duplicate } = parseJsonStrict(tekst)
      if (!duplicate) canoniek = jcs(value)
    } catch { canoniek = tekst }
  }
  return createHash('sha256').update(canoniek, 'utf8').digest('hex')
}

/** The canonical members of a request wire form, ready to be hashed into an identity. Absent members are omitted. */
export function canonicalMembers(wire) {
  const leden = { method: String(wire.method ?? '').toUpperCase(), path: wire.path ?? '' }
  const query = canonicalQuery(wire.query)
  if (query !== '') leden.query = query
  if (wire.bodyBase64 !== undefined && wire.bodyBase64 !== '') leden.body = bodyDigest(wire)
  return leden
}
