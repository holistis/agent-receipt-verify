// Test voor de census en de steekproefkeuze, zonder netwerk.
//
// Waarom dit een test verdient en niet alleen een script is: de uitslag van deze
// twee functies wordt gepubliceerd als een cijfer over de wereld. Een telling die
// stil verkeerd telt is erger dan geen telling, want niemand ziet het aan de
// uitvoer. De gevallen hieronder zijn dan ook niet "doet hij iets", maar precies
// de vier manieren waarop een telling als deze scheef gaat:
//
//  1. de eenheid verschuift: tellen per resource in plaats van per host, waardoor
//     een partij met duizend paden duizend keer meeweegt.
//  2. de steekproefkeuze is niet navolgbaar: wie niet dezelfde hosts kiest kan
//     onze uitslag niet natrekken, en dan is het geen meting maar een bewering.
//  3. soorten "nee" lopen door elkaar: onbereikbaar, geweigerd verzoek en
//     gewoon-geen-x402 zijn drie verschillende dingen.
//  4. de methode wordt geraden: blind POST laat een GET-route zakken op een 405
//     die niets over x402 zegt.

import { censusPerHost, gedeclareerdeMethode } from '../src/x402-discovery-census.mjs'
import { kiesSteekproef, emmer, vulSjabloon } from '../src/x402-index-liveness.mjs'

let goed = 0
let fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '') ) }
}

const rec = (resource, offset, extra = {}) => ({ item: { resource, ...extra }, offset })

// ── 1. de eenheid: per host, niet per resource ───────────────────────────────
{
  const c = censusPerHost([
    rec('https://groot.example/a', 0),
    rec('https://groot.example/b', 1),
    rec('https://groot.example/c', 2),
    rec('https://klein.example/x', 3),
  ])
  toets('twee hosts uit vier resources', c.operators.length === 2, 'kreeg ' + c.operators.length)
  toets('grootste host staat vooraan', c.operators[0].host === 'groot.example')
  toets('registraties per host geteld', c.operators[0].aantalRegistraties === 3 && c.operators[1].aantalRegistraties === 1)
  // Exact 1, niet "hoogstens 2": een test met ruimte erin kan stil altijd groen
  // staan, en dan controleert hij niets. Standaardpoort en hoofdletters horen
  // dezelfde host te zijn, anders telt een partij twee keer mee.
  toets('poort en hoofdletters maken geen aparte host', censusPerHost([
    rec('https://a.example:443/x', 0),
    rec('https://A.EXAMPLE/y', 1),
  ]).operators.length === 1)
}

// ── 2. navolgbaarheid: laagste index-positie bepaalt de keuze ────────────────
{
  // Bewust in omgekeerde volgorde aangeleverd: als de functie gewoon de eerste
  // neemt die hij ziet in plaats van de laagste positie, valt dit door de mand.
  const c = censusPerHost([
    rec('https://h.example/laat', 900),
    rec('https://h.example/vroeg', 7),
    rec('https://h.example/midden', 400),
  ])
  const o = c.operators[0]
  toets('laagste positie wint, ongeacht aanlevervolgorde', o.eersteOffset === 7 && o.eersteResource.endsWith('/vroeg'),
    'kreeg offset ' + o.eersteOffset + ' / ' + o.eersteResource)
}
{
  const ops = Array.from({ length: 100 }, (_, i) => ({ host: 'h' + i + '.example', eersteOffset: i * 10, aantalRegistraties: 1 }))
  const a = kiesSteekproef(ops, 10)
  const b = kiesSteekproef(ops, 10)
  toets('steekproef is deterministisch', JSON.stringify(a) === JSON.stringify(b))
  toets('steekproef heeft de gevraagde grootte', a.length === 10, 'kreeg ' + a.length)
  toets('steekproef spant de hele volgorde', a[0].eersteOffset === 0 && a[a.length - 1].eersteOffset >= 900,
    'van ' + a[0].eersteOffset + ' tot ' + a[a.length - 1].eersteOffset)
  toets('niet simpelweg de eerste tien', a[1].eersteOffset !== 10, 'tweede is ' + a[1].eersteOffset)
  toets('meer gevraagd dan er is geeft alles, zonder lege plekken',
    kiesSteekproef(ops, 500).length === 100)
  toets('oplopend op positie, ook als de invoer dat niet is',
    kiesSteekproef([{ eersteOffset: 50 }, { eersteOffset: 5 }, { eersteOffset: 20 }], 3).map((o) => o.eersteOffset).join(',') === '5,20,50')
}

// ── 3. de soorten nee lopen niet door elkaar ──────────────────────────────────
{
  const g = (status, trede) => ({ bewijs: status === null ? {} : { status }, treden: trede === 0 ? { t0: 'HAALT' } : { t0: 'HAALT_NIET' } })
  toets('haalt trede 0 is x402_ok', emmer(g(402, 0)) === 'x402_ok')
  toets('geen status is onbereikbaar', emmer(g(null)) === 'onbereikbaar')
  toets('402 die zijn eisen niet meestuurt is apart', emmer(g(402)) === 'status_402_onbruikbaar')
  toets('405 is onze methodekeuze, geen x402-oordeel', emmer(g(405)) === 'methode_geweigerd')
  toets('401 en 403 zijn afgeschermd, niet afwezig', emmer(g(401)) === 'afgeschermd' && emmer(g(403)) === 'afgeschermd')
  toets('404 is het pad weg', emmer(g(404)) === 'pad_weg')
  toets('429 is tempo, geen eigenschap van het eindpunt', emmer(g(429)) === 'tempo_geweigerd')
  toets('500 is een serverfout, niet een nee', emmer(g(503)) === 'serverfout')
  toets('200 is gewoon geen betaalmuur', emmer(g(200)) === 'geen_betaalmuur')
  toets('een onbekende 4xx valt niet stil in geen_betaalmuur', emmer(g(418)) === 'verzoek_geweigerd')
}

// ── 4. de methode wordt gelezen, niet geraden ────────────────────────────────
{
  const m = (ext) => gedeclareerdeMethode({ extensions: ext })
  toets('leest de gedeclareerde methode', m({ bazaar: { info: { input: { method: 'GET' } } } }) === 'GET')
  toets('normaliseert naar hoofdletters', m({ bazaar: { info: { input: { method: ' post ' } } } }) === 'POST')
  toets('onbekende extensienaam werkt ook', m({ iets: { info: { input: { method: 'PUT' } } } }) === 'PUT')
  toets('geen declaratie geeft null, niet een gok', m({}) === null && gedeclareerdeMethode({}) === null)
  toets('onzin wordt niet als methode geaccepteerd', m({ bazaar: { info: { input: { method: 'DROP TABLE' } } } }) === null)
}

// ── offer-receipt en dubbele registraties ────────────────────────────────────
{
  const c = censusPerHost([
    rec('https://a.example/1', 0, { extensions: { bazaar: {} } }),
    rec('https://b.example/1', 1, { extensions: { 'offer-receipt': {} } }),
    rec('https://c.example/1', 2, { extensions: { offerReceipt: {} } }),
    rec('https://d.example/1', 3, {}),
    rec('https://a.example/1', 4, { extensions: { bazaar: {} } }),
    rec('niet eens een url', 5),
  ])
  const vind = (h) => c.operators.find((o) => o.host === h)
  toets('offer-receipt met streepje wordt gezien', vind('b.example').declareertOfferReceipt === true)
  toets('offerReceipt zonder streepje ook', vind('c.example').declareertOfferReceipt === true)
  toets('bazaar is geen offer-receipt', vind('a.example').declareertOfferReceipt === false)
  toets('geen extensies is geen fout', vind('d.example').declareertOfferReceipt === false)
  toets('dubbele resource wordt geteld, niet verzwegen', c.dubbeleResources === 1, 'kreeg ' + c.dubbeleResources)
  toets('onbruikbare url wordt geteld, niet stil weggegooid', c.zonderHost === 1, 'kreeg ' + c.zonderHost)
  toets('unieke resources telt de dubbele niet dubbel', c.uniekeResources === 4, 'kreeg ' + c.uniekeResources)
}

// ── 5. sjabloon-urls worden ingevuld, niet letterlijk opgevraagd ─────────────
{
  // De fout die dit vangt is echt gemaakt op 2026-10-17: ".../v1/ip/:ip" werd
  // letterlijk opgevraagd en de 400 die terugkwam zei niets over x402.
  const a = vulSjabloon('https://a.example/v1/ip/:ip', { ip: '8.8.8.8' })
  toets('padparameter wordt ingevuld', a.url === 'https://a.example/v1/ip/8.8.8.8', a.url)
  toets('en wordt gemeld als ingevuld', a.ingevuld.join(',') === 'ip' && a.resterend.length === 0)

  const b = vulSjabloon('https://a.example/x/:een/y/:twee', { een: '1', twee: '2' })
  toets('twee parameters tegelijk', b.url === 'https://a.example/x/1/y/2', b.url)

  const c = vulSjabloon('https://a.example/v1/ip/:ip', null)
  toets('zonder waarde blijft de url onaangeroerd', c.url === 'https://a.example/v1/ip/:ip')
  toets('en wat NIET ingevuld kon worden wordt gemeld, niet verzwegen', c.resterend.join(',') === 'ip')

  const d = vulSjabloon('https://a.example/gewoon/pad', { ip: '1' })
  toets('een url zonder sjabloon blijft gelijk', d.url === 'https://a.example/gewoon/pad' && d.ingevuld.length === 0)

  const e = vulSjabloon('https://a.example/p/:id', { id: 'a/b?c' })
  toets('een waarde wordt url-gecodeerd, niet rauw ingeplakt', e.url === 'https://a.example/p/a%2Fb%3Fc', e.url)

  // Het schema in de url (https:) mag nooit als parameter gelezen worden.
  const f = vulSjabloon('https://a.example:8443/p/:id', { id: '7' })
  toets('poort en schema worden niet als parameter gezien', f.url === 'https://a.example:8443/p/7', f.url)
}

console.log('')
console.log('census and sample: ' + goed + ' pass, ' + fout + ' fail')
if (fout > 0) process.exitCode = 1
