// Test voor de conformance-ladder, zonder netwerk.
//
// Het positieve geval gebruikt een ECHT ondertekend aanbod van onze live route,
// zodat trede 2 ook offline aantoonbaar groen kan worden en niet alleen rood. Een
// test die uitsluitend de faalpaden dekt, bewijst niet dat de meetlat ook iets
// goedkeurt, en dan weet je nog niet of hij werkt.
//
// De belangrijkste gevallen zijn de drie soorten "nee" die niet hetzelfde zijn:
// niet bereikbaar (ongemeten), 402 zonder voorwaarden (haalt niet), en een
// declaratie zonder geldige handtekening (haalt niet). Een meetlat die die drie
// op een hoop gooit, meet niets.

import { meetEindpunt, hoogsteTrede } from '../src/x402-conformance-check.mjs'
import { TREDEN, verifyOfferSignature } from '../src/x402-conformance-treden.mjs'

let goed = 0
let fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const ECHT_AANBOD = {
  format: 'eip712',
  payload: {
    version: 1,
    resourceUrl: 'https://api.tokenizen.nl/api/paid/verify-ownership',
    scheme: 'exact',
    network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x2888F36548a900B9b08d584524e1f73BC563eC26',
    amount: '1000',
    validUntil: 1792228139,
  },
  signature:
    '0x7f02d1fce02d36e87e14fc8a74b53cbb3c41c1249cfa1515e4a691161be201623e2cf9b130170fc50bf2f765df11a78114529115c8df88058a30237ec196ec381c',
}
const ONZE_ONDERTEKENAAR = '0x4E1174b774643B6AD9EE966A81ea1e3665D1159a'

const ACCEPTS_OK = {
  scheme: 'exact',
  network: 'eip155:84532',
  amount: '1000',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  payTo: '0x2888F36548a900B9b08d584524e1f73BC563eC26',
}

/** Een nagemaakt eindpunt. `kop` zet het aanbod in de header in plaats van het lichaam. */
function nep({ status = 402, lichaam = null, kop = false, stuk = false } = {}) {
  return async () => {
    if (stuk) throw new Error('fetch failed')
    const json = lichaam === null ? '' : JSON.stringify(lichaam)
    const headers = new Map()
    if (kop && lichaam !== null) {
      headers.set('payment-required', Buffer.from(json, 'utf8').toString('base64'))
    }
    return {
      status,
      headers: { keys: () => headers.keys(), get: (k) => headers.get(k.toLowerCase()) ?? null },
      text: async () => (kop ? '{}' : json),
    }
  }
}

console.log('the three kinds of no are not the same')
{
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ stuk: true }) })
  toets('unreachable reports not-measured, not failed', m.treden.t0 === 'ONGEMETEN', m.treden.t0)
  toets('and the reason comes with it', /not reachable/.test(m.bewijs.t0))
}
{
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ status: 200, lichaam: { ok: true } }) })
  toets('a 200 instead of a 402 fails level 0', m.treden.t0 === 'HAALT_NIET' && /instead of 402/.test(m.bewijs.t0))
}
{
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam: null }) })
  toets('a 402 carrying no requirements fails level 0', m.treden.t0 === 'HAALT_NIET')
  toets('and says they were in neither the header nor the body', /neither in the header nor in the body/.test(m.bewijs.t0))
}
{
  const zonderPayTo = { ...ACCEPTS_OK }
  delete zonderPayTo.payTo
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam: { accepts: [zonderPayTo] } }) })
  toets('a missing field is named', /payTo/.test(m.bewijs.t0), m.bewijs.t0)
}
{
  const zonderBedrag = { ...ACCEPTS_OK }
  delete zonderBedrag.amount
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam: { accepts: [zonderBedrag] } }) })
  toets('a missing amount fails level 0', m.treden.t0 === 'HAALT_NIET' && /an amount/.test(m.bewijs.t0))
}

console.log('the ladder climbs and stops where it stops')
{
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam: { accepts: [ACCEPTS_OK] } }) })
  toets('level 0 reached with no extensions', m.treden.t0 === 'HAALT')
  toets('level 1 not reached, with the reason', m.treden.t1 === 'HAALT_NIET' && /no extensions/.test(m.bewijs.t1))
  toets('highest level is 0', hoogsteTrede(m) === 0)
  toets('level 2 is not even reported when 1 fails', m.treden.t2 === undefined)
}
{
  const lichaam = { accepts: [ACCEPTS_OK], extensions: { 'offer-receipt': { info: {} } } }
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam }) })
  toets('declaring without an offer reaches 1 but not 2', m.treden.t1 === 'HAALT' && m.treden.t2 === 'HAALT_NIET')
  toets('and says there is no signed offer in it', /no signed offer/.test(m.bewijs.t2))
  toets('highest level is 1', hoogsteTrede(m) === 1)
}

console.log('a real signed offer reaches level 2, also from the header')
{
  const lichaam = { accepts: [ACCEPTS_OK], extensions: { 'offer-receipt': { info: { offers: [ECHT_AANBOD] } } } }
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam }) })
  toets('level 2 reached', m.treden.t2 === 'HAALT', m.bewijs.t2)
  toets('and the signer is ours', m.bewijs.t2.includes(ONZE_ONDERTEKENAAR), m.bewijs.t2)
  toets('highest level is 2', hoogsteTrede(m) === 2)
  toets('levels 3 to 5 are not-measured, not failed', ['t3', 't4', 't5'].every((t) => m.treden[t] === 'ONGEMETEN'))

  // Onze eigen route zet de voorwaarden in de header en laat het lichaam leeg.
  // Een meetlat die dat niet kan lezen, keurt ons eigen endpoint af.
  const viaKop = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam, kop: true }) })
  toets('the same offer read from the Payment-Required header scores the same', hoogsteTrede(viaKop) === 2)
}

console.log('a tampered signature fails level 2')
{
  const stuk = { ...ECHT_AANBOD, payload: { ...ECHT_AANBOD.payload, amount: '999999' } }
  const lichaam = { accepts: [ACCEPTS_OK], extensions: { 'offer-receipt': { info: { offers: [stuk] } } } }
  const m = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam }) })
  toets('a changed amount recovers a different signer', m.treden.t2 === 'HAALT' ? !m.bewijs.t2.includes(ONZE_ONDERTEKENAAR) : true, m.bewijs.t2)
  const rommel = { format: 'eip712', payload: ECHT_AANBOD.payload, signature: '0xdeadbeef' }
  const l2 = { accepts: [ACCEPTS_OK], extensions: { 'offer-receipt': { info: { offers: [rommel] } } } }
  const m2 = await meetEindpunt('https://x/y', { fetchImpl: nep({ lichaam: l2 }) })
  toets('a nonsense signature fails level 2', m2.treden.t2 === 'HAALT_NIET', m2.bewijs.t2)
}

console.log('the ladder is data, and the result points at it')
{
  toets('six levels', TREDEN.length === 6)
  toets('every level states its requirement', TREDEN.every((t) => String(t.eis).length > 20))
  toets('three are observable without paying and three are not', TREDEN.filter((t) => t.meetbaarZonderTeBetalen).length === 3)
  const v = await verifyOfferSignature(null)
  toets('an empty artifact is refused cleanly', v.ok === false)
}

console.log('\n' + goed + ' passed, ' + fout + ' failed')
process.exitCode = fout === 0 ? 0 : 1
