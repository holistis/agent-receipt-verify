// Live benchmark voor eip3009-nonce-check.mjs: haalt een ECHTE, al verbruikte EIP-3009-
// machtiging van Base mainnet, en een verse, nooit gebruikte nonce voor hetzelfde adres, en
// laat verifieerDuplicatePaymentOpChain allebei langs de echte keten beoordelen. Draait met
// het netwerk, dus NIET in de testsuite (zelfde regel als bench/ground-record.mjs).
//
// WAAROM EEN ECHTE LOG EN GEEN ZELFGEMAAKT ANTWOORD. Een zelfgebouwd "authorizationState geeft
// true terug" bewijst alleen dat onze code intern consistent is met wat wij DACHTEN dat de
// keten zegt. Een AuthorizationUsed-event dat het token-contract zelf ooit uitzond, gevolgd
// door een live eth_call die authorizationState() op diezelfde (authorizer, nonce) bevraagt,
// is onafhankelijk van onze aannames: als de twee niet overeenkomen is DAT de bevinding.
//
// Gebruik: node bench/duplicate-payment-onchain.mjs [--netwerk=eip155:8453] [--blokken=5000]

import { randomBytes } from 'node:crypto'
import { AUTHORIZATION_USED_TOPIC, NETWERKEN } from '../src/x402-grounding.mjs'
import { rpcVoorNetwerk, verifieerDuplicatePaymentOpChain } from '../src/eip3009-nonce-check.mjs'

const vlag = (n, standaard) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? standaard
const NETWORK = vlag('netwerk', 'eip155:8453')
const START_BLOKKEN = Number(vlag('blokken', '5000'))
const cfg = NETWERKEN[NETWORK]
if (!cfg) { console.error('onbekend netwerk ' + NETWORK); process.exit(2) }

// NETWERKEN[...].rpc (mainnet.base.org) weigert eth_getLogs voor publieke aanroepers hard,
// op ELKE vensterbreedte, zelfs fromBlock=toBlock='latest' ("request limit reached") --
// live geconstateerd 11 nov 2026, geen aanname. eth_call/eth_blockNumber/eth_chainId werken
// daar wel. Twee andere publieke eindpunten bleken bij dezelfde live proef eth_getLogs WEL
// toe te staan: base-rpc.publicnode.com en base.drpc.org (llamarpc gaf geen geldige JSON-RPC
// terug op een kale POST). Alleen DEZE benchmark gebruikt daarom een eigen override, de
// gedeelde NETWERKEN-config (en de rest van dit pakket, dat nooit getLogs aanroept) blijft
// ongewijzigd.
const RPC_URL = vlag('rpc', NETWORK === 'eip155:8453' ? 'https://base-rpc.publicnode.com' : cfg.rpc)

const nu = () => performance.now()
const rondTijd = (ms) => Math.round(ms) + 'ms'
// TWEE APARTE TELLINGEN, bewust niet gemengd: `meet()` instrumenteert ELKE netwerkaanroep
// (ook de opzoekstap die een log zoekt, geen beweringstoets) en telt dus niet mee in het
// eindoordeel; alleen `toets()` is een echte, benoemde bewering met een verwachte uitkomst.
// Een eerdere versie van dit bestand telde ze samen en drukte "10 of 12" af terwijl alle 10
// ECHTE toetsen slaagden -- zelf gevonden tijdens de eerste live-run, 11 nov 2026.
let toetsen = 0, toetsenGeslaagd = 0
const meet = async (naam, fn) => {
  const t0 = nu()
  let uit, fout
  try { uit = await fn() } catch (e) { fout = e }
  const duur = nu() - t0
  if (fout) { console.log('  FOUT  ' + naam.padEnd(58) + rondTijd(duur) + '  <- ' + fout.message); return { fout } }
  return { uit, duur }
}
const toets = (naam, ok, extra = '') => {
  toetsen++
  if (ok) { toetsenGeslaagd++; console.log('  ok    ' + naam) } else { console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

console.log('duplicate_payment / CHAIN_VERIFIABLE tegen de echte keten, netwerk ' + cfg.naam + ' (' + NETWORK + ')')
console.log('')

const rpc = rpcVoorNetwerk(NETWORK, RPC_URL)
console.log('rpc: ' + RPC_URL)

// ── stap 1: een ECHTE, al verbruikte machtiging vinden ─────────────────────────────────────
console.log('1. een echte AuthorizationUsed-log zoeken op USDC (' + cfg.usdc + ')')
let gevonden = null
{
  const blokHex = await meet('eth_blockNumber', () => rpc('eth_blockNumber', []))
  if (blokHex.fout) { console.log('kon niet verder zonder blokhoogte, gestopt.'); process.exit(2) }
  const laatste = parseInt(blokHex.uit, 16)
  let venster = START_BLOKKEN
  for (let poging = 0; poging < 4 && !gevonden; poging++) {
    const vanaf = Math.max(0, laatste - venster)
    const r = await meet('eth_getLogs (venster ' + venster + ' blokken)', () => rpc('eth_getLogs', [{
      address: cfg.usdc, topics: [AUTHORIZATION_USED_TOPIC],
      fromBlock: '0x' + vanaf.toString(16), toBlock: '0x' + laatste.toString(16),
    }]))
    if (r.fout) { venster = Math.floor(venster / 2); continue }
    if (Array.isArray(r.uit) && r.uit.length > 0) {
      const log = r.uit[r.uit.length - 1]
      gevonden = {
        authorizer: '0x' + log.topics[1].slice(-40).toLowerCase(),
        nonce: log.topics[2].toLowerCase(),
        blok: parseInt(log.blockNumber, 16),
        tx: log.transactionHash,
        opHaalTijd: r.duur,
      }
    } else {
      venster = venster * 2
    }
  }
}
if (!gevonden) {
  console.log('  geen AuthorizationUsed-log gevonden binnen de geprobeerde vensters, gestopt (eerlijk: NOT_MEASURED, geen gok).')
  process.exit(2)
}
console.log('  gevonden: authorizer ' + gevonden.authorizer + ', nonce ' + gevonden.nonce.slice(0, 18) + '..., blok ' + gevonden.blok + ', tx ' + gevonden.tx)
console.log('  (ophalen van deze log: ' + rondTijd(gevonden.opHaalTijd) + ')')
console.log('')

// ── stap 2: bouw een x402-betaling + rejection receipt rond beide gevallen ─────────────────
const paymentRequirements = (nonce) => ({ scheme: 'exact', network: NETWORK, asset: cfg.usdc, payTo: gevonden.authorizer })
const paymentPayload = (nonce) => ({
  accepted: { scheme: 'exact', network: NETWORK, asset: cfg.usdc, extra: { assetTransferMethod: 'eip3009' } },
  payload: { authorization: { from: gevonden.authorizer, to: gevonden.authorizer, value: '1', validAfter: '0', validBefore: '9999999999', nonce } },
})
const receipt = (reasonCode = 'duplicate_payment', evidenceClass = 'CHAIN_VERIFIABLE') => ({
  decision: { outcome: 'REJECTED', reason_code: reasonCode, evidence_class: evidenceClass },
})

// ── stap 3: de echt verbruikte nonce -> moet PASS ──────────────────────────────────────────
console.log('2. de echt verbruikte nonce: authorizationState moet true geven, de checker moet PASS geven')
{
  const r = await meet('authorizationState(authorizer, echte nonce)', () => verifieerDuplicatePaymentOpChain(
    receipt(), paymentPayload(gevonden.nonce), paymentRequirements(), { rpc },
  ))
  toets('echte, al verbruikte nonce geeft PASS', !r.fout && r.uit?.outcome === 'PASS', JSON.stringify(r.uit))
}
console.log('')

// ── stap 4: een verse, nooit gebruikte nonce voor HETZELFDE adres -> moet FAIL ─────────────
console.log('3. een verse, nooit gebruikte nonce voor datzelfde adres: moet FAIL geven, niet PASS')
const verseNonce = '0x' + randomBytes(32).toString('hex')
{
  const r = await meet('authorizationState(authorizer, verse nonce)', () => verifieerDuplicatePaymentOpChain(
    receipt(), paymentPayload(verseNonce), paymentRequirements(), { rpc },
  ))
  toets('verse nonce geeft FAIL (DUPLICATE_PAYMENT_NOT_CONFIRMED_ON_CHAIN), nooit stilzwijgend PASS',
    !r.fout && r.uit?.outcome === 'FAIL' && r.uit?.reason_code === 'DUPLICATE_PAYMENT_NOT_CONFIRMED_ON_CHAIN', JSON.stringify(r.uit))
}
console.log('')

// ── stap 5: mutatiematrix (Test de tester) -- elke afwijking moet een duidelijke, EERLIJKE uitkomst geven, nooit een stille PASS ──
console.log('4. mutatiematrix: elke afwijking van het gewone pad, en wat die werkelijk teruggeeft')
{
  const basis = [receipt(), paymentPayload(gevonden.nonce), paymentRequirements()]

  const nietAfgewezen = { decision: { outcome: 'ACCEPTED', reason_code: 'duplicate_payment', evidence_class: 'CHAIN_VERIFIABLE' } }
  let r = await meet('decision.outcome gewijzigd naar ACCEPTED (al-Khasm, 11 nov 2026)', () => verifieerDuplicatePaymentOpChain(nietAfgewezen, basis[1], basis[2], { rpc }))
  toets('[wijzigen] een niet-REJECTED briefje -> NOT_MEASURED/OUT_OF_SCOPE_DECISION_OUTCOME, ook al wijst de echte chain-staat naar PASS', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'OUT_OF_SCOPE_DECISION_OUTCOME', JSON.stringify(r.uit))

  r = await meet('reason_code gewijzigd naar insufficient_funds', () => verifieerDuplicatePaymentOpChain(receipt('insufficient_funds'), basis[1], basis[2], { rpc }))
  toets('[wijzigen] andere reason_code -> NOT_MEASURED/OUT_OF_SCOPE_REASON_CODE, nooit beoordeeld', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'OUT_OF_SCOPE_REASON_CODE', JSON.stringify(r.uit))

  r = await meet('evidence_class gewijzigd naar ISSUER_ASSERTED', () => verifieerDuplicatePaymentOpChain(receipt('duplicate_payment', 'ISSUER_ASSERTED'), basis[1], basis[2], { rpc }))
  toets('[wijzigen] lager bewijsniveau -> NOT_MEASURED/OUT_OF_SCOPE_EVIDENCE_CLASS', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'OUT_OF_SCOPE_EVIDENCE_CLASS', JSON.stringify(r.uit))

  const permit2Payload = { ...basis[1], accepted: { ...basis[1].accepted, extra: { assetTransferMethod: 'permit2' } } }
  r = await meet('transfer-methode gewijzigd naar permit2', () => verifieerDuplicatePaymentOpChain(basis[0], permit2Payload, basis[2], { rpc }))
  toets('[wijzigen] permit2 i.p.v. eip3009 -> NOT_MEASURED/OUT_OF_SCOPE_TRANSFER_METHOD, geen gok op een nonce-mapping die daar niet bestaat', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'OUT_OF_SCOPE_TRANSFER_METHOD', JSON.stringify(r.uit))

  const verkeerdNetwerk = { ...basis[2], network: 'eip155:999999999' }
  r = await meet('netwerk omgewisseld naar een chain die de echte rpc niet is', () => verifieerDuplicatePaymentOpChain(basis[0], basis[1], verkeerdNetwerk, { rpc }))
  toets('[omwisselen] betaling claimt een andere chain dan de live rpc -> NOT_MEASURED/RPC_CHAIN_MISMATCH, nooit zomaar doorgerekend', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'RPC_CHAIN_MISMATCH', JSON.stringify(r.uit))

  const afgekapt = { ...basis[1], payload: { authorization: { ...basis[1].payload.authorization, nonce: gevonden.nonce.slice(0, 20) } } }
  r = await meet('nonce afgekapt tot 9 bytes', () => verifieerDuplicatePaymentOpChain(basis[0], afgekapt, basis[2], { rpc }))
  toets('[afkappen] een te korte nonce -> NOT_MEASURED/MALFORMED_INPUT, geen eth_call met kapotte data', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'MALFORMED_INPUT', JSON.stringify(r.uit))

  const legeAsset = { ...basis[2], asset: '0x' + '0'.repeat(40) }
  r = await meet('asset omgewisseld naar het nul-adres (geen contract)', () => verifieerDuplicatePaymentOpChain(basis[0], basis[1], legeAsset, { rpc }))
  toets('[omwisselen] contractadres zonder code -> NOT_MEASURED/RPC_UNAVAILABLE, nooit een geraden true/false', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'RPC_UNAVAILABLE', JSON.stringify(r.uit))

  r = await meet('rpc weggehaald (geen functie meegegeven)', () => verifieerDuplicatePaymentOpChain(basis[0], basis[1], basis[2], {}))
  toets('[weghalen] geen rpc geconfigureerd -> NOT_MEASURED/NO_RPC_CONFIGURED, crasht niet', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'NO_RPC_CONFIGURED', JSON.stringify(r.uit))

  const kapotteRpc = async (m) => { if (m === 'eth_chainId') return '0x' + BigInt(NETWORK.split(':')[1]).toString(16); throw new Error('node onbereikbaar (gesimuleerd)') }
  r = await meet('rpc die faalt op het echte eth_call (gesimuleerd, geen netwerk)', () => verifieerDuplicatePaymentOpChain(basis[0], basis[1], basis[2], { rpc: kapotteRpc }))
  toets('[toevoegen] een rpc-fout op het beslissende moment -> NOT_MEASURED/RPC_UNAVAILABLE, nooit een PASS door een lege catch', r.uit?.outcome === 'NOT_MEASURED' && r.uit?.reason_code === 'RPC_UNAVAILABLE', JSON.stringify(r.uit))
}

console.log('')
console.log(toetsenGeslaagd + ' of ' + toetsen + ' benoemde toetsen gedragen zich zoals genoteerd (de log-opzoekstap hierboven is geen toets en telt hier niet in mee).')
console.log('Alles hier is een ECHTE aanroep tegen ' + cfg.naam + ', geen gesimuleerd antwoord, behalve de twee expliciet gelabelde "gesimuleerd"-gevallen in de mutatiematrix.')
console.log('Dit dekt alleen exact/eip3009 op ' + NETWORK + '; Permit2, ERC-7710, en de attempt_binding-hashkoppeling zelf blijven genoemde, niet gebouwde beperkingen (zie src/eip3009-nonce-check.mjs).')
if (toetsenGeslaagd !== toetsen) process.exitCode = 1
