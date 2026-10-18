// Toetst de omzetting naar de kanon-vorm, en vooral of hij EERLIJK is.
//
// WAAROM EEN TEST OP EEN OMZETTING. Een omzetting die stil iets verandert is erger dan
// geen omzetting: de ontvanger denkt onze vectoren te lezen en leest iets anders. Deze
// test vergelijkt daarom de sleutelverzameling met een ECHTE kanon-vector in plaats van
// met een lijst die wij zelf hebben opgeschreven, en toetst dat elke omgezette vector
// nog dezelfde uitslag krijgt van onze eigen loper.
//
// EN DE ENE REGEL DIE HET BELANGRIJKST IS. Een NOT_MEASURED-vector mag nooit een
// `valid`-veld krijgen. Dat veld op false zetten zou een eerlijke verkoper beschuldigen
// omdat onze eigen ketenlezing niet doorging, en dat is precies de fout die deze hele
// woordenlijst moet voorkomen. Die regel staat hier als harde toets, niet als notitie.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zetOm, naarExpected, laadBron, KANON_SCHEMA_VERSIE, BRONMAP, DOELMAP } from '../tools/naar-kanon-vorm.mjs'
import { beoordeelVector } from '../src/settlement-link-vectors.mjs'

let goed = 0, fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const WORTEL = fileURLToPath(new URL('..', import.meta.url))
const KANONMAP = path.join(WORTEL, 'vectors', 'kanon')

console.log('de vorm komt van HEN, niet van een lijst die wij hebben opgeschreven')

const hunBestanden = fs.existsSync(KANONMAP)
  ? fs.readdirSync(KANONMAP).filter((f) => f.endsWith('.json')).sort()
  : []
t('hun vectoren staan in de repo, dus de vorm is na te meten', hunBestanden.length >= 10,
  'aantal ' + hunBestanden.length)

const hunSleutels = new Set()
for (const f of hunBestanden) {
  for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(KANONMAP, f), 'utf8')))) hunSleutels.add(k)
}

// Twee velden die wij TOEVOEGEN, en ze staan hier met naam zodat een derde toevoeging
// niet stil kan binnenglippen. Beide zijn additief: een loper die ze niet kent negeert ze.
const ONZE_TOEVOEGINGEN = new Set(['verifies', 'requires_chain_read'])

const bron = laadBron()
t('er is bronmateriaal om om te zetten', bron.length >= 10, 'aantal ' + bron.length)

console.log('')
console.log('elke omgezette vector past in hun vorm, met alleen benoemde toevoegingen')

for (const { bestand, inhoud } of bron) {
  const om = zetOm(inhoud)
  if (!om) { t(bestand + ': is om te zetten', false, 'geen vertaling voor ' + String(inhoud?.expected?.outcome)); continue }
  const vreemd = Object.keys(om).filter((k) => !hunSleutels.has(k) && !ONZE_TOEVOEGINGEN.has(k))
  t(bestand + ': geen onbenoemd veld', vreemd.length === 0, vreemd.join(', '))
  t(bestand + ': hun schema-versie', om.schema_version === KANON_SCHEMA_VERSIE, String(om.schema_version))
  t(bestand + ': zegt welke as hij toetst', om.verifies === 'receipt-to-settlement', String(om.verifies))
}

console.log('')
console.log('de uitslag verandert niet door de omzetting')

for (const { bestand, inhoud } of bron) {
  const om = zetOm(inhoud)
  if (!om) continue
  const u = beoordeelVector(inhoud)
  if (u.outcome === 'SKIPPED') {
    // De ketenlezer kan hier niet gedraaid worden, en dat is precies waarom hij de
    // markering draagt. Dat is de toets.
    t(bestand + ': de overgeslagen vector draagt de ketenmarkering', om.requires_chain_read === true)
    continue
  }
  const verwachtCode = u.outcome
  t(bestand + ': de reason_code is onze eigen uitkomst', om.expected.reason_code === verwachtCode,
    om.expected.reason_code + ' vs ' + verwachtCode)
}

console.log('')
console.log('en de ene regel die het belangrijkst is')

{
  const nm = naarExpected({ outcome: 'NOT_MEASURED' })
  t('NOT_MEASURED krijgt GEEN valid-veld', !('valid' in nm), JSON.stringify(nm))
  t('en zegt in plaats daarvan dat het niet meetbaar was', nm.measurable === false)
  t('en legt uit waarom er geen valid staat', /blame an honest seller/.test(nm.note ?? ''))
}
{
  t('LINKED is valid true', naarExpected({ outcome: 'LINKED' }).valid === true)
  t('NOT_LINKED is valid false', naarExpected({ outcome: 'NOT_LINKED' }).valid === false)
  t('AMBIGUOUS is valid false, want een dubbele opening is geen link',
    naarExpected({ outcome: 'AMBIGUOUS' }).valid === false)
  t('een onbekende uitkomst wordt NIET verzonnen maar geweigerd',
    naarExpected({ outcome: 'IETS_NIEUWS' }) === null)
  t('en een leeg expected-blok ook', naarExpected(undefined) === null && naarExpected({}) === null)
}

console.log('')
console.log('het corpus op schijf is niet verouderd')

{
  // Een omzetting die alleen in het geheugen klopt en niet op schijf staat, is een
  // belofte. Dit toetst de bestanden die een vreemde werkelijk ophaalt.
  const opSchijf = fs.existsSync(DOELMAP)
    ? fs.readdirSync(DOELMAP).filter((f) => f.endsWith('.json')).sort()
    : []
  t('het omgezette corpus staat op schijf', opSchijf.length === bron.length,
    opSchijf.length + ' van ' + bron.length)
  let gelijk = 0
  for (const { bestand, inhoud } of bron) {
    const om = zetOm(inhoud)
    if (!om) continue
    const pad = path.join(DOELMAP, bestand)
    if (!fs.existsSync(pad)) continue
    if (fs.readFileSync(pad, 'utf8') === JSON.stringify(om, null, 2) + '\n') gelijk++
  }
  t('en is byte-identiek aan wat de omzetter nu zou schrijven', gelijk === bron.length,
    gelijk + ' van ' + bron.length)
}
{
  // Precies een vector hoort een RPC nodig te hebben. Worden dat er meer zonder dat
  // iemand het merkt, dan draait een vreemde ineens het netwerk op zonder waarschuwing.
  const metKeten = bron.filter((b) => b.inhoud.requires_chain_read).length
  t('precies een vector heeft een ketenlezing nodig', metKeten === 1, 'aantal ' + metKeten)
}

console.log('')
console.log('naar-kanon-vorm: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
