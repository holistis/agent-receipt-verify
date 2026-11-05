// De vectorset moet zichzelf meten: een weggehaalde, dubbele, gewijzigde of ontbrekende vector, een clausule zonder weigering
// en een lege map mogen de CLI niet laten slagen, en de zin "Every clause carries one acceptance and at least one refusal"
// mag alleen verschijnen als de dekking nu klopt. Gevonden door onze eigen mutatiematrix op 5 november 2026: tot dan
// gaven zeven van de eerste dertien van de rijen hieronder exit 0 en bleef de zin staan (de matrix heeft nu meer rijen).
//
// Deze toets draait die matrix elke keer opnieuw op een kopie van het pakket.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { meetDekking, vergelijkSuiteMetHashlijst, CLAUSULES } from '../src/attempt-identity.mjs'

const hier = path.dirname(fileURLToPath(import.meta.url))
const wortel = path.join(hier, '..')
let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

console.log('meetDekking')
{
  const vol = []
  for (const c of CLAUSULES) {
    vol.push({ bestand: c.id + '-p.json', v: { clause: c.id, expected: { outcome: 'PASS' } } })
    vol.push({ bestand: c.id + '-f.json', v: { clause: c.id, expected: { outcome: 'FAIL' } } })
  }
  t('een volledige set is volledig', meetDekking(vol).volledig === true)
  t('een lege set is niet volledig', meetDekking([]).volledig === false)
  const zonderAf = vol.filter((x) => x.bestand !== CLAUSULES[0].id + '-f.json')
  t('een clausule zonder weigering wordt genoemd', meetDekking(zonderAf).zonderAfkeuring.join() === CLAUSULES[0].id)
  const zonderGoed = vol.filter((x) => x.bestand !== CLAUSULES[1].id + '-p.json')
  t('een clausule zonder goedkeuring wordt genoemd', meetDekking(zonderGoed).zonderGoedkeuring.join() === CLAUSULES[1].id)
  t('een clausule zonder goedkeuring maakt de set onvolledig', meetDekking(zonderGoed).volledig === false)
  t('een clausule zonder weigering maakt de set onvolledig', meetDekking(zonderAf).volledig === false)
  t('een vector zonder clause-veld telt als fout', meetDekking([...vol, { bestand: 'x.json', v: { expected: { outcome: 'PASS' } } }]).volledig === false)
  t('een vector zonder expected telt als fout', meetDekking([...vol, { bestand: 'x.json', v: { clause: CLAUSULES[0].id } }]).volledig === false)
  t('een vector met een onbekende clausule telt als fout', meetDekking([...vol, { bestand: 'x.json', v: { clause: 'no-such-clause', expected: { outcome: 'FAIL' } } }]).onbekend.length === 1)
  t('de controle-vector met clause all en NOT_MEASURED is toegestaan', meetDekking([...vol, { bestand: 'all.json', v: { clause: 'all', expected: { outcome: 'NOT_MEASURED' } } }]).volledig === true)
  t('clause all met een andere uitkomst is niet toegestaan', meetDekking([...vol, { bestand: 'all.json', v: { clause: 'all', expected: { outcome: 'PASS' } } }]).volledig === false)
}

console.log('vergelijkSuiteMetHashlijst')
{
  const h = (c) => c.repeat(64)
  const goedeLijst = h('a') + '  one.json\n' + h('b') + ' *two.json\n'
  const hashVan = (b) => (b === 'one.json' ? h('a') : h('b'))
  const vergelijk = (bestanden, lijstTekst, hv = hashVan) => vergelijkSuiteMetHashlijst({ bestanden, lijstTekst, hashVan: hv })
  t('een kloppende lijst geeft geen problemen', vergelijk(['one.json', 'two.json'], goedeLijst).length === 0)
  t('een vector weg wordt gemeld', vergelijk(['one.json'], goedeLijst).some((p) => /two\.json is in SHA256SUMS but missing/.test(p)))
  t('een vector erbij wordt gemeld', vergelijk(['one.json', 'two.json', 'extra.json'], goedeLijst).some((p) => /extra\.json is not in SHA256SUMS/.test(p)))
  t('een gewijzigde vector wordt gemeld', vergelijk(['one.json', 'two.json'], goedeLijst, (b) => h('c')).length === 2)
  t('een lege lijst wordt gemeld', vergelijk(['one.json'], '').some((p) => /names no vectors/.test(p)))
  t('een onleesbare regel wordt gemeld', vergelijk(['one.json', 'two.json'], goedeLijst + 'rommel\n').some((p) => /unreadable line/.test(p)))
  t('een dubbele regel wordt gemeld', vergelijk(['one.json', 'two.json'], goedeLijst + h('a') + '  one.json\n').some((p) => /listed twice/.test(p)))
  t('CRLF-regeleinden en commentaarregels zijn toegestaan', vergelijk(['one.json', 'two.json'], '# lijst' + String.fromCharCode(13, 10) + goedeLijst.split('\n').join(String.fromCharCode(13, 10))).length === 0)
}

console.log('de lijst op schijf klopt met de vectoren')
{
  const r = spawnSync(process.execPath, [path.join(wortel, 'scripts', 'seal-attempt-identity-vectors.mjs'), '--check'], { encoding: 'utf8' })
  t('SHA256SUMS is actueel (node scripts/seal-attempt-identity-vectors.mjs schrijft hem opnieuw)', r.status === 0, (r.stdout || '').trim())
}

console.log('de matrix: elke weglating of wijziging laat de CLI falen')
const SKIP = (s) => s.split(path.sep).includes('.git') || s.split(path.sep).includes('node_modules')
function kopie() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arv-suite-'))
  fs.cpSync(wortel, d, { recursive: true, filter: (s) => !SKIP(s) })
  return d
}
const vdir = (d) => path.join(d, 'vectors', 'attempt-identity')
const namen = (d) => fs.readdirSync(vdir(d)).filter((f) => f.endsWith('.json')).sort()
const lees = (d, f) => JSON.parse(fs.readFileSync(path.join(vdir(d), f), 'utf8'))
const schrijf = (d, f, o) => fs.writeFileSync(path.join(vdir(d), f), typeof o === 'string' ? o : JSON.stringify(o, null, 2) + '\n')
const weg = (d, f) => fs.rmSync(path.join(vdir(d), f))
const draai = (d) => {
  const r = spawnSync(process.execPath, ['bin/cli.mjs', 'attempt-identity'], { cwd: d, encoding: 'utf8', timeout: 60000 })
  return { status: r.status, uit: r.stdout || '' }
}
const ZIN = /Every clause carries one acceptance and at least one refusal/

const basis = kopie()
const kaart = {}
for (const f of namen(basis)) { const v = lees(basis, f); const c = v.clause; kaart[c] ??= { PASS: [], FAIL: [], ANDERS: [] }; const o = v.expected.outcome; kaart[c][o === 'PASS' ? 'PASS' : o === 'FAIL' ? 'FAIL' : 'ANDERS'].push(f) }
const eenWeigering = Object.keys(kaart).find((c) => kaart[c].FAIL.length === 1 && kaart[c].PASS.length >= 1)
const eenGoedkeuring = Object.keys(kaart).find((c) => c !== eenWeigering && kaart[c].PASS.length === 1 && kaart[c].FAIL.length >= 1)
const eenGoed = namen(basis).find((f) => lees(basis, f).expected.outcome === 'PASS')
const eenAf = namen(basis).find((f) => lees(basis, f).expected.outcome === 'FAIL')
{
  const r = draai(basis)
  t('de onveranderde suite slaagt en toont de zin', r.status === 0 && ZIN.test(r.uit), 'exit ' + r.status)
}
// [naam, verandering, mag de zin verschijnen?]
const matrix = [
  ['een goedkeuring weg', (d) => weg(d, eenGoed), true],
  ['de ENIGE weigering van een clausule weg', (d) => weg(d, kaart[eenWeigering].FAIL[0]), false],
  ['de ENIGE goedkeuring van een clausule weg', (d) => weg(d, kaart[eenGoedkeuring].PASS[0]), false],
  ['de enige goedkeuring wordt een weigering', (d) => { const f = kaart[eenGoedkeuring].PASS[0]; const v = lees(d, f); v.expected = { outcome: 'FAIL' }; schrijf(d, f, v) }, false],
  ['alle vectoren van een clausule weg', (d) => { for (const k of ['PASS', 'FAIL', 'ANDERS']) for (const f of kaart[eenWeigering][k]) weg(d, f) }, false],
  ['alle vectoren weg', (d) => { for (const f of namen(d)) weg(d, f) }, false],
  ['een vector dubbel onder een andere naam', (d) => schrijf(d, 'extra-copy.json', fs.readFileSync(path.join(vdir(d), eenGoed), 'utf8')), true],
  ['de verwachte uitkomst omgedraaid', (d) => { const v = lees(d, eenAf); v.expected = { outcome: 'PASS' }; schrijf(d, eenAf, v) }, true],
  ['twee vectoren wisselen hun uitkomst', (d) => { const a = lees(d, eenGoed), b = lees(d, eenAf); const x = a.expected; a.expected = b.expected; b.expected = x; schrijf(d, eenGoed, a); schrijf(d, eenAf, b) }, true],
  ['een vector afgekapt', (d) => { const x = fs.readFileSync(path.join(vdir(d), eenGoed), 'utf8'); schrijf(d, eenGoed, x.slice(0, Math.floor(x.length / 2))) }, true],
  ['een vector leeg', (d) => schrijf(d, eenGoed, ''), true],
  ['een onbekende clausule', (d) => { const v = lees(d, eenAf); v.clause = 'no-such-clause'; schrijf(d, eenAf, v) }, false],
  ['een vector zonder clause-veld', (d) => { const v = lees(d, eenAf); delete v.clause; schrijf(d, eenAf, v) }, false],
  ['een vector zonder expected-blok', (d) => { const v = lees(d, eenAf); delete v.expected; schrijf(d, eenAf, v) }, true],
  ['de enige weigering wordt een goedkeuring', (d) => { const f = kaart[eenWeigering].FAIL[0]; const v = lees(d, f); v.expected = { outcome: 'PASS' }; schrijf(d, f, v) }, false],
  ['SHA256SUMS weg', (d) => fs.rmSync(path.join(vdir(d), 'SHA256SUMS')), true],
  ['SHA256SUMS is een map', (d) => { fs.rmSync(path.join(vdir(d), 'SHA256SUMS')); fs.mkdirSync(path.join(vdir(d), 'SHA256SUMS')) }, true],
  ['een vector is een map', (d) => { fs.rmSync(path.join(vdir(d), eenGoed)); fs.mkdirSync(path.join(vdir(d), eenGoed)) }, true],
]
for (const [naam, verander, zinMag] of matrix) {
  const d = kopie()
  try {
    verander(d)
    const r = draai(d)
    t(naam + ': de CLI faalt', r.status !== 0, 'exit ' + r.status)
    if (!zinMag) t(naam + ': de zin over de dekking verschijnt niet', !ZIN.test(r.uit))
    if (r.status !== 0) t(naam + ': de laatste regel zegt FAIL', /^FAIL:/m.test(r.uit.trim().split('\n').slice(-1)[0] || ''))
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
}
console.log('wat nog moet slagen en wat een stacktrace verbiedt')
{
  // eerst naar LF (een Windows-werkmap heeft al CRLF), dan naar CRLF, zodat er nooit een dubbele CR ontstaat
  const crlf = (b) => b.toString('utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).split(String.fromCharCode(10)).join(String.fromCharCode(13, 10))
  const d1 = kopie()
  try {
    fs.writeFileSync(path.join(vdir(d1), eenGoed), crlf(fs.readFileSync(path.join(vdir(d1), eenGoed))))
    const r = draai(d1)
    t('een vector met CRLF-regeleinden slaagt nog (een Windows-checkout)', r.status === 0, 'exit ' + r.status + ' ' + r.uit.slice(-200))
  } finally { fs.rmSync(d1, { recursive: true, force: true }) }
  const d2 = kopie()
  try {
    const lijst = path.join(vdir(d2), 'SHA256SUMS')
    fs.writeFileSync(lijst, crlf(fs.readFileSync(lijst)))
    const r = draai(d2)
    t('een SHA256SUMS met CRLF-regeleinden slaagt nog', r.status === 0, 'exit ' + r.status)
  } finally { fs.rmSync(d2, { recursive: true, force: true }) }
  for (const [naam, verander] of [['SHA256SUMS is een map', (d) => { fs.rmSync(path.join(vdir(d), 'SHA256SUMS')); fs.mkdirSync(path.join(vdir(d), 'SHA256SUMS')) }], ['een vector is een map', (d) => { fs.rmSync(path.join(vdir(d), eenGoed)); fs.mkdirSync(path.join(vdir(d), eenGoed)) }]]) {
    const d = kopie()
    try {
      verander(d)
      const r = spawnSync(process.execPath, ['bin/cli.mjs', 'attempt-identity'], { cwd: d, encoding: 'utf8', timeout: 60000 })
      t(naam + ': een nette PROBLEM-regel en geen stacktrace', /PROBLEM /.test(r.stdout || '') && !/at .*\.mjs:\d+/.test(r.stderr || ''), (r.stderr || '').split(String.fromCharCode(10))[0])
    } finally { fs.rmSync(d, { recursive: true, force: true }) }
  }
}

console.log('de telling in de README is gebonden aan de meting')
{
  const readme = fs.readFileSync(path.join(wortel, 'README.md'), 'utf8')
  const m = readme.match(/(\d+) vectors for x402 spec section 5\.5/)
  t('README.md noemt het aantal vectoren dat er echt staat', Boolean(m) && Number(m[1]) === namen(basis).length, (m ? m[1] : 'geen telling gevonden') + ' tegen ' + namen(basis).length)
}

console.log('de suite toont de reden van een FAIL en niet alleen de telling')
{
  const d = kopie()
  try {
    fs.rmSync(path.join(vdir(d), 'SHA256SUMS'))
    const r = spawnSync(process.execPath, ['bin/cli.mjs', 'suite'], { cwd: d, encoding: 'utf8', timeout: 120000 })
    t('suite zonder SHA256SUMS: exit 1 en de reden staat erbij', r.status === 1 && /PROBLEM SHA256SUMS is missing/.test(r.stdout || ''), 'exit ' + r.status)
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
}

fs.rmSync(basis, { recursive: true, force: true })

console.log('')
console.log('attempt-identity-suite-check: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
