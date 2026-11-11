// Checkt of een EIP-3009-betaalmachtiging (from + nonce) al VERBRUIKT is op de echte keten,
// via authorizationState(address,bytes32) -- dezelfde mapping die het token-contract zelf
// gebruikt om een tweede transferWithAuthorization met dezelfde nonce te weigeren.
//
// WAAROM DIT BESTAAT. rejection-receipt.mjs's REDEN_TABEL labelt `duplicate_payment` als
// CHAIN_VERIFIABLE: "een derde kan dit zelf narekenen." Tot nu toe deed niemand dat na, ook
// wij niet: toetsAfwijzingsBon() controleert alleen de VORM van een briefje (handtekening,
// receipt_id, bewijsniveau-tabel), nooit of een CHAIN_VERIFIABLE-claim ook werkelijk klopt
// tegen de keten. Precies het gat dat op 11 nov 2026 bovenkwam toen we de aanleiding
// (ruiruii's content-addressing-vondst op x402#4215) generaliseerden: een handtekening
// bewijst dat een partij iets WAARNAM, nooit dat de waarneming WAAR is. Dit bestand sluit
// dat gat voor exact het ene geval waar het goedkoop en eerlijk kan: `duplicate_payment`
// op de `exact`/EIP-3009-combinatie.
//
// BEWUST SMAL, zelfde stijl als rejection-receipt.mjs. Drie dingen expliciet NIET hier:
//  1. Permit2 en ERC-7710 hebben geen vergelijkbare simpele "is deze nonce verbruikt"-state;
//     Permit2 houdt een bitmap bij in een GEDEELD contract (niet per token), ERC-7710 heeft
//     helemaal geen nonce-state (alles loopt via simulatie). Een claim op een van die twee
//     transfer-methodes blijft hier NOT_MEASURED, nooit stilzwijgend fout beoordeeld.
//  2. attempt_binding (payment_payload_hash/payment_requirements_hash) wordt hier NIET
//     herrekend tegen de ruwe payload: er bestaat in dit hele pakket nog GEEN functie die
//     uitlegt hoe die hashes uit payment_payload/payment_requirements ontstaan (elke vector
//     en elke test gebruikt tot nu toe een kant-en-klare placeholder, '0xaa'/'0xbb' of
//     vergelijkbaar -- zelf nagelezen op 11 nov 2026, geen aanname). Deze functie vertrouwt
//     dus de koppeling die de AANROEPER maakt tussen receipt en payload/requirements: een
//     koper die zijn EIGEN briefje en zijn EIGEN verzonden payload samen aanlevert, weet zelf
//     zeker dat ze bij elkaar horen. Het narekenen van de hash-koppeling zelf is een apart,
//     nog niet genomen ontwerpbesluit (zou ELKE bestaande vector in dit pakket raken), hier
//     expliciet NIET stilzwijgend meegenomen.
//  3. `duplicate_payment_internal_record` claimt zelf GEEN CHAIN_VERIFIABLE (zie REDEN_TABEL
//     in rejection-receipt.mjs) en heeft dus niets om hier narekenen: deze functie geeft
//     NOT_MEASURED/OUT_OF_SCOPE_REASON_CODE voor die reden, nooit een oordeel.
//
// WAAROM OOK decision.outcome CONTROLEREN (toegevoegd na al-Khasm's adversariële lezing,
// 11 nov 2026). Zonder deze eerste check zou een briefje met outcome "ACCEPTED" maar met
// reason_code duplicate_payment/evidence_class CHAIN_VERIFIABLE hier gewoon een PASS/FAIL
// kunnen krijgen -- precies dezelfde foutklasse als het "liegende briefje"-gat dat
// toetsAfwijzingsBon() in rejection-receipt.mjs al een keer eerder dichtte (commit b7d5010):
// een checker die toetst HOE eerlijk iets begrensd is, nooit WAT er geclaimd wordt. Deze
// module noemt toetsAfwijzingsBon() in haar eigen beschrijving maar riep hem nooit aan en
// herhaalde de guard ook niet zelf -- dat was de fout.
//
// WAAROM OOK eth_chainId CONTROLEREN. De aanroeper bouwt de `rpc`-functie zelf (meestal via
// rpcVoorNetwerk hieronder) en kiest dus ZELF met welke chain hij praat. Zonder deze controle
// zou een verwisseling (een rpc voor Base mainnet, een betaling die zelf eip155:84532 claimt)
// hier onopgemerkt een antwoord van de VERKEERDE chain als waar aannemen. Een enkele extra
// aanroep (eth_chainId) maakt dat zichtbaar in plaats van aangenomen.
//
// WAAROM EEN LENGTEGRENS OP network VOOR de regex/BigInt (al-Mustamil, 11 nov 2026, zelf
// gemeten, geen aanname): network komt uit paymentPayload.accepted.network, een veld dat de
// BETALER zelf aanlevert en waar deze functie zelf voor bestaat om te wantrouwen. Een string
// van 20 miljoen tekens in dat veld deed BigInt(...) op de live machine 8,7 SECONDEN
// synchroon blokkeren (gemeten, geen schatting) -- de hele Node-event-loop staat in die tijd
// stil, elke andere gelijktijdige aanvraag wacht mee. Een lengtegrens voor de regex/BigInt-
// aanroep kost niets en sluit dat af. Alle externe tekst die in een `detail`-veld terechtkomt
// gaat voortaan door veiligVeld() (uit verify-delivery.mjs, hetzelfde patroon als de rest van
// dit pakket), zodat ook een kortere maar rare string nooit ongefilterd in een foutmelding
// terechtkomt.
//
// WAAROM EEN EIGEN TIJDSLIMIET OM ELKE rpc()-AANROEP (al-Mustamil, 11 nov 2026, zelf getest:
// een rpc die nooit resolvet liet deze functie onbeperkt hangen). De aanbevolen fabriek
// (rpcVoorNetwerk -> maakRpc) heeft al een eigen 25s-fetch-timeout, maar een AANROEPER mag
// zelf een andere rpc-functie meegeven (dat is precies waarom dit een los `{rpc}`-argument
// is, niet een vaste fabriek) -- een eigen, onafhankelijke tijdslimiet hier beschermt tegen
// ELKE rpc-implementatie, niet alleen de aanbevolen.

import { resolve as padResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maakRpc } from './x402-link-onchain.mjs'
import { NETWERKEN } from './x402-grounding.mjs'
import { veiligVeld } from './verify-delivery.mjs'

// keccak256("authorizationState(address,bytes32)").slice(0,10), herleid 11 nov 2026 via
// `ethers.id(...)` (optionalDependency in dit pakket), niet uit geheugen:
//   node -e "import('ethers').then(e => console.log(e.id('authorizationState(address,bytes32)').slice(0,10)))"
export const AUTHORIZATION_STATE_SELECTOR = '0xe94a0102'

const ADRES_RE = /^0x[0-9a-fA-F]{40}$/
const NONCE_RE = /^0x[0-9a-fA-F]{64}$/
const NETWERK_RE = /^eip155:(\d+)$/
const MAX_NETWERK_LENGTE = 40 // "eip155:" (7) + zelfs een absurd lang chain-id ruim binnen deze marge
const RPC_TIJDSLIMIET_MS = 15000

const adresAlsWoord = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0')

class RpcTijdslimietFout extends Error {}

/** Race een enkele rpc-aanroep tegen een eigen tijdslimiet, los van wat de aanroeper's rpc zelf doet. */
function metTijdslimiet(promise, ms) {
  let timer
  const tijd = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RpcTijdslimietFout('rpc-aanroep duurde langer dan ' + ms + 'ms')), ms)
  })
  return Promise.race([promise, tijd]).finally(() => clearTimeout(timer))
}

/**
 * Ruwe lezing: is deze (authorizer, nonce)-combinatie al verbruikt op dit token-contract?
 * Gooit op een genuine rpc-/formaatprobleem (nooit een stille true/false), met een duidelijke
 * boodschap in plaats van een rauwe destructuring-crash op slecht ingevulde velden.
 */
export async function leesAuthorizationState(rpc, velden, blok = 'latest') {
  const { asset, from, nonce } = velden ?? {}
  if (!ADRES_RE.test(String(asset ?? '')) || !ADRES_RE.test(String(from ?? '')) || !NONCE_RE.test(String(nonce ?? ''))) {
    throw new Error('asset/from/nonce ontbreekt of heeft niet het verwachte formaat: ' + veiligVeld({ asset, from, nonce }))
  }
  const data = AUTHORIZATION_STATE_SELECTOR + adresAlsWoord(from) + nonce.slice(2).toLowerCase()
  const uit = await rpc('eth_call', [{ to: asset, data }, blok])
  if (typeof uit !== 'string' || uit === '0x' || uit.length < 3) {
    throw new Error('eth_call gaf geen leesbaar antwoord: ' + veiligVeld(uit, 80))
  }
  return BigInt(uit) !== 0n
}

/**
 * Toetst of een `duplicate_payment`/CHAIN_VERIFIABLE-claim in een Rejection Receipt ook
 * werkelijk klopt tegen de echte keten. `paymentPayload`/`paymentRequirements` zijn de RUWE
 * x402-structuren die de aanroeper zelf koppelt aan dit receipt (zie beperking 2 hierboven).
 * `rpc` praat met precies EEN chain; welke chain dat is wordt hier gecontroleerd, niet aangenomen.
 */
export async function verifieerDuplicatePaymentOpChain(receipt, paymentPayload, paymentRequirements, opts) {
  const { rpc, tijdslimietMs = RPC_TIJDSLIMIET_MS } = opts ?? {}
  const decision = receipt?.decision ?? {}

  // decision.outcome EERST, zie "WAAROM OOK decision.outcome CONTROLEREN" hierboven.
  if (decision.outcome !== 'REJECTED') {
    return { outcome: 'NOT_MEASURED', reason_code: 'OUT_OF_SCOPE_DECISION_OUTCOME', detail: 'alleen een REJECTED-briefje draagt een afwijzingsreden om na te rekenen, dit is ' + veiligVeld(decision.outcome) }
  }
  if (decision.reason_code !== 'duplicate_payment') {
    return { outcome: 'NOT_MEASURED', reason_code: 'OUT_OF_SCOPE_REASON_CODE', detail: 'deze functie rekent alleen duplicate_payment na, niet ' + veiligVeld(decision.reason_code) }
  }
  if (decision.evidence_class !== 'CHAIN_VERIFIABLE') {
    return { outcome: 'NOT_MEASURED', reason_code: 'OUT_OF_SCOPE_EVIDENCE_CLASS', detail: 'claimt ' + veiligVeld(decision.evidence_class) + ', niets om hier narekenen' }
  }

  const scheme = paymentPayload?.accepted?.scheme
  const methode = paymentPayload?.accepted?.extra?.assetTransferMethod ?? 'eip3009'
  if (scheme !== 'exact' || methode !== 'eip3009') {
    return { outcome: 'NOT_MEASURED', reason_code: 'OUT_OF_SCOPE_TRANSFER_METHOD', detail: 'alleen exact/eip3009 gedekt, dit is ' + veiligVeld(scheme) + '/' + veiligVeld(methode) }
  }

  const network = paymentRequirements?.network ?? paymentPayload?.accepted?.network
  const networkStr = String(network ?? '')
  if (networkStr.length > MAX_NETWERK_LENGTE) {
    return { outcome: 'NOT_MEASURED', reason_code: 'UNSUPPORTED_NETWORK_FORMAT', detail: 'netwerkveld is langer dan ' + MAX_NETWERK_LENGTE + ' tekens, geen geldig eip155:<id>' }
  }
  const netwerkMatch = NETWERK_RE.exec(networkStr)
  if (!netwerkMatch) {
    return { outcome: 'NOT_MEASURED', reason_code: 'UNSUPPORTED_NETWORK_FORMAT', detail: 'geen eip155:<id> netwerk: ' + veiligVeld(networkStr) }
  }
  const chainId = BigInt(netwerkMatch[1])

  const asset = paymentRequirements?.asset ?? paymentPayload?.accepted?.asset
  const from = paymentPayload?.payload?.authorization?.from
  const nonce = paymentPayload?.payload?.authorization?.nonce
  if (!ADRES_RE.test(String(asset ?? '')) || !ADRES_RE.test(String(from ?? '')) || !NONCE_RE.test(String(nonce ?? ''))) {
    return { outcome: 'NOT_MEASURED', reason_code: 'MALFORMED_INPUT', detail: 'asset/from/nonce ontbreekt of heeft niet het verwachte formaat' }
  }

  if (typeof rpc !== 'function') {
    return { outcome: 'NOT_MEASURED', reason_code: 'NO_RPC_CONFIGURED' }
  }

  let werkelijkeChainId
  try {
    werkelijkeChainId = BigInt(await metTijdslimiet(rpc('eth_chainId', []), tijdslimietMs))
  } catch (e) {
    return { outcome: 'NOT_MEASURED', reason_code: e instanceof RpcTijdslimietFout ? 'RPC_TIMEOUT' : 'RPC_UNAVAILABLE', detail: veiligVeld(e?.message ?? e, 160) }
  }
  if (werkelijkeChainId !== chainId) {
    return {
      outcome: 'NOT_MEASURED',
      reason_code: 'RPC_CHAIN_MISMATCH',
      detail: 'rpc praat met chain ' + werkelijkeChainId + ', de betaling claimt ' + chainId,
    }
  }

  let gebruikt
  try {
    gebruikt = await metTijdslimiet(leesAuthorizationState(rpc, { asset, from, nonce }), tijdslimietMs)
  } catch (e) {
    return { outcome: 'NOT_MEASURED', reason_code: e instanceof RpcTijdslimietFout ? 'RPC_TIMEOUT' : 'RPC_UNAVAILABLE', detail: veiligVeld(e?.message ?? e, 160) }
  }

  return gebruikt
    ? { outcome: 'PASS', detail: 'authorizationState(' + from + ', ' + nonce + ') op ' + asset + ' is true: deze machtiging is al verbruikt op-chain' }
    : { outcome: 'FAIL', reason_code: 'DUPLICATE_PAYMENT_NOT_CONFIRMED_ON_CHAIN', detail: 'authorizationState is false: de keten bevestigt deze duplicate_payment-claim niet' }
}

// Live RPC-fabriek voor een bench/CLI-aanroep. GEEN hardcoded sleutel, GEEN Etherscan-
// afhankelijkheid: dit pakket is een publiek npm-pakket (zie package.json), en NETWERKEN.rpc
// is al een publiek, sleutelloos node-endpoint, hergebruikt uit x402-grounding.mjs.
export function rpcVoorNetwerk(network, overrideUrl = null) {
  const cfg = NETWERKEN[network]
  if (!cfg) throw new Error('onbekend netwerk ' + network + ', bekend: ' + Object.keys(NETWERKEN).join(', '))
  return maakRpc(overrideUrl ?? cfg.rpc)
}

// ── commandoregel, zelfde patroon als src/x402-grounding.mjs ───────────────────────────────
function vlag(naam, standaard = null) {
  const v = process.argv.find((a) => a.startsWith(`--${naam}=`))
  return v ? v.slice(naam.length + 3) : standaard
}

// EXACTE padvergelijking, geen endsWith(). test/eip3009-nonce-check.mjs importeert deze module
// en heeft toevallig dezelfde bestandsnaam als src/eip3009-nonce-check.mjs: endsWith() zou de
// CLI-lus dus ook triggeren vanuit het testbestand zelf -- precies de bekende, al gedocumenteerde
// valkuil uit src/attempt-identity.mjs die rejection-receipt.mjs hiervoor al met deze exacte
// vergelijking repareerde (zie het commentaar daar). Zelf hierop geklopt via de eerste live-run
// van test/eip3009-nonce-check.mjs, 11 nov 2026: exit 2 met de CLI-usage-tekst i.p.v. de testen.
const ditBestand = fileURLToPath(import.meta.url)
if (process.argv[1] && padResolve(process.argv[1]) === padResolve(ditBestand)) {
  const receiptPad = vlag('receipt')
  const payloadPad = vlag('payload')
  const requirementsPad = vlag('requirements')
  if (!receiptPad || !payloadPad) {
    console.log(`usage: node src/eip3009-nonce-check.mjs --receipt=<file.json> --payload=<file.json> [--requirements=<file.json>] [--network=eip155:8453] [--rpc=<url>]

Toetst of een duplicate_payment/CHAIN_VERIFIABLE-claim in een x402 Rejection Receipt (--receipt)
echt klopt tegen de echte keten, gegeven de ruwe betaalpayload die daarbij hoort (--payload) en
optioneel de payment requirements (--requirements, anders gehaald uit payload.accepted). Alleen
exact/eip3009. Read-only, geen sleutel, geen account.`)
    process.exit(2)
  }
  const fs = await import('node:fs')
  const receipt = JSON.parse(fs.readFileSync(receiptPad, 'utf8'))
  const paymentPayload = JSON.parse(fs.readFileSync(payloadPad, 'utf8'))
  const paymentRequirements = requirementsPad ? JSON.parse(fs.readFileSync(requirementsPad, 'utf8')) : null
  const network = vlag('network', paymentRequirements?.network ?? paymentPayload?.accepted?.network ?? 'eip155:8453')
  const rpc = rpcVoorNetwerk(network, vlag('rpc'))
  const uit = await verifieerDuplicatePaymentOpChain(receipt, paymentPayload, paymentRequirements, { rpc })
  console.log(JSON.stringify(uit, null, 2))
  process.exit(uit.outcome === 'PASS' ? 0 : uit.outcome === 'FAIL' ? 1 : 2)
}
