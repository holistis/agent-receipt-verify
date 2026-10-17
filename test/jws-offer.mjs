// Test voor het JWS-pad van trede 2, zonder netwerk.
//
// WAAROM DIT BESTAAT. Tot 2026-10-17 kende onze meetlat alleen eip712. Een live
// meting trof een partij die zijn aanbod wel ondertekent, maar in JWS met EdDSA en
// een did:web-sleutel, en onze meetlat noemde dat een mislukking. Hadden we dat
// cijfer gepubliceerd, dan was de eerste die het natrok erachter gekomen. Deze test
// bevriest het echte, in het veld aangetroffen artefact zodat die fout niet stil kan
// terugkomen.
//
// Het artefact hieronder is ECHT, in het veld aangetroffen op 2026-10-17, en staat
// hier als vast gegeven zodat de test offline draait en precies de vorm die ons brak
// niet stil kan terugkomen. Het bijbehorende did-document is hier OPGEBOUWD in de
// vorm die did-core voorschrijft, want deze test moet bewijzen dat ONZE controle
// werkt, niet hoe iemand anders zijn document heeft opgeschreven.

import { verifyOfferSignature, sleutelUitVerificationMethod, didWebNaarUrl } from '../src/x402-conformance-treden.mjs'

let goed = 0
let fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const KID = 'did:web:agents.daedalusdevelopmentgroup.com#keys-1'
const ECHTE_JWS =
  'eyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDp3ZWI6YWdlbnRzLmRhZWRhbHVzZGV2ZWxvcG1lbnRncm91cC5jb20ja2V5cy0xIn0.' +
  'eyJ2ZXJzaW9uIjoxLCJyZXNvdXJjZVVybCI6Imh0dHBzOi8vYWdlbnRzLmRhZWRhbHVzZGV2ZWxvcG1lbnRncm91cC5jb20vdjEv' +
  'ZW1haWwtc2VuZCIsInNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6ImVpcDE1NTo4NDUzIiwiYXNzZXQiOiIweDgzMzU4OWZDRDZl' +
  'RGI2RTA4ZjRjN0MzMkQ0ZjcxYjU0YmRBMDI5MTMiLCJwYXlUbyI6IjB4OEFmQkQ1MjJGOGExNkJFYTE4NGI0MWM1OTNCODkyNWE2' +
  'NjgzMEJjNiIsImFtb3VudCI6IjEwMDAwIiwidmFsaWRVbnRpbCI6MTc5MjIzMzQ4N30.' +
  'upSN4bcrrGOsn4x9i1wWGtqFYtE1FDdS7Nd3LX1o7Mr0mQ1B3BxUgrROm5BBVCu3RmjC2Zgu0wCGY0jcqbXWAA'

const RUWE_SLEUTEL = Buffer.from('8987018e323f0889098deec91619bb0bf78dc6c933ccc95ba17242ec80dcdff5', 'hex')

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58encode(buf) {
  let getal = 0n
  for (const b of buf) getal = getal * 256n + BigInt(b)
  let uit = ''
  while (getal > 0n) { uit = B58[Number(getal % 58n)] + uit; getal /= 58n }
  for (const b of buf) { if (b === 0) uit = '1' + uit; else break }
  return uit
}

/** Een Multikey zoals did-core hem wil: multibase over multicodec 0xed01 plus de sleutel. */
const multikey = (sleutel) => 'z' + base58encode(Buffer.concat([Buffer.from('ed01', 'hex'), sleutel]))

const DID_DOCUMENT = {
  '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2020/v1'],
  id: KID.split('#')[0],
  verificationMethod: [
    { id: KID, type: 'Multikey', controller: KID.split('#')[0], publicKeyMultibase: multikey(RUWE_SLEUTEL) },
    {
      id: KID + '-jwk',
      type: 'JsonWebKey2020',
      controller: KID.split('#')[0],
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: RUWE_SLEUTEL.toString('base64url') },
    },
  ],
}

/** Een nep-fetch, zodat deze test geen enkel verzoek naar buiten doet. */
const nepFetch = (doc, { status = 200 } = {}) => async (url) => ({
  ok: status === 200,
  status,
  json: async () => doc,
  _url: url,
})

// ── het echte artefact verifieert ────────────────────────────────────────────
{
  const r = await verifyOfferSignature({ format: 'jws', signature: ECHTE_JWS }, { fetchImpl: nepFetch(DID_DOCUMENT) })
  toets('het echte jws-aanbod verifieert', r.ok === true, r.reden)
  toets('de ondertekenaar is de kid uit de header', r.signer === KID, r.signer)
  toets('de offer-lading komt mee terug', r.payload?.resourceUrl?.includes('daedalus') === true)
  toets('de lading heeft de velden die de spec voor een offer noemt',
    ['version', 'resourceUrl', 'scheme', 'network', 'asset', 'payTo', 'amount', 'validUntil'].every((k) => k in (r.payload ?? {})))
}

// ── de sleutelcodering is zelf een uitslag ───────────────────────────────────
{
  toets('een correcte multikey rendert als z6Mk', multikey(RUWE_SLEUTEL).startsWith('z6Mk'), multikey(RUWE_SLEUTEL).slice(0, 8))
  const r = await verifyOfferSignature({ format: 'jws', signature: ECHTE_JWS }, { fetchImpl: nepFetch(DID_DOCUMENT) })
  toets('met prefix verifieert de handtekening en valt er niets te melden',
    r.ok === true && r.codering === 'multicodec ed25519-pub' && r.afwijking === undefined, r.reden ?? r.codering)

  // Een sleutel ZONDER die prefix komt in het veld voor. Onze controle hoort de
  // handtekening dan nog te kunnen beoordelen, maar de afwijking te MELDEN in plaats
  // van hem te verzwijgen achter een groene uitslag. Met een zelf gemaakt sleutelpaar
  // getoetst, zodat dit geval over de SPECIFICATIE gaat en niet over een partij.
  const { generateKeyPairSync, sign: edSign } = await import('node:crypto')
  const paar = generateKeyPairSync('ed25519')
  const ruw = paar.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  const kop = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: KID }), 'utf8').toString('base64url')
  const lading = Buffer.from(JSON.stringify({ version: 1, amount: '1' }), 'utf8').toString('base64url')
  const sig = edSign(null, Buffer.from(kop + '.' + lading, 'ascii'), paar.privateKey).toString('base64url')
  const kaalDoc = { verificationMethod: [{ id: KID, type: 'Multikey', publicKeyMultibase: 'z' + base58encode(ruw) }] }
  const r2 = await verifyOfferSignature({ format: 'jws', signature: kop + '.' + lading + '.' + sig }, { fetchImpl: nepFetch(kaalDoc) })
  toets('zonder prefix verifieert de handtekening nog wel', r2.ok === true, r2.reden)
  toets('en de afwijking wordt gemeld in plaats van verzwegen', typeof r2.afwijking === 'string' && r2.afwijking.length > 20, String(r2.afwijking))
  toets('met de codering erbij', r2.codering === 'raw 32 bytes', r2.codering)
}

// ── de jwk-vorm werkt ook ────────────────────────────────────────────────────
{
  const jwkDoc = { verificationMethod: [{ id: KID, type: 'JsonWebKey2020', publicKeyJwk: DID_DOCUMENT.verificationMethod[1].publicKeyJwk }] }
  const r = await verifyOfferSignature({ format: 'jws', signature: ECHTE_JWS }, { fetchImpl: nepFetch(jwkDoc) })
  toets('publicKeyJwk werkt net zo goed', r.ok === true && r.codering === 'publicKeyJwk', r.reden ?? r.codering)
  toets('dezelfde bytes in jwk-vorm', sleutelUitVerificationMethod(DID_DOCUMENT.verificationMethod[1]).codering === 'publicKeyJwk')
}

// ── de faalpaden, en het verschil tussen kon-niet en klopt-niet ──────────────
{
  const geknoeid = ECHTE_JWS.slice(0, -4) + 'AAAA'
  const r = await verifyOfferSignature({ format: 'jws', signature: geknoeid }, { fetchImpl: nepFetch(DID_DOCUMENT) })
  toets('een geknoeide handtekening faalt', r.ok === false && !r.ongemeten, JSON.stringify(r).slice(0, 80))
  toets('en zegt dat de handtekening niet verifieert', /does not verify/.test(r.reden), r.reden)
}
{
  // Een ander algoritme is NIET ondersteund, en dat is iets anders dan ongeldig.
  const kop = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KID }), 'utf8').toString('base64url')
  const r = await verifyOfferSignature({ format: 'jws', signature: kop + '.eyJ9.AAAA' }, { fetchImpl: nepFetch(DID_DOCUMENT) })
  toets('een onbekend alg is ongemeten, geen mislukking', r.ok === false && r.ongemeten === true, JSON.stringify(r).slice(0, 90))
  toets('en noemt het alg bij naam', /ES256/.test(r.reden), r.reden)
}
{
  const kop = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'did:key:z6MkTest' }), 'utf8').toString('base64url')
  const r = await verifyOfferSignature({ format: 'jws', signature: kop + '.eyJ9.AAAA' }, { fetchImpl: nepFetch(DID_DOCUMENT) })
  toets('een kid die geen did:web is, is ongemeten', r.ok === false && r.ongemeten === true, r.reden)
}
{
  const r = await verifyOfferSignature({ format: 'jws', signature: ECHTE_JWS }, { fetchImpl: nepFetch({ verificationMethod: [] }) })
  toets('een did-document zonder die sleutel faalt, en is niet ongemeten', r.ok === false && !r.ongemeten, JSON.stringify(r).slice(0, 80))
}
{
  const r = await verifyOfferSignature({ format: 'jws', signature: ECHTE_JWS }, { fetchImpl: nepFetch(null, { status: 404 }) })
  toets('een did-document dat niet op te halen is, is ongemeten', r.ok === false && r.ongemeten === true, r.reden)
}
{
  const r = await verifyOfferSignature({ format: 'jws', signature: 'geen.jws' }, { fetchImpl: nepFetch(DID_DOCUMENT) })
  toets('iets dat geen compacte jws is, faalt netjes', r.ok === false && /three-part/.test(r.reden), r.reden)
}
{
  const r = await verifyOfferSignature({ format: 'cose', signature: 'x' })
  toets('een onbekend formaat wordt bij naam genoemd', r.ok === false && /cose/.test(r.reden), r.reden)
}

// ── did:web naar url ─────────────────────────────────────────────────────────
{
  toets('did:web zonder pad gaat naar /.well-known/did.json',
    didWebNaarUrl('did:web:example.com') === 'https://example.com/.well-known/did.json')
  toets('did:web met pad gaat naar dat pad',
    didWebNaarUrl('did:web:example.com:user:alice') === 'https://example.com/user/alice/did.json')
  toets('een poort in de did wordt gedecodeerd',
    didWebNaarUrl('did:web:example.com%3A3000') === 'https://example.com:3000/.well-known/did.json')
  let wierp = false
  try { didWebNaarUrl('did:key:z6Mk') } catch { wierp = true }
  toets('een did die geen did:web is wordt geweigerd', wierp)
}

console.log('')
console.log('jws offers: ' + goed + ' pass, ' + fout + ' fail')
if (fout > 0) process.exitCode = 1
