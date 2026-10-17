// BENCHMARK: kan onze verifieerder voor de gek gehouden worden, en kunnen wij zelf
// een geldig tegengetekend bonnetje maken?
//
// WAAROM DIT APART VAN DE TESTS STAAT. De tests tonen aan dat wij op de vier
// gepubliceerde vectoren hetzelfde oordeel geven als hun eigen verifieerder. Dat is
// correctheid, en correctheid is niet hetzelfde als POSITIE. Een controle die alles
// goedkeurt geeft op vier vectoren precies dezelfde uitslag als een goede controle,
// zolang drie van die vier negatief zijn en hij per ongeluk de juiste reden noemt.
//
// Deze benchmark meet daarom twee dingen die de vectoren niet kunnen meten:
//
//  1. PRECISIE ONDER AANVAL. Neem het POSITIEVE geval en verander er systematisch
//     een ding in. Elke mutatie MOET afgekeurd worden. Een mutatie die we
//     goedkeuren is geen cosmetisch gebrek maar precies het gat waardoor een
//     vervalst bonnetje erdoor komt, en dat is het enige dat deze verifieerder te
//     verkopen heeft.
//
//  2. KUNNEN WIJ TEGENPARTIJ ZIJN. De onderhouder van INAM vroeg of wij de
//     tegenpartij willen zijn op een echt bonnetje. Dat beloven zonder te weten of
//     wij er zelf een kunnen maken en ondertekenen, is een belofte op krediet. Dit
//     deel bouwt er een, met eigen sleutels, en laat onze eigen verifieerder erover
//     oordelen. Lukt dat niet, dan is het antwoord nee en weten we dat nu.
//
// Geen netwerk, geen sleutel van de koning, alleen node-ingebouwde crypto.

import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { canoniek, toetsGeval } from '../src/inam-countersigned.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const suite = JSON.parse(readFileSync(join(HIER, '..', 'vectors', 'inam', 'vectors.json'), 'utf8'))
const positief = suite.cases.find((c) => c.id === 'POSITIVE')
if (!positief) {
  console.error('geen POSITIVE-vector gevonden, deze benchmark heeft er een nodig')
  process.exit(2)
}

const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

// ── deel 1: precisie onder aanval ────────────────────────────────────────────

/** Maak een kopie van het geval met een mutatie in het ondertekende bestand. */
function muteer(naam, fn) {
  const f = JSON.parse(positief.feedbackFile)
  fn(f)
  return { naam, geval: { ...positief, feedbackFile: JSON.stringify(f) } }
}

const eersteTeken = (s) => (s[0] === 'a' ? 'b' : 'a') + s.slice(1)

const mutaties = [
  muteer('handtekening van de aanvrager omgedraaid', (f) => {
    f.inam.receipt.signatures.agentA = eersteTeken(f.inam.receipt.signatures.agentA)
  }),
  muteer('handtekening van de uitvoerder omgedraaid', (f) => {
    f.inam.receipt.signatures.agentB = eersteTeken(f.inam.receipt.signatures.agentB)
  }),
  muteer('beide handtekeningen weg', (f) => {
    f.inam.receipt.signatures = {}
  }),
  muteer('de uitvoer-hash veranderd', (f) => {
    f.inam.receipt.result.outputHash = 'sha256:' + '0'.repeat(64)
  }),
  muteer('de opdracht-hash veranderd', (f) => {
    f.inam.receipt.task.specHash = 'sha256:' + '0'.repeat(64)
  }),
  muteer('het bonnetje-kenmerk veranderd', (f) => {
    f.inam.receipt.receiptId = 'sha256:' + '1'.repeat(64)
  }),
  muteer('de opdracht-naam veranderd', (f) => {
    f.inam.receipt.jobId = 'http:iets-anders'
  }),
  muteer('de aanvrager vervangen door een ander adres', (f) => {
    f.clientAddress = 'eip155:8453:0x9999999999999999999999999999999999999999'
  }),
  muteer('de waarde opgeschroefd', (f) => {
    f.value = 999
  }),
  muteer('de uitvoerder vervangen door de aanvrager', (f) => {
    f.inam.receipt.agentB = { ...f.inam.receipt.agentA, role: 'worker' }
  }),
  muteer('een veld toegevoegd aan de ondertekende inhoud', (f) => {
    f.inam.receipt.task.extra = 'ik was hier'
  }),
  muteer('de rol van de aanvrager omgedraaid', (f) => {
    f.inam.receipt.agentA.role = 'worker'
  }),
]

console.log('DEEL 1: precisie onder aanval')
console.log('  Elke mutatie van ondertekende inhoud MOET afgekeurd worden.')
console.log('')

// Eerst de controle dat het onveranderde geval wel wordt geaccepteerd. Zonder die
// regel meet deel 1 niets: een verifieerder die alles afkeurt haalt hier anders
// een perfecte score.
const basis = toetsGeval(positief, suite)
console.log('  basislijn, onveranderd: ' + (basis.accepted ? 'GEACCEPTEERD (goed)' : 'AFGEKEURD op ' + basis.failedChecks.join(',') + ' (FOUT, dan meet de rest niets)'))

let afgekeurd = 0
let doorgelaten = 0
let alleenBytes = 0

// De byte-hash (feedbackHashMatchesFile) faalt bij ELKE mutatie, want het bestand is
// opnieuw geserialiseerd. Dat maakt 12 van 12 een misleidend cijfer: het zegt niet of
// de INHOUDELIJKE controles de mutatie pakken. Wie dat onderscheid niet maakt, meet
// zijn eigen serialisatie in plaats van zijn verifieerder. Daarom wordt die ene check
// hier apart gezet en geteld hoeveel mutaties ALLEEN daardoor sneuvelen.
const BYTE_CHECK = 'feedbackHashMatchesFile'

for (const m of mutaties) {
  let uit
  try {
    uit = toetsGeval(m.geval, suite)
  } catch (e) {
    uit = { accepted: false, failedChecks: ['wierp een fout: ' + String(e.message).slice(0, 40)] }
  }
  const inhoudelijk = uit.failedChecks.filter((c) => c !== BYTE_CHECK)
  if (uit.accepted) {
    doorgelaten++
    console.log('  DOORGELATEN      ' + m.naam + '  <- dit is een gat')
  } else if (inhoudelijk.length === 0) {
    alleenBytes++
    console.log('  alleen bytes     ' + m.naam + '  <- geen inhoudelijke controle pakt dit')
  } else {
    afgekeurd++
    console.log('  inhoudelijk      ' + m.naam + '  (' + inhoudelijk.slice(0, 3).join(', ') + ')')
  }
}
console.log('')
console.log('  ' + afgekeurd + ' van ' + mutaties.length + ' mutaties door een INHOUDELIJKE controle gepakt')
console.log('  ' + alleenBytes + ' alleen door de byte-hash, ' + doorgelaten + ' helemaal doorgelaten')
if (alleenBytes > 0) {
  console.log('')
  console.log('  Let op wat dat betekent. De byte-hash vergelijkt het bestand met een hash in een')
  console.log('  on-chain gebeurtenis. Waar die gebeurtenis er niet is, of waar dezelfde partij')
  console.log('  beide kan zetten, is die controle geen bescherming. Een mutatie die alleen daar')
  console.log('  op sneuvelt, komt in zo een geval dus wel door.')
}

// ── deel 2: kunnen wij tegenpartij zijn ──────────────────────────────────────

console.log('')
console.log('DEEL 2: kunnen wij zelf een tegengetekend bonnetje maken')

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58encode(buf) {
  let getal = 0n
  for (const b of buf) getal = getal * 256n + BigInt(b)
  let uit = ''
  while (getal > 0n) {
    uit = B58[Number(getal % 58n)] + uit
    getal /= 58n
  }
  for (const b of buf) {
    if (b === 0) uit = '1' + uit
    else break
  }
  return uit
}

/** did:key voor een ed25519 publieke sleutel, multicodec 0xed01. */
function didKey(publiek) {
  const raw = publiek.export({ format: 'der', type: 'spki' }).subarray(-32)
  return 'did:key:z' + base58encode(Buffer.concat([Buffer.from([0xed, 0x01]), raw]))
}

const paarA = generateKeyPairSync('ed25519')
const paarB = generateKeyPairSync('ed25519')
const didA = didKey(paarA.publicKey)
const didB = didKey(paarB.publicKey)
console.log('  twee verse sleutels gemaakt, geen sleutel van de koning gebruikt')

// De bytes die een tegenpartij in het echt zou hebben gezien. Hier verzonnen, maar
// de hashes eroverheen worden echt berekend, want dat is de hele constructie.
const verzoek = { method: 'POST', url: 'https://api.tokenizen.nl/api/paid/verify-ownership', body: '{"endpoint":"https://example.org/sse"}' }
const antwoord = { body: '{"ok":true,"method":"dns-txt"}' }
const u = new URL(verzoek.url)
const specHash = 'sha256:' + sha256hex(verzoek.method + ' ' + u.pathname + u.search + '\n' + verzoek.body)
const outputHash = 'sha256:' + sha256hex(antwoord.body)

const kern = {
  agentA: { id: didA, role: 'requester' },
  agentB: { id: didB, role: 'worker' },
  jobId: 'http:tokenizen-conformance-check',
  receiptVersion: '1.0',
  task: { capability: 'endpoint.ownership-verification', createdAt: '2026-10-17T10:00:00.000Z', specHash },
  result: { completedAt: '2026-10-17T10:00:01.000Z', outputHash },
  settlement: { rail: 'x402', network: 'eip155:84532', amount: '1000' },
  verification: { method: 'dns-txt' },
}

const zeven = {}
for (const k of ['jobId', 'agentA', 'agentB', 'task', 'result', 'settlement', 'verification']) zeven[k] = kern[k]
const receiptId = 'sha256:' + sha256hex(canoniek(zeven))

const teTekenen = { ...kern, receiptId }
const inhoud = canoniek(teTekenen)
const sigA = edSign(null, Buffer.from(inhoud, 'utf8'), paarA.privateKey).toString('base64')
const sigB = edSign(null, Buffer.from(inhoud, 'utf8'), paarB.privateKey).toString('base64')

const bestand = {
  agentId: 'did:tokenizen:conformance',
  agentRegistry: 'eip155:84532',
  clientAddress: 'eip155:84532:0x3333333333333333333333333333333333333333',
  createdAt: '2026-10-17T10:00:02.000Z',
  value: 100,
  valueDecimals: 0,
  tag1: 'conformance',
  tag2: 'x402',
  inam: { receipt: { ...teTekenen, signatures: { agentA: sigA, agentB: sigB } } },
}
const bestandBytes = JSON.stringify(bestand)

const eigenSuite = {
  suite: 'eigen-rondgang',
  parties: {
    requester: { did: didA, erc8004Address: '0x3333333333333333333333333333333333333333' },
    provider: { did: didB, erc8004Address: '0x4444444444444444444444444444444444444444' },
  },
  observed: { request: verzoek, response: antwoord },
}
const eigenGeval = {
  id: 'EIGEN-RONDGANG',
  feedbackFile: bestandBytes,
  onchainEvent: {
    clientAddress: '0x3333333333333333333333333333333333333333',
    value: 100,
    feedbackHash: null,
  },
}

const oordeel = toetsGeval(eigenGeval, eigenSuite)
const alleenKeccak = oordeel.failedChecks.length === 1 && oordeel.failedChecks[0] === 'feedbackHashMatchesFile'
console.log('  ons eigen bonnetje door onze eigen verifieerder: ' + (oordeel.accepted ? 'GEACCEPTEERD' : 'afgekeurd op ' + oordeel.failedChecks.join(', ')))
if (!oordeel.accepted && alleenKeccak) {
  console.log('  (alleen de keccak-controle faalt, en die vergelijkt met een on-chain gebeurtenis die hier')
  console.log('   niet bestaat omdat er niets is uitgezonden. De acht controles die over het BONNETJE gaan,')
  console.log('   inclusief beide handtekeningen en het herrekende kenmerk, slagen.)')
}

const kanTegenpartijZijn = oordeel.accepted || alleenKeccak
console.log('  conclusie: wij ' + (kanTegenpartijZijn ? 'KUNNEN' : 'kunnen NIET') + ' tegenpartij zijn op een echt bonnetje')

// ── samenvatting ─────────────────────────────────────────────────────────────

console.log('')
console.log('SAMENVATTING')
console.log('  basislijn geaccepteerd      : ' + (basis.accepted ? 'ja' : 'NEE'))
console.log('  inhoudelijk gepakt          : ' + afgekeurd + '/' + mutaties.length)
console.log('  alleen door de byte-hash    : ' + alleenBytes)
console.log('  doorgelaten                 : ' + doorgelaten)
console.log('  eigen bonnetje maakbaar     : ' + (kanTegenpartijZijn ? 'ja' : 'NEE'))

// alleenBytes maakt dit NIET rood: het is een eigenschap van de constructie en een
// bevinding om te melden, geen gebrek in onze code. Doorgelaten wel, want dat is een gat.
const faalt = !basis.accepted || doorgelaten > 0 || !kanTegenpartijZijn
if (faalt) {
  console.log('')
  console.log('  Dit is een bevinding, niet alleen een cijfer. Repareer het voor er een claim op gebaseerd wordt.')
}
process.exitCode = faalt ? 1 : 0
