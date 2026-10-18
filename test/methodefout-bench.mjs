// Test voor de methodefout-benchmark, zonder netwerk.
//
// De twee gevallen die er echt toe doen zijn elkaars tegenpool. Een host die de meter
// alleen haalt DOORDAT hij een methode-herhaling doet, moet als gered geteld worden, want
// dat is precies de omvang van de oude fout. En een host die de meter afkeurt terwijl hij
// op GET wel 402 antwoordt, moet als RESTFOUT geteld worden, want dat is werk dat nog
// openstaat. Een benchmark die die twee op een hoop gooit, meet zijn eigen succes.
//
// Het derde geval is het gevaarlijkste: een host die terecht wordt afgekeurd mag NOOIT
// als restfout tellen, anders telt deze meter zijn eigen gelijk als een fout en loopt het
// cijfer vol met ruis.

import { benchmark, eenPerHost } from '../bench/methodefout.mjs'

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) {
    goed++
    console.log('  pass  ' + naam)
  } else {
    fout++
    console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : ''))
  }
}

const ACCEPTS = {
  scheme: 'exact',
  network: 'eip155:8453',
  maxAmountRequired: '1000',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x2888F36548a900B9b08d584524e1f73BC563eC26',
}

const antwoord = (status, { aanbod = false, allow = null } = {}) => {
  const h = new Map()
  if (allow) h.set('allow', allow)
  const lichaam = aanbod ? JSON.stringify({ accepts: [ACCEPTS] }) : ''
  return {
    status,
    headers: { keys: () => h.keys(), get: (k) => h.get(String(k).toLowerCase()) ?? null },
    text: async () => lichaam,
  }
}

/**
 * Een nagemaakte markt. Per host een regel die zegt wat POST en wat GET teruggeeft, zodat
 * elk van de vier uitkomsten precies een keer voorkomt en niets per ongeluk samenvalt.
 */
const markt = {
  'https://meteen.example/x': { POST: () => antwoord(402, { aanbod: true }) },
  'https://alleenget.example/x': {
    POST: () => antwoord(405, { allow: 'GET' }),
    GET: () => antwoord(402, { aanbod: true }),
  },
  'https://verboden.example/x': {
    // 403 op POST wordt NIET herhaald door de meter, want 403 zegt niets over de methode.
    // Toch antwoordt dit eindpunt op GET wel 402, dus dit is een echte restfout.
    POST: () => antwoord(403),
    GET: () => antwoord(402, { aanbod: true }),
  },
  'https://gratis.example/x': { POST: () => antwoord(200), GET: () => antwoord(200) },
  'https://weg.example/x': { POST: () => { throw new Error('fetch failed') }, GET: () => { throw new Error('fetch failed') } },
}

const nepMarkt = async (url, opties) => {
  const regel = markt[url]
  if (!regel) throw new Error('onbekende host in de nepmarkt: ' + url)
  const m = opties?.method || 'GET'
  const f = regel[m] ?? regel.GET ?? (() => antwoord(404))
  return f()
}

console.log('een host telt maar een keer, hoeveel paden hij ook heeft')
{
  const u = eenPerHost([
    'https://een.example/a',
    'https://een.example/b',
    'https://twee.example/a',
    'niet-een-url',
  ])
  t('twee hosts over uit vier regels', u.length === 2, JSON.stringify(u))
  t('en de eerste url per host wordt gehouden', u[0] === 'https://een.example/a')
  t('rommel wordt stil overgeslagen en breekt niets', !u.some((x) => x === 'niet-een-url'))
}

console.log('de vier uitkomsten vallen niet samen')
{
  const u = await benchmark(Object.keys(markt), { fetchImpl: nepMarkt, pauzeMs: 0 })
  t('vijf hosts gemeten', u.gemeten === 5, String(u.gemeten))
  t('twee halen trede 0', u.haaltL0 === 2, String(u.haaltL0))
  t('een daarvan alleen door de methode-herhaling', u.gereddenDoorHerhaling === 1, String(u.gereddenDoorHerhaling))
  t('de geredde host staat met naam in de uitslag', u.gered[0]?.url === 'https://alleenget.example/x', JSON.stringify(u.gered))
  t('en met de status die de eerste poging gaf', u.gered[0]?.eerste_status === 405, String(u.gered[0]?.eerste_status))

  t('de 403-host is een RESTFOUT, want hij antwoordt wel 402 op GET', u.restfout === 1, String(u.restfout))
  t('en staat met naam in de uitslag, want dit is het werk dat overblijft', u.rest[0]?.url === 'https://verboden.example/x', JSON.stringify(u.rest))

  t('de gratis host is TERECHT afgekeurd en geen restfout', u.terechtAfgekeurd === 1, String(u.terechtAfgekeurd))
  t('de onbereikbare host is ongemeten, niet afgekeurd', u.ongemeten === 1, String(u.ongemeten))

  t('wie echt om betaling vraagt is haalt-l0 plus restfout', u.vraagtEchtOmBetaling === 3, String(u.vraagtEchtOmBetaling))
  t('de foutmarge NU is de restfout gedeeld door die drie', u.restfoutPct === 33.3, String(u.restfoutPct))
  t(
    'de foutmarge ZONDER de herhaling is hoger, want dan was de geredde host ook fout',
    u.zonderHerhalingFoutPct === 66.7,
    String(u.zonderHerhalingFoutPct),
  )
}

console.log('een markt zonder fouten geeft nul, en dat moet ook kunnen')
{
  const schoon = { 'https://meteen.example/x': { POST: () => antwoord(402, { aanbod: true }) } }
  const nep = async (url, opties) => schoon[url][opties?.method || 'GET']()
  const u = await benchmark(Object.keys(schoon), { fetchImpl: nep, pauzeMs: 0 })
  t('nul restfout', u.restfout === 0)
  t('en de foutmarge is nul procent, niet null', u.restfoutPct === 0, String(u.restfoutPct))
  t('en niets is gered, want er was niets te redden', u.gereddenDoorHerhaling === 0)
}

console.log('een lege meting geeft GEEN nul procent')
{
  const u = await benchmark([], { fetchImpl: nepMarkt, pauzeMs: 0 })
  t('zonder hosts is de foutmarge niet te berekenen', u.restfoutPct === null, String(u.restfoutPct))
  t('en dat is iets anders dan nul', u.restfoutPct !== 0)
}

console.log('')
console.log('methodefout-bench: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
