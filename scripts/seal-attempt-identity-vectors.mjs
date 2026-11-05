#!/usr/bin/env node
// Schrijft vectors/attempt-identity/SHA256SUMS: een regel per vector, gesorteerd, hash over de bytes met CRLF naar LF.
// Draai dit na elke bewuste wijziging van de vectorset en commit het resultaat; de CLI (npx agent-receipt-verify attempt-identity)
// en de toets test/attempt-identity-suite-check.mjs vergelijken de map met deze lijst.
// Gebruik: node scripts/seal-attempt-identity-vectors.mjs [--check]     --check schrijft niets en faalt als de lijst niet klopt.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAP = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'attempt-identity')
const lf = (buf) => { const out = []; for (let i = 0; i < buf.length; i++) if (!(buf[i] === 13 && buf[i + 1] === 10)) out.push(buf[i]); return Buffer.from(out) }

export function maakLijst(map = MAP) {
  const namen = readdirSync(map).filter((b) => b.endsWith('.json')).sort()
  return namen.map((n) => createHash('sha256').update(lf(readFileSync(join(map, n)))).digest('hex') + '  ' + n).join('\n') + '\n'
}

if (process.argv[1] && process.argv[1].endsWith('seal-attempt-identity-vectors.mjs')) {
  const lijst = maakLijst()
  const pad = join(MAP, 'SHA256SUMS')
  if (process.argv.includes('--check')) {
    const huidig = existsSync(pad) ? readFileSync(pad, 'utf8').split(String.fromCharCode(13) + String.fromCharCode(10)).join('\n') : ''
    console.log(huidig === lijst ? 'SHA256SUMS klopt met de vectoren.' : 'SHA256SUMS klopt NIET met de vectoren; draai dit script zonder --check.')
    process.exit(huidig === lijst ? 0 : 1)
  }
  writeFileSync(pad, lijst)
  console.log('geschreven: ' + pad + ' (' + lijst.split('\n').filter(Boolean).length + ' vectoren)')
}
