// Tests the tester: interop/run-interop.mjs, the judge for the section 5.5 known-answer vectors.
// The judge is a pure function, so this test hands it WRONG implementations and damaged file sets and checks that the right rule fires.
// Nothing here needs Python: the real two-implementation run is `npm run interop`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beoordeel, leesVectoren, nodeBerekening, tweeling, velden } from '../interop/run-interop.mjs'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIG = leesVectoren(path.join(wortel, 'vectors', 'attempt-identity'))
const KOPIE = leesVectoren(path.join(wortel, 'interop', 'python', 'vectors'))

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const klon = (m) => new Map([...m].map(([n, { vec, bytes }]) => [n, { vec: structuredClone(vec), bytes: Buffer.from(bytes) }]))
const naarMap = (vectoren, f) => new Map([...vectoren].map(([n, { vec }]) => [n, f(vec, n)]))
const basis = () => {
  const vectoren = klon(ORIG)
  const node = naarMap(vectoren, (vec) => nodeBerekening(vec))
  const python = naarMap(vectoren, (vec, n) => node.get(n).map((x) => ({ ...x, reading: 'test reading' })))
  return { vectoren, berekeningen: { node, python }, kopieen: klon(KOPIE), verwacht: 22 }
}
const tel = (u, regel) => u.fouten.filter((f) => f.rule === regel).length
const regels = (u) => [...new Set(u.fouten.map((f) => f.rule))].sort().join(',')

const rechts = [...ORIG].filter(([, { vec }]) => vec.expected.outcome === 'PASS').length
const verkeerd = ORIG.size - rechts

// ---- de echte set
t('the published set is 22 files, 11 right and 11 wrong, every wrong file has its right twin',
  ORIG.size === 22 && rechts === 11 && verkeerd === 11 && [...ORIG.keys()].every((n) => ORIG.has(tweeling(n))))

// ---- basis: onze echte Node-implementatie tegen de echte bestanden, twee keer dezelfde uitkomst
{
  const u = beoordeel(basis())
  t('base case: our real Node implementation passes every rule on the real vectors, no violation', u.fouten.length === 0, JSON.stringify(u.fouten.slice(0, 2)))
  t('base case counts the field checks it did', u.controles === 22, String(u.controles))
}

// ---- de checker die niets uitrekent (vast getal): het gat dat de tweelingregel dicht
{
  const b = basis()
  b.berekeningen.python = naarMap(b.vectoren, (vec) => velden(vec).map(({ veld }) => ({ field: veld, computed: 'constant', reading: 'x' })))
  const u = beoordeel(b)
  // het gepubliceerde oordeel ("een FAIL-bestand slaagt zodra iets afwijkt") laat dit hele mutant op de 11 wrong-bestanden slagen
  const gepubliceerdOordeelSlaagt = [...b.vectoren].filter(([, { vec }]) => vec.expected.outcome === 'FAIL' && velden(vec).some(({ recorded }) => recorded !== 'constant')).length
  t('published verdict alone: a constant checker would pass all 11 wrong files (the gap)', gepubliceerdOordeelSlaagt === 11, String(gepubliceerdOordeelSlaagt))
  t('constant checker: the twin rule R4 catches it on all 11 wrong files', tel(u, 'R4') === 11, `R4=${tel(u, 'R4')}`)
  t('constant checker: R3 catches it on all 11 right files', tel(u, 'R3') === 11, `R3=${tel(u, 'R3')}`)
  t('constant checker: no file passes both twin-based rules', tel(u, 'R3') + tel(u, 'R4') === 22)
}

// ---- de checker die het record herhaalt ("looks fine")
{
  const b = basis()
  b.berekeningen.python = naarMap(b.vectoren, (vec) => velden(vec).map(({ veld, recorded }) => ({ field: veld, computed: recorded, reading: 'echo' })))
  const u = beoordeel(b)
  t('echo checker (repeats the record): right files pass R3, but R4 catches all 11 wrong files', tel(u, 'R3') === 0 && tel(u, 'R4') === 11, `R3=${tel(u, 'R3')} R4=${tel(u, 'R4')}`)
}

// ---- twee implementaties die het oneens zijn
{
  const b = basis()
  const eerste = [...b.vectoren.keys()][0]
  b.berekeningen.node.get(eerste)[0].computed = 'x'
  const u = beoordeel(b)
  t('one implementation changed on one field: R2 names the disagreement', tel(u, 'R2') === 1 && u.fouten.find((f) => f.rule === 'R2')?.file === eerste, regels(u))
  t('a disagreement report names the field, the recorded value and both computed values', (() => {
    const f = u.fouten.find((x) => x.rule === 'R2')
    return f && f.field && f.recorded !== undefined && f.node === 'x' && f.python !== undefined
  })())
}

// ---- een wrong-bestand dat eigenlijk niet fout is (R1)
{
  const b = basis()
  const naam = [...b.vectoren.keys()].find((n) => n.endsWith('-wrong.json'))
  const tw = b.vectoren.get(tweeling(naam))
  velden(b.vectoren.get(naam).vec).forEach(({ i, veld }) => { b.vectoren.get(naam).vec.input.known_answers[i].observed[veld] = tw.vec.input.known_answers[i].observed[veld] })
  const u = beoordeel(b)
  t('a wrong file whose value equals its right twin is caught by R1', tel(u, 'R1') >= 1, regels(u))
}

// ---- de set is niet compleet
{
  const b = basis()
  const rechtsNaam = [...b.vectoren.keys()].find((n) => !n.endsWith('-wrong.json'))
  b.vectoren.delete(rechtsNaam); b.berekeningen.node.delete(rechtsNaam); b.berekeningen.python.delete(rechtsNaam)
  const u = beoordeel(b)
  t('a right file removed: its wrong twin is reported without a twin (SET)', tel(u, 'SET') >= 1, regels(u))
}
{
  const b = basis()
  const verkeerdNaam = [...b.vectoren.keys()].find((n) => n.endsWith('-wrong.json'))
  b.vectoren.delete(verkeerdNaam); b.berekeningen.node.delete(verkeerdNaam); b.berekeningen.python.delete(verkeerdNaam)
  const u = beoordeel(b)
  t('a wrong file removed: its right twin is reported without a twin (SET)', tel(u, 'SET') >= 1, regels(u))
}
t('--expect=23 on 22 files is a SET violation', tel(beoordeel({ ...basis(), verwacht: 23 }), 'SET') === 1)
t('--expect=22 on 22 files is fine', tel(beoordeel({ ...basis(), verwacht: 22 }), 'SET') === 0)
{
  const b = basis()
  const n = [...b.vectoren.keys()][0]
  b.vectoren.get(n).vec.expected.outcome = 'FAILED'
  t('an outcome that is neither PASS nor FAIL is a SET violation', tel(beoordeel(b), 'SET') >= 1)
}

// ---- de kopieen (R5)
{
  const b = basis()
  const n = [...b.kopieen.keys()][3]
  b.kopieen.get(n).bytes[10] ^= 1
  t('a changed copy is caught by R5, exactly one', tel(beoordeel(b), 'R5') === 1)
}
{
  const b = basis()
  b.kopieen.delete([...b.kopieen.keys()][0])
  t('a missing copy is caught by R5', tel(beoordeel(b), 'R5') === 1)
}
{
  const b = basis()
  b.kopieen.set('known-answer-extra.json', { bytes: Buffer.from('{}') })
  t('a copy without an original is caught by R5', tel(beoordeel(b), 'R5') === 1)
}
{
  const b = basis()
  // first to LF (the checkout here may already be CRLF), then to CRLF
  for (const [n, k] of b.kopieen) b.kopieen.set(n, { bytes: Buffer.from(k.bytes.toString('utf8').replace(/\r?\n/g, '\r\n')) })
  t('copies with CRLF line endings (a Windows checkout) are still equal', tel(beoordeel(b), 'R5') === 0)
}
t('R5 is skipped only when no copies are given (null), never by an empty set', tel(beoordeel({ ...basis(), kopieen: new Map() }), 'R5') === 22 && tel(beoordeel({ ...basis(), kopieen: null }), 'R5') === 0)

// ---- uitlijning
{
  const b = basis()
  b.berekeningen.python.set([...b.vectoren.keys()][2], [])
  const u = beoordeel(b)
  t('an implementation that returns no fields for a file is an ALIGN violation', tel(u, 'ALIGN') === 1, regels(u))
}
{
  const b = basis()
  b.berekeningen.node.delete([...b.vectoren.keys()][2])
  t('an implementation that returns nothing for a file is an ALIGN violation', tel(beoordeel(b), 'ALIGN') === 1)
}

console.log(`\n${goed} pass, ${fout} fail`)
process.exit(fout ? 1 : 0)
