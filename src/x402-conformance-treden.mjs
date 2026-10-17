// De conformance-ladder, en de optionele crypto die een deel ervan nodig heeft.
//
// De treden staan hier als DATA en niet als losse regels code, omdat de ladder de
// eenheid is: wie een ander getal publiceert moet kunnen aanwijzen welke trede hij
// anders heeft gelegd. Verandert de ladder, dan verandert de editie, en dan hoort
// dat met een datum opgeschreven te worden in CONFORMANCE.md.
//
// WIJZIGING 2026-10-17, en dit is een gebrek in onze eigen eenheid dat een meting
// blootlegde, geen uitbreiding uit enthousiasme. Trede 2 eiste een eip712-artefact.
// Een live meting vond een partij die zijn aanbod wel degelijk ondertekent, maar in
// JWS met een EdDSA-handtekening en een did:web-sleutel. Onze meetlat noemde dat een
// mislukking. Dat is niet hun fout maar onze fout: een ladder die een geldige vorm
// niet kent, meet die partij verkeerd en zou een gepubliceerd cijfer onjuist maken.
// Trede 2 vraagt daarom nu om een ONDERTEKEND aanbod waarvan de handtekening
// verifieert, ongeacht in welke van beide vormen.

import { createPublicKey, verify as edVerify } from 'node:crypto'
import { laadProfiel, tredenUitProfiel } from './profiel.mjs'

// De treden komen nu UIT het profiel en staan niet meer hier. Zie src/profiel.mjs
// voor waarom: een meetlat die in een .mjs opgesloten zit, kan geen tweede
// implementatie voeden, en dat is precies de scheefgroei die x402#3396 benoemt.
// De veldnamen zijn met opzet onveranderd gelaten, zodat geen enkele aanroeper
// hoeft te wijzigen en de omzetting dus aantoonbaar niets aan het gedrag verandert.
// Nieuw per trede, alleen toegevoegd: profielId, clausule, citeertVoorstel en
// terugvalAlsNietTeZien.
export const PROFIEL = laadProfiel()
export const TREDEN = tredenUitProfiel(PROFIEL)

/**
 * ethers, als het er is.
 *
 * Een BARE import, en bewust niet een pad op iemands schijf. Een vorige versie van
 * dit project importeerde ethers vanaf file:///C:/Code/... en dat werkte alleen op
 * de machine van de schrijver: voor iedere vreemde viel de controle stil weg en hij
 * kreeg zonder het te weten een zwakkere uitslag dan wij. Dat is precies het
 * tegenovergestelde van wat een onafhankelijke verifieerder hoort te zijn.
 *
 * Niet aanwezig betekent ONGEMETEN en nooit stil overgeslagen: de aanroeper krijgt
 * een reden terug die hij in zijn uitslag kan laten zien.
 */
let ethersCache
export async function laadEthers() {
  if (ethersCache !== undefined) return ethersCache
  try {
    ethersCache = await import('ethers')
  } catch {
    ethersCache = null
  }
  return ethersCache
}

/** §4.3, normatief. Reist niet over de lijn, dus een verifier haalt het uit de spec. */
export const OFFER_EIP712_DOMAIN = { name: 'x402 offer', version: '1', chainId: 1 }
export const OFFER_EIP712_TYPES = {
  Offer: [
    { name: 'version', type: 'uint256' },
    { name: 'resourceUrl', type: 'string' },
    { name: 'scheme', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'asset', type: 'string' },
    { name: 'payTo', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'validUntil', type: 'uint256' },
  ],
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58decode(s) {
  let getal = 0n
  for (const teken of s) {
    const i = B58.indexOf(teken)
    if (i < 0) throw new Error('not base58: ' + teken)
    getal = getal * 58n + BigInt(i)
  }
  const bytes = []
  while (getal > 0n) {
    bytes.unshift(Number(getal & 255n))
    getal >>= 8n
  }
  for (const teken of s) {
    if (teken === '1') bytes.unshift(0)
    else break
  }
  return Buffer.from(bytes)
}

/**
 * did:web naar de URL van zijn document, volgens de did:web-methode.
 *
 * Zonder pad staat het document op /.well-known/did.json; met padsegmenten staat
 * het op dat pad. Een poort zit in het eerste segment als %3A.
 */
export function didWebNaarUrl(did) {
  if (!did.startsWith('did:web:')) throw new Error('not a did:web')
  const delen = did.slice('did:web:'.length).split(':').map(decodeURIComponent)
  const host = delen[0]
  if (!host || host.includes('/')) throw new Error('unusable did:web host')
  return delen.length === 1
    ? 'https://' + host + '/.well-known/did.json'
    : 'https://' + host + '/' + delen.slice(1).join('/') + '/did.json'
}

/**
 * Een did:web-document ophalen.
 *
 * DIT HAALT EEN URL OP DIE DE GEMETEN PARTIJ ZELF BEPAALT, en dat is precies waarom
 * er grenzen om heen staan. Dit bestand wordt door vreemden gedraaid, dus het mag
 * nooit een omleiding naar een intern adres volgen of naar iets anders dan https:
 *  - alleen https, afgedwongen door didWebNaarUrl
 *  - redirect: 'error', zodat een omleiding een fout is en niet stil gevolgd wordt
 *  - een harde tijdslimiet
 * Dit lost niet elk denkbaar geval op (een host die zelf naar een intern adres
 * resolveert blijft mogelijk), en dat staat hier zodat het een bekende grens is in
 * plaats van een stille aanname.
 */
async function haalDidDocument(did, { fetchImpl = fetch } = {}) {
  const url = didWebNaarUrl(did)
  const resp = await fetchImpl(url, {
    headers: {
      'User-Agent': 'x402-conformance-check/1 (read-only, github.com/holistis/agent-receipt-verify)',
      Accept: 'application/did+json, application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) throw new Error('did document at ' + url + ' returned ' + resp.status)
  return await resp.json()
}

/**
 * Een Ed25519 publieke sleutel uit een verificationMethod halen.
 *
 * Geeft {sleutel, codering} terug. De codering is ZELF een uitslag: did-core wil bij
 * publicKeyMultibase een multibase-multicodec-waarde (0xed01 voor Ed25519, die als
 * z6Mk... rendert). Een rauwe sleutel van 32 bytes zonder die prefix is afwijkend,
 * maar de handtekening eronder kan prima kloppen. Dat onderscheid hoort gemeld te
 * worden in plaats van opgelost of doodgezwegen: wie zich aan de specificatie houdt
 * weigert zo een sleutel, en de eigenaar hoort dat te weten.
 */
export function sleutelUitVerificationMethod(vm) {
  if (vm?.publicKeyJwk) {
    return { sleutel: createPublicKey({ key: vm.publicKeyJwk, format: 'jwk' }), codering: 'publicKeyJwk' }
  }
  const mb = vm?.publicKeyMultibase
  if (typeof mb !== 'string' || !mb.startsWith('z')) {
    throw new Error('no usable publicKeyJwk or base58btc publicKeyMultibase')
  }
  const ruw = base58decode(mb.slice(1))
  const omhul = (k) =>
    createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), k]), format: 'der', type: 'spki' })
  if (ruw.length === 34 && ruw[0] === 0xed && ruw[1] === 0x01) {
    return { sleutel: omhul(ruw.subarray(2)), codering: 'multicodec ed25519-pub' }
  }
  if (ruw.length === 32) {
    return {
      sleutel: omhul(ruw),
      codering: 'raw 32 bytes',
      afwijking:
        'publicKeyMultibase decodes to 32 raw bytes with no multicodec prefix; did-core requires the 0xed01 ed25519-pub prefix for a Multikey, which renders as z6Mk...',
    }
  }
  throw new Error('publicKeyMultibase decodes to ' + ruw.length + ' bytes, which is neither 32 nor 0xed01 plus 32')
}

/**
 * Controleer een JWS-aanbod.
 *
 * Alleen EdDSA (Ed25519), want dat is wat er in het veld is aangetroffen. Een ander
 * alg geeft een expliciete reden terug in plaats van een stille mislukking: niet
 * ondersteund is iets anders dan ongeldig, en dat verschil hoort in de uitslag.
 */
export async function verifyJwsOffer(artefact, { fetchImpl = fetch } = {}) {
  const jws = typeof artefact.signature === 'string' ? artefact.signature : null
  if (!jws || jws.split('.').length !== 3) return { ok: false, reden: 'jws artifact without a three-part compact signature' }
  const [h, p, s] = jws.split('.')
  let kop
  try {
    kop = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reden: 'jws header is not json' }
  }
  if (kop.alg !== 'EdDSA') {
    return { ok: false, ongemeten: true, reden: 'alg ' + kop.alg + ' is not supported by this checker, so the signature was NOT checked' }
  }
  const kid = kop.kid
  if (typeof kid !== 'string' || !kid.startsWith('did:web:')) {
    return { ok: false, ongemeten: true, reden: 'kid is not a did:web, so the key could not be resolved: ' + String(kid).slice(0, 60) }
  }
  let doc
  try {
    doc = await haalDidDocument(kid.split('#')[0], { fetchImpl })
  } catch (e) {
    return { ok: false, ongemeten: true, reden: 'could not resolve the key: ' + String(e.message).slice(0, 90) }
  }
  const vms = Array.isArray(doc?.verificationMethod) ? doc.verificationMethod : []
  const vm = vms.find((v) => v?.id === kid) ?? (kid.includes('#') ? vms.find((v) => String(v?.id).endsWith('#' + kid.split('#')[1])) : null)
  if (!vm) return { ok: false, reden: 'the did document has no verificationMethod with id ' + kid.slice(0, 70) }
  let uit
  try {
    uit = sleutelUitVerificationMethod(vm)
  } catch (e) {
    return { ok: false, reden: 'key in the did document unusable: ' + String(e.message).slice(0, 110) }
  }
  const ok = edVerify(null, Buffer.from(h + '.' + p, 'ascii'), uit.sleutel, Buffer.from(s, 'base64url'))
  if (!ok) return { ok: false, reden: 'the EdDSA signature does not verify against the key in the did document' }
  let lading = null
  try {
    lading = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reden: 'signature verifies but the payload is not json' }
  }
  return { ok: true, signer: kid, codering: uit.codering, afwijking: uit.afwijking, payload: lading }
}

/**
 * Controleer de handtekening op een aangeboden offer.
 *
 * Geeft {ok, signer} of {ok:false, reden}. Zonder ethers komt er bij een eip712-
 * artefact expliciet ongemeten terug, want een overgeslagen controle mag nooit als
 * geslaagde controle lezen.
 */
export async function verifyOfferSignature(artefact, opties = {}) {
  if (!artefact || typeof artefact !== 'object') {
    return { ok: false, reden: 'geen eip712-artefact met payload en signature' }
  }
  if (artefact.format === 'jws') return await verifyJwsOffer(artefact, opties)
  if (artefact.format !== 'eip712' || !artefact.payload || !artefact.signature) {
    // De oude tekst blijft staan voor het geval dat er al een test op leunt, met
    // de werkelijk aangetroffen vorm erachter zodat een uitslag bruikbaar blijft:
    // "onbekend formaat" is iets anders dan "ongeldige handtekening".
    const vorm = artefact.format ? 'format "' + String(artefact.format).slice(0, 20) + '"' : 'no format field'
    return { ok: false, reden: 'geen eip712-artefact met payload en signature (' + vorm + ')' }
  }
  const ethers = await laadEthers()
  if (!ethers) {
    return { ok: false, ongemeten: true, reden: 'ethers niet beschikbaar, dus de handtekening is NIET gecontroleerd' }
  }
  try {
    const signer = ethers.verifyTypedData(OFFER_EIP712_DOMAIN, OFFER_EIP712_TYPES, artefact.payload, artefact.signature)
    return { ok: true, signer }
  } catch (e) {
    return { ok: false, reden: String(e.message).slice(0, 90) }
  }
}
