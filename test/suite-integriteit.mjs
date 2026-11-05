// Alle vectorsuites van dit pakket meten zichzelf (src/suite-integriteit.mjs): een weggehaalde, dubbele, gewijzigde of ontbrekende vector,
// een ontbrekende of onleesbare SHA256SUMS, een lege of ontbrekende map en een vector die het afspelen laat crashen laten het commando falen
// met een PROBLEM-regel en een FAIL-slotregel, zonder stacktrace. Gevonden met onze eigen mutatiematrix op 5 november 2026: in 0.2.25 gaf
// het weghalen van een vector uit vectors/kanon, vectors/settlement-link of vectors/grounding nog exit 0 en een telling van wat er overbleef.
// Deze toets draait de matrix elke keer opnieuw op een kopie van het pakket, voor attempt-identity, kanon, beleid, link-vectors en ground --vectors.
//
// attempt-identity heeft daarnaast een eigen, diepere toets (dekking per clausule): test/attempt-identity-suite-check.mjs.
// Let op: de kopie heeft geen node_modules, dus voor kanon bewijst deze toets de integriteit en niet het afspelen van de handtekeningen.
// beleid is een tabel en geen replay: een vector die kapot is gemaakt en daarna opnieuw verzegeld is, laat beleid met een stacktrace stoppen.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUITE_MAPPEN, controleerSuiteMap, crlfNaarLf, hashVanBytes, lijstVectoren, maakHashlijst, vergelijkSuiteMetHashlijst } from '../src/suite-integriteit.mjs'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}
const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13, 10)

console.log('controleerSuiteMap op een tijdelijke map')
function map(bestanden, { lijst = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-int-'))
  for (const [n, inhoud] of Object.entries(bestanden)) fs.writeFileSync(path.join(d, n), inhoud)
  if (lijst) fs.writeFileSync(path.join(d, 'SHA256SUMS'), maakHashlijst(d))
  return d
}
const ruim = (d) => fs.rmSync(d, { recursive: true, force: true })
{
  const base = { 'a.json': '{"a":1}' + LF, 'b.json': '{"b":2}' + LF }
  const d = map(base)
  t('een kloppende map heeft geen problemen', controleerSuiteMap(d).length === 0, controleerSuiteMap(d).join(' | '))
  fs.writeFileSync(path.join(d, 'extra.txt'), 'geen vector')
  t('een bestand dat niet op .json eindigt telt niet als vector', controleerSuiteMap(d).length === 0)
  t('lijstVectoren geeft alleen .json, gesorteerd', lijstVectoren(d).join() === 'a.json,b.json')
  fs.writeFileSync(path.join(d, 'c.json'), '{}' + LF)
  t('een extra vector wordt gemeld', controleerSuiteMap(d).some((p) => /c\.json is not in SHA256SUMS/.test(p)))
  fs.rmSync(path.join(d, 'c.json'))
  fs.rmSync(path.join(d, 'a.json'))
  t('een ontbrekende vector wordt gemeld', controleerSuiteMap(d).some((p) => /a\.json is in SHA256SUMS but missing/.test(p)))
  ruim(d)
  const w = map(base)
  fs.writeFileSync(path.join(w, 'b.json'), '{"b":3}' + LF)
  t('een gewijzigde vector wordt gemeld', controleerSuiteMap(w).some((p) => /b\.json does not match/.test(p)))
  ruim(w)
  const z = map(base, { lijst: false })
  t('een ontbrekende SHA256SUMS wordt gemeld', controleerSuiteMap(z).some((p) => /SHA256SUMS is missing/.test(p)))
  fs.mkdirSync(path.join(z, 'SHA256SUMS'))
  t('een map op de plek van SHA256SUMS geeft een nette melding', controleerSuiteMap(z).some((p) => /could not be read/.test(p)))
  ruim(z)
  const leeg = map({})
  t('een lege map wordt gemeld', controleerSuiteMap(leeg).some((p) => /no vectors found/.test(p)))
  ruim(leeg)
  t('een map die niet bestaat wordt gemeld', controleerSuiteMap(path.join(os.tmpdir(), 'bestaat-echt-niet-' + process.pid))[0].includes('could not be read'))
  const crlf = map({ 'a.json': '{"a":1}' + CRLF })
  fs.writeFileSync(path.join(crlf, 'SHA256SUMS'), hashVanBytes(Buffer.from('{"a":1}' + LF)) + '  a.json' + CRLF)
  t('CRLF in een vector of in de lijst geeft geen alarm', controleerSuiteMap(crlf).length === 0, controleerSuiteMap(crlf).join(' | '))
  ruim(crlf)
  t('een gewijzigde byte verstopt zich niet achter een tekstdecodering', hashVanBytes(Buffer.from([0x41, 0x80, 0x0a])) !== hashVanBytes(Buffer.from([0x41, 0xef, 0xbf, 0xbd, 0x0a])))
  t('crlfNaarLf haalt alleen CR voor LF weg', crlfNaarLf(Buffer.from([13, 10, 13, 13, 10])).equals(Buffer.from([10, 13, 10])))

  // De lijst zelf: formaat van sha256sum, dus commentaar, binaire markering, hoofdletters, BOM en dubbele regels moeten kloppen.
  const h = 'a'.repeat(64)
  const vgl = (lijstTekst, bestanden = ['x.json']) => vergelijkSuiteMetHashlijst({ bestanden, lijstTekst, hashVan: () => h })
  t('een regel die niet bestaat als hashregel wordt onleesbaar genoemd', vergelijkSuiteMetHashlijst({ bestanden: [], lijstTekst: 'rommel', hashVan: () => '' }).some((p) => /unreadable line/.test(p)))
  t('een naam die twee keer in de lijst staat wordt gemeld', vgl(h + '  x.json' + LF + h + '  x.json' + LF).some((p) => /x\.json is listed twice/.test(p)))
  t('een commentaarregel in de lijst wordt overgeslagen', vgl('# gezegeld op 5 november' + LF + h + '  x.json' + LF).length === 0)
  t('de binaire markering (hash *naam) wordt gelezen', vgl(h + ' *x.json' + LF).length === 0)
  t('een hash in hoofdletters wordt geaccepteerd, zoals sha256sum doet', vgl(h.toUpperCase() + '  x.json' + LF).length === 0)
  t('een BOM voorop de lijst wordt geaccepteerd', vgl(String.fromCharCode(0xfeff) + h + '  x.json' + LF).length === 0)
  t('een lijst met alleen commentaar meldt dat er geen vectoren in staan', vgl('# niets' + LF).some((p) => /SHA256SUMS names no vectors/.test(p)))
  t('een kort of verkeerd hexdeel is een onleesbare regel', vgl('abc  x.json' + LF).some((p) => /unreadable line/.test(p)))
  t('een lege regel in de lijst is geen fout', vgl(LF + h + '  x.json' + LF + LF).length === 0)
  t('een hash die met andere hoofdletters is geschreven maar anders is, valt nog op', vergelijkSuiteMetHashlijst({ bestanden: ['x.json'], lijstTekst: 'B'.repeat(64) + '  x.json', hashVan: () => h }).some((p) => /does not match/.test(p)))
}

console.log('de vier echte vectormappen kloppen met hun lijst')
for (const naam of SUITE_MAPPEN) {
  const p = controleerSuiteMap(path.join(wortel, 'vectors', naam))
  t(naam + ' heeft geen problemen', p.length === 0, p.join(' | '))
}

console.log('de matrix: elke weglating, wijziging of crash laat het commando falen')
const SKIP = (s) => s.split(path.sep).includes('.git') || s.split(path.sep).includes('node_modules')
const werk = fs.mkdtempSync(path.join(os.tmpdir(), 'arv-suites-'))
fs.cpSync(wortel, werk, { recursive: true, filter: (s) => !SKIP(s) })
const SUITES = [
  { naam: 'attempt-identity', cmd: ['attempt-identity'], dir: 'vectors/attempt-identity', crash: true },
  { naam: 'kanon', cmd: ['kanon'], dir: 'vectors/kanon', crash: true },
  { naam: 'beleid', cmd: ['beleid'], dir: 'vectors/kanon', crash: false },
  { naam: 'link-vectors', cmd: ['link-vectors'], dir: 'vectors/settlement-link', crash: true },
  { naam: 'ground --vectors', cmd: ['ground', '--vectors'], dir: 'vectors/grounding', crash: true },
]
const draai = (cmd) => {
  const r = spawnSync(process.execPath, ['bin/cli.mjs', ...cmd], { cwd: werk, encoding: 'utf8', timeout: 120000 })
  const uit = (r.stdout || '').split(LF).map((x) => x.trim()).filter(Boolean)
  return { status: r.status, laatste: uit[uit.length - 1] || '', uit: r.stdout || '', fout: r.stderr || '' }
}
const seal = (...args) => spawnSync(process.execPath, ['scripts/seal-vectors.mjs', ...args], { cwd: werk, encoding: 'utf8', timeout: 60000 })
const jsons = (dir) => fs.readdirSync(path.join(werk, dir)).filter((f) => f.endsWith('.json')).sort()
const pad = (dir, naam) => path.join(werk, dir, naam)
// Elke mislukking moet dezelfde drie dingen laten zien: de reden, de slotregel en geen stacktrace.
const eisFout = (label, r, bestand) => {
  t(label + ': het commando faalt', r.status !== 0, 'exit ' + r.status)
  t(label + ': een PROBLEM-regel zegt wat er mis is', /^PROBLEM /m.test(r.uit), r.uit.split(LF).slice(-3).join(' | ').slice(0, 100))
  t(label + ': de laatste regel zegt dat de suite niet bewezen heel is', r.laatste.startsWith('FAIL: this run does not show that the suite is intact and passing'), r.laatste.slice(0, 80))
  t(label + ': geen stacktrace', !/\bat .*\.mjs:\d+/.test(r.fout), (r.fout.split(LF)[0] || '').slice(0, 80))
  if (bestand) t(label + ': een PROBLEM-regel noemt het bestand', r.uit.split(LF).some((x) => x.startsWith('PROBLEM ') && x.includes(bestand)), r.uit.split(LF).filter((x) => x.startsWith('PROBLEM ')).join(' | ').slice(0, 120))
}
const MUT = [
  ['een vector weg', (dir) => fs.rmSync(pad(dir, jsons(dir)[0]))],
  ['alle vectoren weg', (dir) => { for (const f of jsons(dir)) fs.rmSync(pad(dir, f)) }],
  ['een vector dubbel onder een andere naam', (dir) => fs.copyFileSync(pad(dir, jsons(dir)[0]), pad(dir, 'extra-copy.json'))],
  ['een vector gewijzigd (nog geldige JSON)', (dir) => { const f = pad(dir, jsons(dir)[0]); fs.writeFileSync(f, fs.readFileSync(f, 'utf8') + ' ' + LF) }],
  ['SHA256SUMS weg', (dir) => fs.rmSync(pad(dir, 'SHA256SUMS'))],
  ['SHA256SUMS is een map', (dir) => { fs.rmSync(pad(dir, 'SHA256SUMS')); fs.mkdirSync(pad(dir, 'SHA256SUMS')) }],
  ['de hele map weg', (dir) => fs.rmSync(path.join(werk, dir), { recursive: true })],
  ['een submap die op .json eindigt', (dir) => fs.mkdirSync(pad(dir, 'zzz-submap.json'))],
]
// Een verwachting omgedraaid en opnieuw verzegeld: de integriteit is in orde, het afspelen zelf faalt.
const leesJson = (dir, f) => JSON.parse(fs.readFileSync(pad(dir, f), 'utf8'))
const schrijfJson = (dir, f, v) => fs.writeFileSync(pad(dir, f), JSON.stringify(v, null, 1) + LF)
const OMDRAAIEN = {
  'attempt-identity': (dir) => { const f = jsons(dir)[0]; const v = leesJson(dir, f); v.expected.outcome = v.expected.outcome === 'PASS' ? 'FAIL' : 'PASS'; schrijfJson(dir, f, v) },
  kanon: (dir, basis) => { const f = jsons(dir).find((n) => basis.uit.split(LF).some((r) => /^agree\s/.test(r.trim()) && r.includes(leesJson(dir, n).id))); const v = leesJson(dir, f); v.expected.valid = !v.expected.valid; schrijfJson(dir, f, v) },
  'link-vectors': (dir) => { const f = jsons(dir).find((n) => { const v = leesJson(dir, n); return !v.requires_chain_read && v.expected && v.expected.outcome }); const v = leesJson(dir, f); v.expected.outcome = v.expected.outcome === 'LINKED' ? 'NOT_LINKED' : 'LINKED'; schrijfJson(dir, f, v) },
  'ground --vectors': (dir) => { const f = jsons(dir)[0]; const v = leesJson(dir, f); const k = Object.keys(v.oordeelVanEenAnder.verwacht)[0]; v.oordeelVanEenAnder.verwacht[k] = 'X'; schrijfJson(dir, f, v) },
}
// Kapotte vectoren die daarna opnieuw verzegeld zijn: dan meldt de integriteit niets en moet de crash zelf netjes worden gemeld.
const KAPOT = [
  ['een vector afgekapt en opnieuw verzegeld', (f) => { const x = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, x.slice(0, Math.floor(x.length / 2))) }],
  ['een vector leeggemaakt en opnieuw verzegeld', (f) => fs.writeFileSync(f, '')],
  ['een vector vervangen door {} en opnieuw verzegeld', (f) => fs.writeFileSync(f, '{}'), true],
  ['een vector vervangen door null en opnieuw verzegeld', (f) => fs.writeFileSync(f, 'null'), true],
]
for (const s of SUITES) {
  const reservekopie = path.join(werk, '..', 'reserve-' + path.basename(werk) + '-' + s.naam.replace(/\W+/g, '-'))
  fs.cpSync(path.join(werk, s.dir), reservekopie, { recursive: true })
  const herstel = () => { fs.rmSync(path.join(werk, s.dir), { recursive: true, force: true }); fs.cpSync(reservekopie, path.join(werk, s.dir), { recursive: true }) }
  const basis = draai(s.cmd)
  t(s.naam + ': de onveranderde suite slaagt', basis.status === 0, 'exit ' + basis.status + ' ' + basis.laatste)
  for (const [naam, verander] of MUT) {
    verander(s.dir)
    eisFout(s.naam + ' / ' + naam, draai(s.cmd))
    herstel()
  }
  if (s.crash) {
    for (const [naam, maak, geldigeJson] of KAPOT) {
      // Zonder ethers (de kopie heeft geen node_modules) telt een vector die geldige JSON is maar niets bevat bij kanon als niet gemeten, niet als crash.
      if (s.naam === 'kanon' && geldigeJson) continue
      const kapotBestand = jsons(s.dir)[0]
      maak(pad(s.dir, kapotBestand))
      const gezegeld = seal()
      t(s.naam + ' / ' + naam + ': het seal-script schrijft de lijst', gezegeld.status === 0, (gezegeld.stderr || '').split(LF)[0])
      eisFout(s.naam + ' / ' + naam, draai(s.cmd), kapotBestand)
      herstel()
    }
  }
  if (OMDRAAIEN[s.naam]) {
    OMDRAAIEN[s.naam](s.dir, basis)
    seal()
    const omgedraaid = draai(s.cmd)
    t(s.naam + ' / een verwachting omgedraaid en opnieuw verzegeld: het afspelen faalt', omgedraaid.status === 1, 'exit ' + omgedraaid.status + ' ' + omgedraaid.laatste.slice(0, 60))
    if (s.naam === 'attempt-identity') t(s.naam + ' / een verwachting omgedraaid en opnieuw verzegeld: de laatste regel is de FAIL-slotregel', omgedraaid.laatste.startsWith('FAIL: this run does not show that the suite is intact and passing'), omgedraaid.laatste.slice(0, 80))
    herstel()
  }
  // een Windows-checkout (CRLF) mag niet falen
  const eerste = pad(s.dir, jsons(s.dir)[0])
  fs.writeFileSync(eerste, fs.readFileSync(eerste, 'utf8').split(CRLF).join(LF).split(LF).join(CRLF))
  const crlf = draai(s.cmd)
  t(s.naam + ': een vector met CRLF-regeleinden slaagt nog', crlf.status === basis.status, 'exit ' + crlf.status)
  herstel()
  // De grens die de README noemt: een vector samen met zijn eigen regel aanpassen is van binnenuit niet te zien.
  fs.writeFileSync(eerste, fs.readFileSync(eerste, 'utf8') + ' ' + LF)
  seal()
  const samen = draai(s.cmd)
  t(s.naam + ': vector en regel samen aanpassen valt niet op (de grens uit de README)', samen.status === basis.status, 'exit ' + samen.status)
  herstel()
  // Het seal-script zegt wat er veranderde en laat geen tijdelijk bestand achter.
  const weg = jsons(s.dir)[0]
  fs.rmSync(pad(s.dir, weg))
  const controle = seal('--check')
  t(s.naam + ': seal --check faalt als een vector weg is en noemt de map', controle.status === 1 && controle.stdout.includes('KLOPT NIET ' + path.basename(s.dir)), controle.stdout.trim().slice(0, 100))
  const schrijf = seal()
  t(s.naam + ': het seal-script noemt de vector die weg is', schrijf.stdout.includes('weg: ' + weg), schrijf.stdout.trim().slice(0, 120))
  t(s.naam + ': na het verzegelen klopt seal --check weer', seal('--check').status === 0)
  t(s.naam + ': het seal-script laat geen tijdelijk bestand achter', !fs.existsSync(pad(s.dir, 'SHA256SUMS.tmp')))
  herstel()
  fs.rmSync(reservekopie, { recursive: true, force: true })
}
fs.rmSync(werk, { recursive: true, force: true })

console.log('geen commando leest een vectormap zonder de controle')
{
  // tools/ bouwt vectoren of zet ze om en speelt ze niet af; alleen bin, src en bench bevatten commando's die een vectormap lezen.
  const EXCEPTIES = { 'bench/ground-record.mjs': 'schrijft een nieuwe opname en herinnert aan scripts/seal-vectors.mjs' }
  const RAAKT = /vectors['"`/,\s]+(attempt-identity|kanon|settlement-link|grounding)\b/
  t('de scan kent alle vier de vectormappen', SUITE_MAPPEN.every((n) => RAAKT.source.includes(n)))
  const bestanden = ['bin', 'src', 'bench'].flatMap((d) => fs.readdirSync(path.join(wortel, d)).filter((f) => f.endsWith('.mjs')).map((f) => d + '/' + f))
  const tekst = (f) => fs.readFileSync(path.join(wortel, f), 'utf8')
  const lezers = bestanden.filter((f) => RAAKT.test(tekst(f)))
  t('de scan vindt de bekende lezers', lezers.length >= 5, lezers.join(', '))
  for (const f of lezers) {
    if (EXCEPTIES[f]) continue
    const x = tekst(f)
    t(f + ' leest een vectormap en draait de controle', x.includes("from './suite-integriteit.mjs'") || x.includes("from '../src/suite-integriteit.mjs'"), 'importeert suite-integriteit niet')
    t(f + ' roept de controle ook aan', /controleerSuiteMap|draaiMetIntegriteit/.test(x.replace(/import[^\n]*\n/g, '')), 'roept controleerSuiteMap of draaiMetIntegriteit niet aan')
  }
  for (const f of Object.keys(EXCEPTIES)) t(f + ' (uitzondering) leest nog steeds een vectormap, dus de uitzondering is niet verouderd', lezers.includes(f))
}

console.log('de uitleg en de bestanden zijn gebonden aan de meting')
{
  const lees = (f) => fs.readFileSync(path.join(wortel, f), 'utf8')
  const link = spawnSync(process.execPath, ['bin/cli.mjs', 'link-vectors'], { cwd: wortel, encoding: 'utf8', timeout: 120000 }).stdout || ''
  const m = link.match(/(\d+) agree, (\d+) disagree, (\d+) skipped/)
  const totaal = m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : -1
  const offline = m ? Number(m[1]) + Number(m[2]) : -1
  const help = lees('bin/cli.mjs')
  t('de helptekst van link-vectors noemt het aantal vectoren dat er echt is', new RegExp(totaal + ' vectors for the half AFTER paying').test(help), 'gemeten ' + totaal)
  t('de helptekst van link-vectors noemt het aantal dat offline draait', new RegExp('that one settlement\\? ' + offline + ' run offline').test(help), 'gemeten ' + offline)
  t('README.md noemt hetzelfde aantal voor link-vectors', new RegExp(totaal + ' vectors \\(' + offline + ' offline\\)').test(lees('README.md')))
  const readme = lees('README.md')
  t('README.md noemt alle vijf de commando\'s die een vectormap controleren', ['attempt-identity', 'kanon', 'beleid', 'link-vectors', 'ground --vectors'].every((c) => readme.includes(c)))
  t('README.md noemt het seal-script, dat in de repository staat', readme.includes('scripts/seal-vectors.mjs') && fs.existsSync(path.join(wortel, 'scripts', 'seal-vectors.mjs')))
  const attrs = fs.existsSync(path.join(wortel, '.gitattributes')) ? lees('.gitattributes') : ''
  t('.gitattributes houdt de vectoren en lijsten op LF, zodat sha256sum overal hetzelfde ziet', attrs.includes('vectors/**/*.json text eol=lf') && attrs.includes('vectors/*/SHA256SUMS text eol=lf'))
}

console.log('')
console.log('suite-integriteit: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
