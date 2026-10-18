// Mutatie-toets op onze INAM-verifieerder: hoeveel verminkingen glippen erdoor?
//
// WAAROM DIT NODIG IS, en het is vandaag duur bewezen. Hun conformance-set heeft vijf
// gevallen. Wij stonden er 4 van 5 op, en de ene die we faalden was een valse goedkeuring
// die onze eigen testsuite nooit zou vinden, omdat die suite dezelfde vijf gevallen
// gebruikt. Vijf van vijf betekent dus: wij halen hun vijf. Het zegt niets over de zesde.
//
// DE METHODE. Neem de POSITIEVE vector, de enige die hoort te passeren, en verminkt hem
// systematisch: elk blad een andere waarde, elk veld weg, elk veld een ander type, de
// partijen omgewisseld, hashes afgekapt. Elke verminking die ONS verdict op accepted laat
// staan, is een gat. Niet een mogelijk gat, een gat: we keuren iets goed wat niet meer de
// ondertekende bon is.
//
// EN DE CONTROLEGROEP, want zonder die groep meet dit niets. Een paar verminkingen horen
// juist WEL geaccepteerd te blijven: een andere sleutelorde in de JSON, en hoofdletters in
// een hex-waarde. Wie die afkeurt is niet streng maar stuk, want dan verwerpt hij geldige
// bonnetjes van een andere implementatie. Een toets waarin alles moet falen kan dat niet
// zien, en dat is precies hoe een verifieerder te streng wordt zonder dat iemand het merkt.
//
// GEBRUIK
//   node bench/mutatie-inam.mjs <vectors.json>

import fs from 'node:fs'
import { toetsGeval } from '../src/inam-countersigned.mjs'

const PAD = process.argv[2]
if (!PAD) {
  console.error('usage: node bench/mutatie-inam.mjs <vectors.json>')
  process.exit(2)
}
const vectoren = JSON.parse(fs.readFileSync(PAD, 'utf8'))
const gevallen = Array.isArray(vectoren) ? vectoren : vectoren.vectors || vectoren.cases || []
const positief = gevallen.find((g) => /positive/i.test(g.id ?? g.name ?? ''))
if (!positief) {
  console.error('geen POSITIVE-vector gevonden, niets te muteren')
  process.exit(2)
}

// De positieve moet eerst passeren, anders meet elke mutatie hierna ruis in plaats van een
// gat. Dit is de positieve controle en hij staat met opzet VOORAAN.
const basis = toetsGeval(positief, vectoren)
if (!basis.accepted) {
  console.error('de POSITIEVE vector faalt al: ' + basis.failedChecks.join(','))
  console.error('eerst dat repareren, anders meet deze toets niets')
  process.exit(1)
}

const kopie = (x) => JSON.parse(JSON.stringify(x))

// Alle bladpaden van een object, zodat de mutaties niet uit mijn fantasie komen maar uit
// de echte vorm van het bonnetje. Wat ik zelf zou bedenken is precies wat ik al dek.
function bladpaden(obj, prefix = []) {
  const uit = []
  for (const [k, v] of Object.entries(obj ?? {})) {
    const pad = [...prefix, k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) uit.push(...bladpaden(v, pad))
    else uit.push({ pad, waarde: v })
  }
  return uit
}

const haal = (o, pad) => pad.reduce((a, k) => (a == null ? a : a[k]), o)
const zet = (o, pad, w) => {
  let a = o
  for (const k of pad.slice(0, -1)) a = a[k]
  a[pad.at(-1)] = w
  return o
}
const weg = (o, pad) => {
  let a = o
  for (const k of pad.slice(0, -1)) a = a[k]
  delete a[pad.at(-1)]
  return o
}

// Een geval bestaat uit een feedbackFile (JSON-STRING) en een onchainEvent. Een mutatie in
// het bestand moet dus door de string heen, en dat is zelf een valkuil: wie het object
// muteert en de string laat staan, muteert niets.
function mutantVanBestand(pad, nieuweWaarde, verwijder = false) {
  const g = kopie(positief)
  const f = JSON.parse(g.feedbackFile)
  if (verwijder) weg(f, pad)
  else zet(f, pad, nieuweWaarde)
  g.feedbackFile = JSON.stringify(f)
  return g
}

function mutantVanEvent(veld, nieuweWaarde) {
  const g = kopie(positief)
  g.onchainEvent = { ...g.onchainEvent, [veld]: nieuweWaarde }
  return g
}

const anders = (w) => {
  if (typeof w === 'number') return w + 1
  if (typeof w === 'boolean') return !w
  if (typeof w === 'string') {
    if (/^(sha256:|0x)/.test(w)) return w.slice(0, -4) + 'dead'
    if (/^\d{4}-\d{2}-\d{2}T/.test(w)) return '2030-01-01T00:00:00.000Z'
    return w + '-gewijzigd'
  }
  return 'gewijzigd'
}

const mutanten = []
const bestandObj = JSON.parse(positief.feedbackFile)

// 1. elk blad een andere waarde, en 2. elk blad weg
for (const { pad, waarde } of bladpaden(bestandObj)) {
  const naam = pad.join('.')
  mutanten.push({ naam: 'gewijzigd: ' + naam, geval: mutantVanBestand(pad, anders(waarde)), moetFalen: true })
  mutanten.push({ naam: 'verwijderd: ' + naam, geval: mutantVanBestand(pad, null, true), moetFalen: true })
  mutanten.push({ naam: 'type weg: ' + naam, geval: mutantVanBestand(pad, null), moetFalen: true })
}

// 3. het event, want dat is de kant die een aanvaller zelf kiest
for (const veld of Object.keys(positief.onchainEvent ?? {})) {
  mutanten.push({
    naam: 'event gewijzigd: ' + veld,
    geval: mutantVanEvent(veld, anders(positief.onchainEvent[veld])),
    moetFalen: true,
  })
}

// 4. de partijen omgewisseld. Een verifieerder die dit accepteert, kan niet zien wie wat
//    beweerde, en dat is de hele belofte van een tegengetekende bon.
{
  const g = kopie(positief)
  const f = JSON.parse(g.feedbackFile)
  const r = f?.inam?.receipt
  if (r?.agentA && r?.agentB) {
    const h = r.agentA
    r.agentA = r.agentB
    r.agentB = h
    g.feedbackFile = JSON.stringify(f)
    mutanten.push({ naam: 'partijen omgewisseld (agentA <-> agentB)', geval: g, moetFalen: true })
  }
}

// 5. de handtekeningen omgewisseld
{
  const g = kopie(positief)
  const f = JSON.parse(g.feedbackFile)
  const s = f?.inam?.receipt?.signatures
  if (s?.agentA && s?.agentB) {
    const h = s.agentA
    s.agentA = s.agentB
    s.agentB = h
    g.feedbackFile = JSON.stringify(f)
    mutanten.push({ naam: 'handtekeningen omgewisseld', geval: g, moetFalen: true })
  }
}

// ── DE CONTROLEGROEP: deze MOETEN geaccepteerd blijven ───────────────────────────────
// Zonder deze groep zou een verifieerder die alles afkeurt een perfecte score halen.
{
  // sleutels in omgekeerde orde, zelfde inhoud. De canonieke vorm hoort hier doorheen te
  // kijken, want een andere implementatie serialiseert in een andere orde.
  const g = kopie(positief)
  const f = JSON.parse(g.feedbackFile)
  const omgekeerd = (x) => {
    if (x === null || typeof x !== 'object') return x
    if (Array.isArray(x)) return x.map(omgekeerd)
    return Object.fromEntries(Object.keys(x).reverse().map((k) => [k, omgekeerd(x[k])]))
  }
  g.feedbackFile = JSON.stringify(omgekeerd(f))
  mutanten.push({ naam: 'CONTROLE: sleutels in omgekeerde orde', geval: g, moetFalen: false, hashGevoelig: true })
}
{
  // hoofdletters in de hex van het event. Een adres is niet casegevoelig, en wie hierop
  // afkeurt verwerpt geldige bonnetjes van iedereen die anders formatteert.
  const g = kopie(positief)
  const ev = { ...g.onchainEvent }
  for (const k of Object.keys(ev)) {
    if (typeof ev[k] === 'string' && /^0x[0-9a-f]+$/i.test(ev[k])) ev[k] = ev[k].toUpperCase().replace('0X', '0x')
  }
  g.onchainEvent = ev
  mutanten.push({ naam: 'CONTROLE: hex in hoofdletters in het event', geval: g, moetFalen: false })
}

// ── draaien ──────────────────────────────────────────────────────────────────────────
let gepakt = 0
let alleenHandtekening = 0
let inhoudelijk = 0
const doorheen = []
let controleGoed = 0
const controleFout = []

for (const m of mutanten) {
  let uit
  try {
    uit = toetsGeval(m.geval, vectoren)
  } catch (e) {
    // Een uitzondering is GEEN afkeuring. Een verifieerder die crasht op vreemde invoer
    // geeft geen uitspraak, en dat telt hier apart in plaats van als succes.
    uit = { accepted: null, failedChecks: ['CRASH: ' + String(e.message).slice(0, 60)] }
  }
  if (m.moetFalen) {
    if (uit.accepted === false) {
      gepakt++
      // TOEWIJZING, en dit is het deel dat de score pas betekenis geeft. Elke wijziging in
      // de ONDERTEKENDE inhoud breekt de handtekening, dus die check vangt bijna alles.
      // Bewezen: een andere check volledig uitzetten liet de score op 77 van 77 staan. Een
      // mutant die ALLEEN door een handtekening wordt gepakt, toetst de inhoudelijke checks
      // dus niet. De echte testruimte zijn de velden BUITEN de ondertekende inhoud, en daar
      // zat onze valse goedkeuring.
      const alleenSig = (uit.failedChecks ?? []).length > 0 && (uit.failedChecks ?? []).every((c) => /Signature|feedbackHash/i.test(c))
      if (alleenSig) alleenHandtekening++
      else inhoudelijk++
    }
    else doorheen.push({ naam: m.naam, verdict: uit.accepted, checks: uit.failedChecks })
  } else {
    // De omgekeerde-orde-controle verandert de BYTES van het bestand, en de feedbackHash
    // gaat over die bytes. Die mutant hoort dus wel te falen op de hash, maar NIET op de
    // canonieke velden eronder. Dat onderscheid wordt hier gemaakt in plaats van weggepoetst.
    const alleenHash = (uit.failedChecks ?? []).every((c) => /feedbackHash/i.test(c))
    if (uit.accepted === true || (m.hashGevoelig && alleenHash)) controleGoed++
    else controleFout.push({ naam: m.naam, checks: uit.failedChecks })
  }
}

const moetenFalen = mutanten.filter((m) => m.moetFalen).length
const controles = mutanten.length - moetenFalen

console.log('MUTATIE-TOETS op de INAM-verifieerder')
console.log('')
console.log('  mutanten die MOETEN falen : ' + moetenFalen)
console.log('  daarvan gepakt            : ' + gepakt)
console.log('  DOORHEEN GEGLIPT          : ' + doorheen.length + (doorheen.length ? '   <- dit zijn gaten' : ''))
console.log('')
console.log('  waarvan gepakt door een INHOUDELIJKE check : ' + inhoudelijk)
console.log('  waarvan ALLEEN door een handtekening/hash  : ' + alleenHandtekening + '   <- deze toetsen de inhoud NIET')
console.log('')
console.log('  controlegroep (moet passeren): ' + controles)
console.log('  daarvan correct doorgelaten  : ' + controleGoed)
console.log('  TE STRENG afgekeurd          : ' + controleFout.length)
console.log('')
if (doorheen.length) {
  console.log('de gaten, op naam:')
  for (const d of doorheen.slice(0, 40)) console.log('  ' + d.naam + '   (verdict ' + d.verdict + ')')
  if (doorheen.length > 40) console.log('  ... en nog ' + (doorheen.length - 40))
  console.log('')
}
if (controleFout.length) {
  console.log('te streng, op naam:')
  for (const c of controleFout) console.log('  ' + c.naam + '   faalde op [' + (c.checks ?? []).join(',') + ']')
  console.log('')
}
const score = moetenFalen ? ((gepakt / moetenFalen) * 100).toFixed(1) : '0'
console.log('mutatiescore: ' + score + '% gepakt, controlegroep ' + controleGoed + '/' + controles)
process.exitCode = doorheen.length === 0 && controleFout.length === 0 ? 0 : 1
