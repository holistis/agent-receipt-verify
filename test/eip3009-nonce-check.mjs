// Test voor eip3009-nonce-check.mjs: checkt een duplicate_payment/CHAIN_VERIFIABLE-claim
// tegen een ECHTE of een NAGEMAAKTE keten. Dit bestand draait zonder netwerk (nagemaakte rpc,
// zelfde stijl als test/grounding.mjs); de live, echte keten-proef staat apart in
// bench/duplicate-payment-onchain.mjs (bench/ground-record.mjs-regel: live draait NIET hier).

import { AUTHORIZATION_STATE_SELECTOR, leesAuthorizationState, verifieerDuplicatePaymentOpChain } from '../src/eip3009-nonce-check.mjs'

let goed = 0, fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const FROM = '0x' + 'c9'.repeat(20)
const NONCE = '0x' + '11'.repeat(32)
const WAAR = '0x' + '0'.repeat(63) + '1'
const ONWAAR = '0x' + '0'.repeat(64)

function nepRpc({ chainId = 8453n, authorizationStateUit = () => WAAR, chainIdFout = null, callFout = null } = {}) {
  return async (method) => {
    if (method === 'eth_chainId') {
      if (chainIdFout) throw new Error(chainIdFout)
      return '0x' + chainId.toString(16)
    }
    if (method === 'eth_call') {
      if (callFout) throw new Error(callFout)
      return authorizationStateUit()
    }
    throw new Error('onverwachte methode ' + method)
  }
}

const receipt = (overrides = {}) => ({ decision: { outcome: 'REJECTED', reason_code: 'duplicate_payment', evidence_class: 'CHAIN_VERIFIABLE', ...overrides } })
const basisAuthorization = { from: FROM, to: FROM, value: '1', validAfter: '0', validBefore: '9999999999', nonce: NONCE }
const payload = (overrides = {}) => ({
  accepted: { scheme: 'exact', network: 'eip155:8453', asset: ASSET, extra: { assetTransferMethod: 'eip3009' } },
  payload: { authorization: basisAuthorization },
  ...overrides,
})
const requirements = (overrides = {}) => ({ network: 'eip155:8453', asset: ASSET, ...overrides })

console.log('de hoofdcontrole: een echt verbruikte nonce is PASS, een verse nonce is FAIL')
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), { rpc: nepRpc() })
  toets('authorizationState true -> PASS', uit.outcome === 'PASS')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), { rpc: nepRpc({ authorizationStateUit: () => ONWAAR }) })
  toets('authorizationState false -> FAIL, nooit PASS', uit.outcome === 'FAIL' && uit.reason_code === 'DUPLICATE_PAYMENT_NOT_CONFIRMED_ON_CHAIN')
}

console.log('scope: alleen een echt REJECTED briefje met duplicate_payment/CHAIN_VERIFIABLE, al het andere is NOT_MEASURED')
{
  // al-Khasm, 11 nov 2026: zonder deze guard gaf een "ACCEPTED"-briefje met reason_code
  // duplicate_payment/evidence_class CHAIN_VERIFIABLE hier gewoon een PASS/FAIL -- dezelfde
  // foutklasse als het "liegende briefje"-gat dat toetsAfwijzingsBon() al eerder dichtte.
  const uit = await verifieerDuplicatePaymentOpChain(receipt({ outcome: 'ACCEPTED' }), payload(), requirements(), { rpc: nepRpc() })
  toets('decision.outcome ACCEPTED blijft buiten bereik, nooit stilzwijgend PASS/FAIL', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'OUT_OF_SCOPE_DECISION_OUTCOME')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt({ outcome: undefined }), payload(), requirements(), { rpc: nepRpc() })
  toets('decision.outcome ontbrekend blijft buiten bereik', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'OUT_OF_SCOPE_DECISION_OUTCOME')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt({ reason_code: 'insufficient_funds' }), payload(), requirements(), { rpc: nepRpc() })
  toets('andere reason_code blijft buiten bereik', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'OUT_OF_SCOPE_REASON_CODE')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt({ evidence_class: 'ISSUER_ASSERTED' }), payload(), requirements(), { rpc: nepRpc() })
  toets('lager bewijsniveau blijft buiten bereik (niets om narekenen)', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'OUT_OF_SCOPE_EVIDENCE_CLASS')
}
{
  const p = payload({ accepted: { scheme: 'exact', network: 'eip155:8453', asset: ASSET, extra: { assetTransferMethod: 'permit2' } } })
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), p, requirements(), { rpc: nepRpc() })
  toets('permit2 heeft geen vergelijkbare nonce-mapping, blijft buiten bereik', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'OUT_OF_SCOPE_TRANSFER_METHOD')
}
{
  const p = payload({ accepted: { scheme: 'upto', network: 'eip155:8453', asset: ASSET } })
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), p, requirements(), { rpc: nepRpc() })
  toets('een ander scheme (upto) blijft buiten bereik', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'OUT_OF_SCOPE_TRANSFER_METHOD')
}

console.log('formaat: een netwerk, adres of nonce die er niet uitziet zoals verwacht is NOT_MEASURED, nooit een gok')
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements({ network: 'base-mainnet' }), { rpc: nepRpc() })
  toets('geen eip155:<id>-netwerk', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'UNSUPPORTED_NETWORK_FORMAT')
}
{
  // al-Mustamil, 11 nov 2026: een 20 miljoen tekens lange network-string liet BigInt(...) op de
  // echte machine 8,7 SECONDEN synchroon blokkeren (gemeten, geen schatting). De lengtegrens
  // moet VOOR die aanroep zitten; deze test gebruikt "slechts" 200.000 tekens zodat de test-
  // suite zelf niet traag wordt, maar bewijst dat de grens al bij een korte, snelle afwijzing
  // dichtklapt in plaats van door te rekenen.
  const t0 = performance.now()
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements({ network: 'eip155:' + '9'.repeat(200_000) }), { rpc: nepRpc() })
  const duur = performance.now() - t0
  toets('een absurd lange network-string klapt meteen dicht, geen BigInt-parse van 200.000 cijfers', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'UNSUPPORTED_NETWORK_FORMAT' && duur < 50, 'duurde ' + Math.round(duur) + 'ms')
  toets('de lange string komt niet ongefilterd/onbegrensd terug in detail', uit.detail.length < 200)
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements({ asset: 'niet-een-adres' }), { rpc: nepRpc() })
  toets('onleesbaar asset-adres', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'MALFORMED_INPUT')
}
{
  const p = payload({ payload: { authorization: { ...basisAuthorization, from: '0xkort' } } })
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), p, requirements(), { rpc: nepRpc() })
  toets('onleesbaar from-adres', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'MALFORMED_INPUT')
}
{
  const p = payload({ payload: { authorization: { ...basisAuthorization, nonce: '0x1234' } } })
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), p, requirements(), { rpc: nepRpc() })
  toets('afgekapte nonce (geen volle bytes32)', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'MALFORMED_INPUT')
}

console.log('rpc: ontbrekend, verkeerde chain, of een echte fout is altijd NOT_MEASURED, nooit geraden')
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), {})
  toets('geen rpc meegegeven ({})', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'NO_RPC_CONFIGURED')
}
{
  // al-Mustamil, 11 nov 2026: `{ rpc } = {}` als default vangt een expliciete `null` NIET op
  // (JS-default-parameters slaan alleen aan op `undefined`) -- gaf een rauwe TypeError i.p.v.
  // een net resultaat. Een vierde argument dat `null` is, is een alledaags JSON/config-patroon.
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), null)
  toets('vierde argument is null (geen {} en niet weggelaten), geen crash', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'NO_RPC_CONFIGURED')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements())
  toets('vierde argument helemaal weggelaten, geen crash', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'NO_RPC_CONFIGURED')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), { rpc: nepRpc({ chainId: 1n }) })
  toets('rpc praat met chain 1, de betaling claimt 8453: RPC_CHAIN_MISMATCH, niet zomaar doorgerekend', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'RPC_CHAIN_MISMATCH')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), { rpc: nepRpc({ chainIdFout: 'node onbereikbaar' }) })
  toets('eth_chainId faalt', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'RPC_UNAVAILABLE')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), { rpc: nepRpc({ callFout: 'execution reverted' }) })
  toets('eth_call faalt (bijvoorbeeld een revert)', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'RPC_UNAVAILABLE')
}
{
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), { rpc: nepRpc({ authorizationStateUit: () => '0x' }) })
  toets('eth_call geeft een leeg antwoord (adres zonder contractcode)', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'RPC_UNAVAILABLE')
}
{
  // al-Mustamil, 11 nov 2026: een rpc die nooit resolvet liet de functie onbeperkt hangen,
  // geen enkele interne tijdslimiet. tijdslimietMs=30 houdt deze test snel, en bewijst dat de
  // race-timeout werkt zonder op de echte RPC_TIJDSLIMIET_MS (15s) te moeten wachten.
  const nooitRpc = async () => new Promise(() => {})
  const t0 = performance.now()
  const uit = await verifieerDuplicatePaymentOpChain(receipt(), payload(), requirements(), { rpc: nooitRpc, tijdslimietMs: 30 })
  const duur = performance.now() - t0
  toets('een rpc die nooit resolvet geeft RPC_TIMEOUT terug, hangt niet onbeperkt', uit.outcome === 'NOT_MEASURED' && uit.reason_code === 'RPC_TIMEOUT' && duur < 2000, 'duurde ' + Math.round(duur) + 'ms, kreeg ' + JSON.stringify(uit))
}

console.log('leesAuthorizationState rechtstreeks')
{
  let uit = await leesAuthorizationState(nepRpc(), { asset: ASSET, from: FROM, nonce: NONCE })
  toets('een waar antwoord wordt boolean true', uit === true)
  uit = await leesAuthorizationState(nepRpc({ authorizationStateUit: () => ONWAAR }), { asset: ASSET, from: FROM, nonce: NONCE })
  toets('een nul-antwoord wordt boolean false', uit === false)
  try {
    await leesAuthorizationState(nepRpc({ authorizationStateUit: () => '0x' }), { asset: ASSET, from: FROM, nonce: NONCE })
    toets('een leeg antwoord gooit, wordt nooit geraden', false)
  } catch (e) {
    toets('een leeg antwoord gooit, wordt nooit geraden', /geen leesbaar antwoord/.test(e.message))
  }
  // al-Mustamil, 11 nov 2026: deze functie is zelf ook `export`-ed, dus rechtstreeks
  // aanroepbaar door een externe gebruiker van dit npm-pakket. Een null/ontbrekend/leeg
  // tweede argument gaf een rauwe "Cannot destructure"/"Cannot read properties"-crash in
  // plaats van een duidelijke, gevangen fout.
  for (const [naam, velden] of [['null', null], ['ontbrekend', undefined], ['leeg object', {}], ['alleen asset', { asset: ASSET }]]) {
    try {
      await leesAuthorizationState(nepRpc(), velden)
      toets('velden=' + naam + ' gooit een duidelijke fout, geen rauwe engine-crash', false)
    } catch (e) {
      toets('velden=' + naam + ' gooit een duidelijke fout, geen rauwe engine-crash', /niet het verwachte formaat/.test(e.message), e.message)
    }
  }
}

console.log('de selector zelf: onafhankelijk herleid, niet uit geheugen overgenomen')
{
  let ethers = null
  try { ethers = await import('ethers') } catch { ethers = null }
  if (ethers) {
    toets('AUTHORIZATION_STATE_SELECTOR komt overeen met wat ethers nu, los van ons, berekent', ethers.id('authorizationState(address,bytes32)').slice(0, 10) === AUTHORIZATION_STATE_SELECTOR)
  } else {
    console.log('  (overslagen: ethers niet geinstalleerd in deze omgeving, selector niet dubbel herleid in deze run)')
  }
}

console.log('waarom de scope-check EERST moet komen: de verkeerde volgorde gesimuleerd, niet alleen beweerd')
{
  // Dezelfde kernlogica als verifieerDuplicatePaymentOpChain, maar ZONDER de reason_code/
  // evidence_class-guard: gaat voor ELKE reden recht naar de keten-aanroep.
  async function verkeerdZonderScopeCheck(receiptIn, paymentPayloadIn, paymentRequirementsIn, { rpc }) {
    const asset = paymentRequirementsIn?.asset
    const from = paymentPayloadIn?.payload?.authorization?.from
    const nonce = paymentPayloadIn?.payload?.authorization?.nonce
    const gebruikt = await leesAuthorizationState(rpc, { asset, from, nonce })
    return gebruikt ? { outcome: 'PASS' } : { outcome: 'FAIL' }
  }
  const insufficientFundsReceipt = receipt({ reason_code: 'insufficient_funds', evidence_class: 'CHAIN_VERIFIABLE' })
  const echte = await verifieerDuplicatePaymentOpChain(insufficientFundsReceipt, payload(), requirements(), { rpc: nepRpc() })
  const verkeerde = await verkeerdZonderScopeCheck(insufficientFundsReceipt, payload(), requirements(), { rpc: nepRpc() })
  toets('de echte functie weigert een insufficient_funds-claim eerlijk', echte.outcome === 'NOT_MEASURED' && echte.reason_code === 'OUT_OF_SCOPE_REASON_CODE')
  toets('zonder de guard had de verkeerde volgorde een stellige PASS gegeven over een vraag die niets met insufficient_funds te doen heeft', verkeerde.outcome === 'PASS')
}

console.log(`\neip3009-nonce-check: ${goed} pass, ${fout} fail`)
process.exitCode = fout === 0 ? 0 : 1
