// The four extra pairs in vectors/attempt-identity-extra: rules the 22 frozen files leave open (deflate, the order of several
// encodings, the case of a charset name, a +json media type). They live in their own directory because the 22 are frozen
// (test/attempt-identity-bevroren.mjs) and are published elsewhere under the same count.
//
// This test needs no Python: it freezes the 8 files, checks the shape of the set, and hands the judge of interop/run-interop.mjs
// implementations that make exactly the mistake each pair exists to catch. The real two-implementation run is `npm run interop-extra`.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/attempt-identity-extra, 2026-11-20.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beoordeel, leesVectoren, nodeBerekening, tweeling } from '../interop/run-interop.mjs'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP = path.join(wortel, 'vectors', 'attempt-identity-extra')
const BEVROREN = {
  'known-answer-body-charset-name-is-case-insensitive-wrong.json': '1ec8d560afd01fefd701fdf96fd4303e9fd006aee2c5a6377eeff65b7c630bd3',
  'known-answer-body-charset-name-is-case-insensitive.json': '11bd6c1d74993bdeeec1d0154c67856a1db28c6ea5101ee2bc86cc732684eab8',
  'known-answer-body-content-encodings-reversed-in-order-wrong.json': '990a8a484c624892d179a7d199b9ba0fa5db704a43df79c652735a784fe620fa',
  'known-answer-body-content-encodings-reversed-in-order.json': '02156d4f2ce4343c36315732aaa4f6b9172cceffe2c31c492739dd9ebd3fe1c2',
  'known-answer-body-deflate-then-rfc8785-wrong.json': '0014471fdcfd440d6222a5311860fc04260f1f74410d47ebf6540d1a119ca691',
  'known-answer-body-deflate-then-rfc8785.json': 'ffce0637aabeb15e96dd8ec0351d718e7a68adfc9d4a9f1217b4a8ecfa573eaf',
  'known-answer-body-plus-json-media-type-is-json-wrong.json': '01f3a051c9ce97c2fce1d82e10b9ecde0051b1c1126ccebd3dec2f793c744636',
  'known-answer-body-plus-json-media-type-is-json.json': '01c1deb4a47f36f255e91fc8faab98e603ecfc3154db6030e1d30625b572fcb4',
}

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}
const sha = (tekst) => crypto.createHash('sha256').update(tekst.replace(/\r\n/g, '\n')).digest('hex')

console.log('the extra set is frozen')
const namen = fs.readdirSync(MAP).filter((f) => /^known-answer-.*\.json$/.test(f)).sort()
t('the directory holds exactly the 8 listed files', JSON.stringify(namen) === JSON.stringify(Object.keys(BEVROREN).sort()), namen.length + ' files')
for (const [naam, verwacht] of Object.entries(BEVROREN)) {
  const p = path.join(MAP, naam)
  if (!fs.existsSync(p)) { t(naam + ': exists', false, 'missing'); continue }
  const echt = sha(fs.readFileSync(p, 'utf8'))
  t(naam + ': unchanged', echt === verwacht, echt.slice(0, 12) + ' against ' + verwacht.slice(0, 12))
}
t('CONTROL: a copy with one space added has another hash', sha(fs.readFileSync(path.join(MAP, namen[0]), 'utf8') + ' ') !== BEVROREN[namen[0]])

console.log('')
console.log('the set has the shape the judge needs')
const vectoren = leesVectoren(MAP)
const rechts = [...vectoren].filter(([, { vec }]) => vec.expected.outcome === 'PASS')
t('4 right files and 4 wrong files', rechts.length === 4 && vectoren.size === 8)
t('every wrong file has its right twin', [...vectoren.keys()].every((n) => vectoren.has(tweeling(n))))
const node = new Map([...vectoren].map(([n, { vec }]) => [n, nodeBerekening(vec)]))
const alsPython = (f) => new Map([...node].map(([n, v]) => [n, f(n, v).map((x) => ({ ...x, reading: 'test reading' }))]))
const oordeel = (python) => beoordeel({ vectoren, berekeningen: { node, python }, kopieen: null, verwacht: 8 })
const tel = (u, regel) => u.fouten.filter((f) => f.rule === regel).length
t('two correct implementations: no violation', oordeel(alsPython((n, v) => v)).fouten.length === 0)

console.log('')
console.log('each pair catches the mistake it exists for')
const FOUTEN = {
  'body-deflate-then-rfc8785': 'a body that is decompressed but hashed without RFC 8785',
  'body-content-encodings-reversed-in-order': 'a body whose transmitted bytes are hashed',
  'body-charset-name-is-case-insensitive': 'an ISO-8859-1 body read as windows-1252',
  'body-plus-json-media-type-is-json': 'a +json body hashed as it was written',
}
for (const [naam, uitleg] of Object.entries(FOUTEN)) {
  const rechtsNaam = `known-answer-${naam}.json`
  const verkeerdNaam = `known-answer-${naam}-wrong.json`
  const foutWaarde = vectoren.get(verkeerdNaam).vec.input.known_answers[0].observed.body_sha256
  // the implementation that makes this mistake gives the wrong twin's value on both files
  const u = oordeel(alsPython((n, v) => (n === rechtsNaam || n === verkeerdNaam ? v.map((x) => ({ ...x, computed: foutWaarde })) : v)))
  t(`${uitleg}: R3 fires on the right file`, u.fouten.some((f) => f.rule === 'R3' && f.file === rechtsNaam))
  t(`${uitleg}: the two implementations disagree (R2)`, tel(u, 'R2') >= 1)
}
{
  const u = oordeel(alsPython((n, v) => v.map((x) => ({ ...x, computed: 'constant' }))))
  t('a constant implementation fails R3 on all 4 right files and R4 on all 4 wrong files', tel(u, 'R3') === 4 && tel(u, 'R4') === 4, `R3=${tel(u, 'R3')} R4=${tel(u, 'R4')}`)
}

console.log('')
console.log('attempt-identity-extra: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
