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
  const doelNetwerk = context.doelNetwerk ?? input?.accepted?.network
  const accepted = input?.accepted ?? {}
  const auth = input?.payload?.authorization ?? {}
  const signature = input?.payload?.signature
  const nu = Number(context.verification_time ?? Math.floor(Date.now() / 1000))

  // 1. Netwerk, in platte tekst, voor er iets met de handtekening gebeurt.
  if (String(doelNetwerk) !== String(accepted.network)) {
    return { valid: false, reason_code: 'NETWORK_MISMATCH' }
  }

  // 2. Kneedbaarheid, voor het herstellen. Een hoge s is een tweede geldige vorm van
  // dezelfde handtekening, en wie eerst herstelt accepteert die vorm stilletjes.
  if (isKneedbaar(signature)) {
    return { valid: false, reason_code: 'SIG_MALLEABLE' }
  }

  // 3. Het geldigheidsvenster.
  if (nu < Number(auth.validAfter)) return { valid: false, reason_code: 'NOT_YET_VALID' }
  if (nu > Number(auth.validBefore)) return { valid: false, reason_code: 'EXPIRED' }

  // 4. Herstellen en de ondertekenaar vergelijken. Zonder ethers kan dit niet, en dan
  // is de eerlijke uitslag ONGEMETEN.
  const ethers = await laadEthers()
  if (!ethers) {
    return { valid: false, reason_code: null, ongemeten: true, reden: 'ethers ontbreekt, dus de handtekening is niet te herstellen' }
  }
  let hersteld
  try {
    hersteld = ethers.verifyTypedData(domeinUit(accepted), TRANSFER_TYPES, {
      from: auth.from, to: auth.to, value: auth.value,
      validAfter: auth.validAfter, validBefore: auth.validBefore, nonce: auth.nonce,
    }, signature)
  } catch (e) {
    // Een handtekening die niet eens te herstellen is, is geen geldige ondertekenaar.
    return { valid: false, reason_code: 'SIGNER_MISMATCH', detail: String(e?.message ?? e).slice(0, 120) }
  }
  if (String(hersteld).toLowerCase() !== String(auth.from).toLowerCase()) {
    return { valid: false, reason_code: 'SIGNER_MISMATCH', hersteld }
  }

  // 5. Het bedrag, pas NA de handtekening: een authentiek ondertekende onderbetaling.
  if (BigInt(auth.value ?? 0) < BigInt(accepted.amount ?? 0)) {
    return { valid: false, reason_code: 'AMOUNT_INSUFFICIENT' }
  }

  // 6. Is deze nonce al verbruikt. Dit is toestand van buiten, geen eigenschap van de
  // autorisatie, en komt daarom uit de context in plaats van uit de betaling.
  const gezien = (context.seen_nonces ?? []).map((n) => String(n).toLowerCase())
  if (gezien.includes(String(auth.nonce).toLowerCase())) {
    return { valid: false, reason_code: 'NONCE_REPLAY' }
  }

  return { valid: true, reason_code: 'VALID', ondertekenaar: hersteld }
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
