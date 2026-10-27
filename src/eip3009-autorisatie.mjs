// Een onafhankelijke verifieerder voor EIP-3009 betaalautorisaties, geschreven tegen
// de vectoren van iamonuwa/kanon en niet tegen zijn code.
//
// WAAROM DIT HIER STAAT, want het is de ANDERE kant van wat deze repo tot nu toe deed.
// Alles hier ging over de VERKOPER: zijn ondertekende aanbod, zijn bonnetje, en de
// vraag of dat bonnetje op precies een afrekening op de keten opent. Een EIP-3009
// autorisatie is de KOPER-kant: de handtekening waarmee een agent zijn geld vrijgeeft,
// voor er iets afgerekend is. Samen zijn dat de twee uiteinden van dezelfde transactie,
// en ze overlappen nergens. Dat is precies waarom een tweede implementatie hier iets
// toevoegt in plaats van iets te verdubbelen.
//
// DE REGEL DIE DEZE HELE REPO DRAAGT, ook hier: geschreven tegen de GEPUBLICEERDE
// vectoren en de specificaties (EIP-3009, EIP-712), nooit tegen de broncode van de
// referentie-implementatie. Twee implementaties die elkaars code niet gezien hebben en
// toch op dezelfde uitslagen komen, dat is interop. Een implementatie die met zichzelf
// instemt bewijst niets.
//
// DE VOLGORDE VAN DE CONTROLES IS ZELF EEN UITSPRAAK, en zij volgt uit zijn eigen
// beschrijvingen bij de vectoren:
//   1. netwerk (platte tekst, voor de handtekening; zijn tekst: "the plaintext mismatch")
//   2. kneedbaarheid van de handtekening (voor het herstellen, anders herstel je een
//      tweede geldige vorm van dezelfde handtekening)
//   3. geldigheidsvenster
//   4. herstellen en de ondertekenaar vergelijken
//   5. bedrag (zijn tekst: "caught only after the signature verifies")
//   6. nonce al verbruikt
// Een andere volgorde geeft bij een vector met twee gebreken een andere redencode. Waar
// wij van hem afwijken hoort dat GEMELD te worden en niet weggepoetst tot het groen is.
//
// ethers is optioneel in dit pakket. Zonder dat pakket kan stap 4 niet en komt de
// uitslag terug als ONGEMETEN, nooit als afgekeurd: een gat in onze meter is geen
// gebrek van de betaling.

import { laadEthers } from './x402-conformance-treden.mjs'

/** De helft van de secp256k1-groepsorde. Daarboven is een handtekening kneedbaar. */
const HALVE_ORDE = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n

export const REDENEN = [
  'VALID',
  'NETWORK_MISMATCH',
  'SIG_MALLEABLE',
  'SIGNER_MISMATCH',
  'NOT_YET_VALID',
  'EXPIRED',
  'NONCE_REPLAY',
  'AMOUNT_INSUFFICIENT',
]

/** De EIP-712-types van EIP-3009, normatief en niet over de lijn verzonden. */
export const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
}

/** `eip155:84532` naar 84532. Geeft null bij een vorm die wij niet kennen. */
export function chainIdUitNetwerk(netwerk) {
  const m = /^eip155:(\d+)$/.exec(String(netwerk ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Het domein waaronder deze autorisatie hoort te zijn ondertekend.
 *
 * Alle drie de replay-vectoren draaien hierom: wie onder een ander domein tekent
 * (andere keten, ander contract, andere naam) levert een handtekening die op een ANDER
 * adres herstelt. Daarom is er geen aparte controle voor cross-chain of cross-contract
 * nodig: het domein doet dat werk, en de uitslag heet dan terecht SIGNER_MISMATCH.
 */
export function domeinUit(accepted) {
  return {
    name: accepted?.extra?.name,
    version: accepted?.extra?.version,
    chainId: chainIdUitNetwerk(accepted?.network),
    verifyingContract: accepted?.asset,
  }
}

const ERC6492_MAGIC = '6492649264926492649264926492649264926492649264926492649264926492'

/**
 * Leest een ERC-6492-omhulling (abi.encode(address factory, bytes calldata, bytes handtekening) gevolgd door de magic suffix).
 * Geeft null als de handtekening geen omhulling is. Anders { factory, heeftCalldata, geenPad } waarbij geenPad betekent dat er
 * geen deployment-pad te maken valt: een nul-factory, lege calldata of een omhulling die niet te lezen is.
 */
export function leesErc6492(signature) {
  const h = String(signature ?? '').replace(/^0x/i, '').toLowerCase()
  if (!h.endsWith(ERC6492_MAGIC)) return null
  const lijf = h.slice(0, h.length - ERC6492_MAGIC.length)
  const onleesbaar = { factory: null, heeftCalldata: false, geenPad: true, onleesbaar: true }
  try {
    if (lijf.length < 64 * 3 || lijf.length % 2 !== 0) return onleesbaar
    const woord = (i) => BigInt('0x' + lijf.slice(i * 2, i * 2 + 64))
    const factoryWoord = lijf.slice(0, 64)
    if (/^0{24}/.test(factoryWoord) === false) return onleesbaar
    const factory = '0x' + factoryWoord.slice(24)
    const off1 = Number(woord(32)), off2 = Number(woord(64))
    if (!Number.isSafeInteger(off1) || !Number.isSafeInteger(off2) || off1 + 32 > lijf.length / 2 || off2 + 32 > lijf.length / 2) return onleesbaar
    const lenCalldata = Number(woord(off1))
    const lenInner = Number(woord(off2))
    if (!Number.isSafeInteger(lenCalldata) || !Number.isSafeInteger(lenInner) || off1 + 32 + lenCalldata > lijf.length / 2 || off2 + 32 + lenInner > lijf.length / 2) return onleesbaar
    const nul = /^0x0{40}$/.test(factory)
    return { factory, heeftCalldata: lenCalldata > 0, geenPad: nul || lenCalldata === 0, onleesbaar: false }
  } catch {
    return onleesbaar
  }
}

/** Is de s-waarde van deze handtekening boven de halve groepsorde. */
export function isKneedbaar(signature) {
  const h = String(signature ?? '').replace(/^0x/i, '')
  if (h.length < 130) return false
  const s = BigInt('0x' + h.slice(64, 128))
  return s > HALVE_ORDE
}

/**
 * Beoordeelt een enkele autorisatie.
 *
 * Geeft { valid, reason_code } terug in exact de vorm die kanon se vectoren in hun
 * `expected` gebruiken, plus `ongemeten` met een reden als de controle niet KON
 * draaien. Die derde mogelijkheid staat niet in zijn schema, en dat is precies het
 * punt dat wij in x402#3396 open hebben gelegd: een gat in de verifieerder is iets
 * anders dan een afgekeurde betaling.
 */
export async function beoordeelAutorisatie(input, context = {}) {
  const uitslag = await beoordeelBinnen(input, context)
  const payerScope = context.payerHasCode === true ? 'code' : context.payerHasCode === false ? 'no-code' : 'unknown'
  return { ...uitslag, payerScope }
}

async function beoordeelBinnen(input, context = {}) {
  const doelNetwerk = context.doelNetwerk ?? input?.accepted?.network
  const accepted = input?.accepted ?? {}
  const auth = input?.payload?.authorization ?? {}
  const signature = input?.payload?.signature
  const nu = Number(context.verification_time ?? Math.floor(Date.now() / 1000))
  // WELKE BETALER. true: heeft code, false: heeft geen code, niet opgegeven: onbekend (dan gedragen wij ons als voor een
  // betaler zonder code en zeggen dat in de uitslag). Zie het commentaar bij stap 2 en 4, en x402#2725 en x402#3925.
  const payerScope = context.payerHasCode === true ? 'code' : context.payerHasCode === false ? 'no-code' : 'unknown'

  // 1. Netwerk, in platte tekst, voor er iets met de handtekening gebeurt.
  if (String(doelNetwerk) !== String(accepted.network)) {
    return { valid: false, reason_code: 'NETWORK_MISMATCH' }
  }

  // 1b. Een ERC-6492-omhulling om de handtekening, van een betaler zonder code. Sinds x402#3925 (tekst op 52556d1b, nog niet
  // gemerged): een verifier mag zo'n handtekening ALLEEN accepteren via het deployment-pad (de factory staat op de lijst en een
  // simulatie doet de deployment en de overdracht samen) en mag de omhulling NOOIT weghalen om de handtekening erin met ecrecover
  // te controleren, ook niet als er geen deployment-gegevens in zitten. Dus: geen pad is een afwijzing, een factory die niet op
  // de lijst staat is een afwijzing, en een volledige omhulling met een toegestane factory kunnen wij zonder simulatie niet beoordelen.
  // Wat wij hier eerder deden (de omhulling niet herkennen) gaf SIGNER_MISMATCH, een afwijzing om een verkeerde reden.
  // Een volledige omhulling met een toegestane factory blokkeert de rest niet: het venster, het bedrag en de nonce worden gewoon
  // nog gecontroleerd (een betaling die we zeker kunnen weigeren blijft geweigerd), alleen de stappen die de handtekening zelf
  // lezen (kneedbaarheid en herstellen) slaan we over, en aan het eind is de uitslag NIET TE BEOORDELEN.
  let ingepaktMetToegestaneFactory = false
  if (payerScope !== 'code') {
    const omhulling = leesErc6492(signature)
    if (omhulling) {
      // De tekst van 3925 (52556d1b) geeft invalid_exact_evm_payload_undeployed_smart_wallet voor een nul-factory of lege calldata.
      // Een omhulling die niet te lezen is staat niet in de tekst, dus die krijgt een code van ons.
      if (omhulling.onleesbaar) return { valid: false, reason_code: 'ERC6492_WRAPPER_UNREADABLE' }
      if (omhulling.geenPad) return { valid: false, reason_code: 'invalid_exact_evm_payload_undeployed_smart_wallet' }
      const lijst = (Array.isArray(context.erc6492Factories) ? context.erc6492Factories : []).map((a) => String(a).toLowerCase())
      if (!lijst.includes(omhulling.factory)) return { valid: false, reason_code: 'ERC6492_FACTORY_NOT_ALLOWED' }
      ingepaktMetToegestaneFactory = true
    }
  }

  // 2. Kneedbaarheid, voor het herstellen. Een hoge s is een tweede geldige vorm van
  // dezelfde handtekening, en wie eerst herstelt accepteert die vorm stilletjes.
  // De regel geldt voor een betaler ZONDER code. USDC kiest de controle naar de code van de betaler en niet naar de vorm
  // van de handtekening: zonder code ecrecover (en dan weigert het een hoge s), met code ERC-1271. Een slimme portemonnee
  // met een handtekening die niet naar zichzelf terug te herstellen is, hoort dus NIET afgekeurd te worden. Aangewezen
  // door robertolocatelli81-dev op x402#3925 en daarmee ook een gebrek van onze eerste versie.
  if (payerScope !== 'code' && !ingepaktMetToegestaneFactory && isKneedbaar(signature)) {
    return { valid: false, reason_code: 'SIG_MALLEABLE' }
  }

  // 3. Het geldigheidsvenster.
  if (nu < Number(auth.validAfter)) return { valid: false, reason_code: 'NOT_YET_VALID' }
  if (nu > Number(auth.validBefore)) return { valid: false, reason_code: 'EXPIRED' }

  // 4. Herstellen en de ondertekenaar vergelijken, ALLEEN voor een betaler zonder code. Heeft de
  // betaler code (een slimme portemonnee, of een gewoon adres met een EIP-7702-delegatie), dan
  // vraagt het token zelf isValidSignature (ERC-1271) aan dat contract. Herstellen geeft dan een
  // ander adres dan de betaler en dat is geen gebrek van de betaling. Zonder ethers kan stap 4 niet
  // en is de eerlijke uitslag ONGEMETEN.
  let hersteld = null
  if (payerScope !== 'code' && !ingepaktMetToegestaneFactory) {
    const g = await controleerOndertekenaar({ auth, accepted, signature })
    if (g.uitslag) return g.uitslag
    hersteld = g.hersteld
  }

  // 5. Het bedrag, pas NA de handtekening: een authentiek ondertekende afwijking.
  //
  // DE STANDAARD NEEMT HIER GEEN POSITIE IN, DUS WIJ MAKEN DE KEUZE ZICHTBAAR. Twee
  // referentie-implementaties eisen GELIJKHEID en wijzen dus ook te veel betalen af:
  // go/mechanisms/evm/exact/facilitator/eip3009.go regel 65 (`Cmp(requiredValue) != 0`,
  // fout ErrAuthorizationValueMismatch) en python/x402/mechanisms/evm/exact/
  // facilitator.py regel 235 (`!=`), met op regel 168 de eigen zin "Amount exactly
  // matches requirements.amount". Onze eerste versie liet te veel betalen toe en zou
  // dus op dat ene geval van hen afwijken, terwijl geen enkele gepubliceerde vector
  // het dekt. Daarom staat 'exact' nu als standaard, is 'at-least' een bewuste keuze,
  // en draagt de uitslag ALTIJD welke van de twee gebruikt is.
  const beleid = context.amountPolicy === 'at-least' ? 'at-least' : 'exact'
  const betaald = BigInt(auth.value ?? 0)
  const gevraagd = BigInt(accepted.amount ?? 0)
  const bedragFout = beleid === 'exact' ? betaald !== gevraagd : betaald < gevraagd
  if (bedragFout) {
    return { valid: false, reason_code: 'AMOUNT_INSUFFICIENT', amountPolicy: beleid }
  }

  // 6. Is deze nonce al verbruikt, PER BETALER en niet over iedereen heen.
  //
  // EIP-3009 houdt dit zelf per adres bij: `mapping(address => mapping(bytes32 =>
  // bool))`, en de leesfunctie heet `authorizationState(address authorizer, bytes32
  // nonce)`. De spec zegt er bovendien bij dat nonces willekeurige 32 bytes zijn,
  // uniek per adres, en juist geen volgnummers. Een verifieerder die EEN lijst
  // bijhoudt zonder onderscheid naar betaler is dus STRENGER dan de keten zelf: hij
  // zou een geldige betaling van een andere partij weigeren die toevallig dezelfde
  // 32 bytes koos. Onze eerste versie deed precies dat.
  //
  // Twee vormen worden aanvaard. Een platte lijst hoort bij DEZE betaler, want zo
  // gebruiken de gepubliceerde vectoren hem. Een object met het adres als sleutel is
  // de nauwkeurige vorm en komt overeen met wat het token-contract doet.
  const betaler = String(auth.from ?? '').toLowerCase()
  const bron = context.seen_nonces
  let gezien = []
  if (Array.isArray(bron)) gezien = bron
  else if (bron && typeof bron === 'object') {
    for (const [adres, lijst] of Object.entries(bron)) {
      if (String(adres).toLowerCase() === betaler) gezien = lijst ?? []
    }
  }
  if (gezien.map((n) => String(n).toLowerCase()).includes(String(auth.nonce).toLowerCase())) {
    return { valid: false, reason_code: 'NONCE_REPLAY' }
  }

  if (ingepaktMetToegestaneFactory) {
    return { valid: false, reason_code: null, ongemeten: true, reden: 'the signature is an ERC-6492 wrapper with an allowlisted factory; every other rule passed here, but it can only be accepted through a simulation that deploys the account and makes the transfer together, which this offline check does not run' }
  }
  if (payerScope === 'code') {
    return { valid: false, reason_code: null, ongemeten: true, reden: 'the payer has code, so the token checks the signature with ERC-1271 on chain; every other rule passed here but the signature itself was not checked' }
  }
  return { valid: true, reason_code: 'VALID', ondertekenaar: hersteld, amountPolicy: beleid }
}

/** Stap 4: herstel de ondertekenaar en vergelijk. Geeft { hersteld } of { uitslag } als de beoordeling hier stopt. */
async function controleerOndertekenaar({ auth, accepted, signature }) {
  const ethers = await laadEthers()
  if (!ethers) {
    return { uitslag: { valid: false, reason_code: null, ongemeten: true, reden: 'ethers ontbreekt, dus de handtekening is niet te herstellen' } }
  }
  let hersteld
  try {
    hersteld = ethers.verifyTypedData(domeinUit(accepted), TRANSFER_TYPES, {
      from: auth.from, to: auth.to, value: auth.value,
      validAfter: auth.validAfter, validBefore: auth.validBefore, nonce: auth.nonce,
    }, signature)
  } catch (e) {
    // Een handtekening die niet eens te herstellen is, is geen geldige ondertekenaar.
    return { uitslag: { valid: false, reason_code: 'SIGNER_MISMATCH', detail: String(e?.message ?? e).slice(0, 120) } }
  }
  if (String(hersteld).toLowerCase() !== String(auth.from).toLowerCase()) {
    return { uitslag: { valid: false, reason_code: 'SIGNER_MISMATCH', hersteld } }
  }
  return { hersteld }
}

/** Een hele vector beoordelen, met zijn eigen context en doelnetwerk. */
export async function beoordeelVector(vector) {
  return beoordeelAutorisatie(vector.input, { ...(vector.context ?? {}), doelNetwerk: vector.network })
}

// Een commandoregel, zodat een vreemde de kruiscontrole in EEN regel kan narekenen in
// plaats van ons op ons woord te geloven. Dat is het hele punt van deze repo.
if (process.argv[1]?.endsWith('eip3009-autorisatie.mjs')) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const map = path.join(fileURLToPath(new URL('..', import.meta.url)), 'vectors', 'kanon')
  if (!fs.existsSync(map)) {
    console.log('geen vectoren gevonden in ' + map)
    process.exitCode = 2
  } else {
    const bestanden = fs.readdirSync(map).filter((f) => f.endsWith('.json')).sort()
    let eens = 0, oneens = 0, ongemeten = 0
    console.log('Cross-check against iamonuwa/kanon, EIP-3009 payment authorizations')
    console.log('Vectors pinned at commit 0d5a7461e996, Apache-2.0, redistributed unmodified.')
    console.log('This implementation was written against those vectors and against EIP-3009')
    console.log('and EIP-712, never against that project\'s source.')
    console.log('')
    for (const f of bestanden) {
      const v = JSON.parse(fs.readFileSync(path.join(map, f), 'utf8'))
      const u = await beoordeelVector(v)
      if (u.ongemeten) { ongemeten++; console.log('  not measured  ' + v.id + '  ' + u.reden); continue }
      const zelfde = u.valid === v.expected.valid && u.reason_code === v.expected.reason_code
      if (zelfde) { eens++; console.log('  agree         ' + v.id.padEnd(42) + ' ' + u.reason_code) }
      else { oneens++; console.log('  DISAGREE      ' + v.id.padEnd(42) + ' ours ' + u.reason_code + ', theirs ' + v.expected.reason_code) }
    }
    console.log('')
    console.log('agree on ' + eens + ' of ' + bestanden.length + ', disagree ' + oneens + ', not measured ' + ongemeten)
    if (ongemeten) console.log('Install the optional ethers dependency to run the signature recovery.')
    process.exitCode = oneens === 0 ? 0 : 1
  }
}
