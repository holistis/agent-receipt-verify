// Is deze ERC-8004-feedback verankerd in een betaling? Een tweede, onafhankelijke implementatie.
//
// WAAROM DIT BESTAAT. In erc-8004/erc-8004-contracts#99 telt AgenticFinanceGraph een feedback
// pas als "grounded" wanneer vier feiten uit de keten zelf volgen: de beoordelaar is de betaler,
// het betaalde adres is de gebonden wallet van de beoordeelde agent, de betaling ligt voor de
// feedback, en de beoordelaar is geen eigenaar of goedgekeurde operator van die agent. Zij
// schreven dat op en controleerden er ons eigen voorbeeld mee. Wij bouwen hier dezelfde vier
// feiten na, uit hun beschrijving en niet uit hun code, zoals we het eerder met de Kanon-
// vectoren deden: twee implementaties die elkaars code niet gezien hebben en toch dezelfde
// uitslag geven, dat is het bewijs. Een vijfde feit staat er los bovenop: opent de
// feedbackHash via het bonnetje (het gezouten commitment van x402#3827) op precies deze
// afrekening, in plaats van dat een lezer moet geloven dat de hash naar de goede transactie wijst.
//
// DE ZEVEN VALKUILEN, en elk is hieronder afgedekt:
//  1. feedbackHash staat ALLEEN in het NewFeedback-event, niet in de opslag van het register.
//     We lezen hem uit de logs van de feedback-transactie.
//  2. De facilitator verstuurt de afrekening, soms via Multicall3. Betaler en ontvanger komen
//     dus uit de USDC Transfer-log, nooit uit tx.from of tx.to, en de log moet van het USDC-
//     adres van die keten komen.
//  3. getAgentWallet op "latest" is niet de binding ten tijde van de betaling. We lezen op het
//     blok van de feedback als het knooppunt dat kan, anders op latest, en de uitslag zegt WELK
//     blok het was. Een bewering over een ander moment dan het gemeten moment is geen meting.
//  4. Volgorde: eerst blokken vergelijken, bij hetzelfde blok de logindex (die loopt door het
//     hele blok, dus is vergelijkbaar tussen twee transacties).
//  5. Een feit dat niet te meten was is "not_measured" en nooit "false": een knooppunt dat een
//     historische aanroep weigert is geen gebrek van de feedback.
//  6. Twee USDC-overdrachten in een transactie: neem die van de beoordelaar, en zeg dat er
//     meer waren.
//  7. Het resultaat is per feit, in de woorden van AgenticFinanceGraph, en daarna pas een
//     eindoordeel. Geen eigen ladder met eigen namen.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { maakRpc, linkBonnetje } from './x402-link-onchain.mjs'

// keccak256 van de handtekeningen, vooraf berekend met ethers en hier vastgelegd zodat dit pakket
// geen keccak-implementatie hoeft mee te slepen.
export const NEW_FEEDBACK_TOPIC = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
export const AUTHORIZATION_USED_TOPIC = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5'
const SEL_GET_AGENT_WALLET = '0x00339509'
const SEL_IS_AUTHORIZED_OR_OWNER = '0xd95e72be'

/** De registers en het USDC-adres per keten. Bron: de README van erc-8004/erc-8004-contracts en de USDC-uitgifte. */
export const NETWERKEN = {
  'eip155:8453': {
    naam: 'Base',
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpc: 'https://mainnet.base.org',
  },
  'eip155:84532': {
    naam: 'Base Sepolia',
    identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpc: 'https://sepolia.base.org',
  },
}

const laag = (s) => String(s ?? '').toLowerCase()
const getal = (h) => parseInt(h, 16)
const hex = (n) => '0x' + Number(n).toString(16)
const woord = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64)
const adresUitTopic = (t) => '0x' + String(t).slice(-40).toLowerCase()
const adresAlsWoord = (a) => laag(a).replace(/^0x/, '').padStart(64, '0')
const kort = (a) => (a && a.length > 20 ? a.slice(0, 8) + '...' + a.slice(-6) : a)

function tekstOpOffset(data, offsetBytes) {
  const o = 2 + offsetBytes * 2
  const lengte = Number(BigInt('0x' + data.slice(o, o + 64)))
  if (!Number.isFinite(lengte) || lengte > 4096) throw new Error('a feedback string is longer than 4096 bytes')
  return Buffer.from(data.slice(o + 64, o + 64 + lengte * 2), 'hex').toString('utf8')
}

/** Ontleed de data van een NewFeedback-event. Geeft null als de lading er niet uitziet zoals het event. */
export function ontleedNewFeedback(log) {
  if (!log || laag(log.topics?.[0]) !== NEW_FEEDBACK_TOPIC || log.topics.length < 4) return null
  const data = log.data
  if (typeof data !== 'string' || data.length < 2 + 8 * 64) return null
  let waarde = BigInt('0x' + woord(data, 1))
  if (waarde >= 1n << 255n) waarde -= 1n << 256n
  return {
    agentId: BigInt(log.topics[1]).toString(),
    rater: adresUitTopic(log.topics[2]),
    feedbackIndex: Number(BigInt('0x' + woord(data, 0))),
    value: waarde.toString(),
    valueDecimals: Number(BigInt('0x' + woord(data, 2))),
    tag1: tekstOpOffset(data, Number(BigInt('0x' + woord(data, 3)))),
    tag2: tekstOpOffset(data, Number(BigInt('0x' + woord(data, 4)))),
    endpoint: tekstOpOffset(data, Number(BigInt('0x' + woord(data, 5)))),
    feedbackURI: tekstOpOffset(data, Number(BigInt('0x' + woord(data, 6)))),
    feedbackHash: '0x' + woord(data, 7),
    blok: getal(log.blockNumber),
    logIndex: getal(log.logIndex),
    tx: log.transactionHash,
  }
}

/** De feedback uit een transactie, via het event. Een transactie met meer dan een NewFeedback: kies met feedbackIndex. */
export async function leesFeedback(rpc, txHash, { reputation, feedbackIndex = null }) {
  const ontvangst = await rpc('eth_getTransactionReceipt', [txHash])
  if (!ontvangst) throw new Error('that feedback transaction was not found on this node')
  if (ontvangst.status && getal(ontvangst.status) !== 1) throw new Error('that feedback transaction reverted, so no feedback was written')
  const logs = (ontvangst.logs ?? []).filter((l) => laag(l.address) === laag(reputation) && laag(l.topics?.[0]) === NEW_FEEDBACK_TOPIC)
  if (logs.length === 0) throw new Error('that transaction wrote no NewFeedback event at the reputation registry of this network')
  const alle = logs.map(ontleedNewFeedback).filter(Boolean)
  const gekozen = feedbackIndex === null ? alle[0] : alle.find((f) => f.feedbackIndex === feedbackIndex)
  if (!gekozen) throw new Error('no feedback with that index in that transaction')
  return { ...gekozen, aantalInTransactie: alle.length }
}

/** De USDC-overdrachten van een transactie, met betaler en ontvanger uit de LOG en niet uit de transactie. */
export async function leesBetaling(rpc, txHash, { usdc, rater = null }) {
  const ontvangst = await rpc('eth_getTransactionReceipt', [txHash])
  if (!ontvangst) return { gevonden: false, reden: 'that payment transaction was not found on this node' }
  if (ontvangst.status && getal(ontvangst.status) !== 1) return { gevonden: false, reden: 'that payment transaction reverted' }
  const logs = ontvangst.logs ?? []
  const overdrachten = logs
    .filter((l) => laag(l.address) === laag(usdc) && laag(l.topics?.[0]) === TRANSFER_TOPIC && l.topics.length === 3)
    .map((l) => ({
      from: adresUitTopic(l.topics[1]), to: adresUitTopic(l.topics[2]), value: BigInt(l.data).toString(),
      blok: getal(l.blockNumber), logIndex: getal(l.logIndex), tx: l.transactionHash,
    }))
  if (overdrachten.length === 0) return { gevonden: false, reden: 'that transaction holds no USDC transfer of this network' }
  const gekozen = overdrachten.find((o) => rater && o.from === laag(rater)) ?? overdrachten[0]
  const autorisaties = logs
    .filter((l) => laag(l.address) === laag(usdc) && laag(l.topics?.[0]) === AUTHORIZATION_USED_TOPIC)
    .map((l) => adresUitTopic(l.topics[1]))
  return { gevonden: true, ...gekozen, aantalOverdrachten: overdrachten.length, autorisatieDoor: autorisaties, tx: ontvangst.transactionHash ?? txHash }
}

async function aanroep(rpc, naar, data, blok) {
  try {
    return { uit: await rpc('eth_call', [{ to: naar, data }, hex(blok)]), leesOp: blok }
  } catch {
    // Een publiek knooppunt bewaart de toestand van oude blokken niet. Dan lezen we op latest, en zeggen dat.
    return { uit: await rpc('eth_call', [{ to: naar, data }, 'latest']), leesOp: 'latest' }
  }
}

/** De gebonden wallet van de agent en of de beoordelaar eigenaar of goedgekeurde operator is, gelezen op het blok van de feedback. */
export async function leesBinding(rpc, { agentId, rater, identity, blok }) {
  const idWoord = BigInt(agentId).toString(16).padStart(64, '0')
  const wallet = await aanroep(rpc, identity, SEL_GET_AGENT_WALLET + idWoord, blok)
  const rol = await aanroep(rpc, identity, SEL_IS_AUTHORIZED_OR_OWNER + adresAlsWoord(rater) + idWoord, blok)
  return {
    agentWallet: '0x' + String(wallet.uit).slice(-40).toLowerCase(),
    walletGelezenOp: wallet.leesOp,
    raterIsEigenaarOfOperator: BigInt(rol.uit) !== 0n,
    rolGelezenOp: rol.leesOp,
  }
}

const voor = (a, b) => a.blok < b.blok || (a.blok === b.blok && a.logIndex < b.logIndex)
const feit = (status, bewijs, extra = {}) => ({ status, bewijs, ...extra })

/**
 * Beoordeel een feedback aan de hand van de vier feiten van AgenticFinanceGraph, plus een vijfde.
 *
 * Invoer: de feedback-transactie, optioneel de betaling (anders de feedbackHash als die een transactie
 * is), en optioneel het bonnetje met zout en asset voor het vijfde feit.
 */
export async function beoordeelGrounding({ rpc, network, feedbackTx, paymentTx = null, receipt = null, salt = null, asset = null, feedbackIndex = null, linkFn = linkBonnetje }) {
  const cfg = NETWERKEN[network]
  if (!cfg) throw new Error('unknown network ' + network + ', known: ' + Object.keys(NETWERKEN).join(', '))
  const fb = await leesFeedback(rpc, feedbackTx, { reputation: cfg.reputation, feedbackIndex })

  // Welke transactie is de betaling? Expliciet opgegeven gaat voor. Anders de feedbackHash als hij een transactie is.
  let betalingTx = paymentTx
  let bronBetaling = paymentTx ? 'given with --payment' : null
  let link = null
  if (receipt && salt) {
    // Het bonnetje opent het commitment op een afrekening. Is er geen betaling opgegeven, dan IS dat de betaling.
    // Is er wel een opgegeven, dan wordt hier toch geopend: het vijfde feit vraagt of DIE betaling het is.
    try {
      link = await linkFn(rpc, { payload: receipt.payload ?? receipt, salt, asset: asset ?? cfg.usdc })
      if (!betalingTx && link.linked && link.afrekening?.tx) { betalingTx = link.afrekening.tx; bronBetaling = 'opened by the receipt commitment' }
    } catch (e) {
      link = { fout: String(e.message).slice(0, 160) }
    }
  }
  if (!betalingTx) {
    const kandidaat = await rpc('eth_getTransactionReceipt', [fb.feedbackHash]).catch(() => null)
    if (kandidaat) { betalingTx = fb.feedbackHash; bronBetaling = 'the feedbackHash is itself a transaction hash' }
  }

  const binding = await leesBinding(rpc, { agentId: fb.agentId, rater: fb.rater, identity: cfg.identity, blok: fb.blok })
  const betaling = betalingTx ? await leesBetaling(rpc, betalingTx, { usdc: cfg.usdc, rater: fb.rater }) : { gevonden: false, reden: 'no payment transaction was given and the feedbackHash is not a transaction' }

  const feiten = {}
  if (betaling.gevonden) {
    feiten.raterIsPayer = betaling.from === laag(fb.rater)
      ? feit('true', `the USDC transfer in ${kort(betalingTx)} is from ${kort(betaling.from)}, who wrote the feedback`)
      : feit('false', `the USDC transfer is from ${kort(betaling.from)} but the feedback was written by ${kort(fb.rater)}`)
    const gebonden = laag(binding.agentWallet)
    feiten.paidIsBoundWallet = betaling.to === gebonden
      ? feit('true', `${kort(betaling.to)} is the wallet bound to agent ${fb.agentId}`, { gelezenOp: binding.walletGelezenOp })
      : feit('false', `the payment went to ${kort(betaling.to)} but agent ${fb.agentId} is bound to ${kort(gebonden)}`, { gelezenOp: binding.walletGelezenOp })
    feiten.paymentBeforeFeedback = voor(betaling, fb)
      ? feit('true', `payment at block ${betaling.blok} (log ${betaling.logIndex}), feedback at block ${fb.blok} (log ${fb.logIndex})`)
      : feit('false', `payment at block ${betaling.blok} (log ${betaling.logIndex}) is not before the feedback at block ${fb.blok} (log ${fb.logIndex})`)
  } else {
    for (const naam of ['raterIsPayer', 'paidIsBoundWallet', 'paymentBeforeFeedback']) feiten[naam] = feit('not_measured', betaling.reden)
  }
  feiten.raterNotOwnerOrOperator = binding.raterIsEigenaarOfOperator
    ? feit('false', `the rater is the owner or an approved operator of agent ${fb.agentId}`, { gelezenOp: binding.rolGelezenOp })
    : feit('true', `the rater is neither owner nor approved operator of agent ${fb.agentId}`, { gelezenOp: binding.rolGelezenOp })

  // Het vijfde feit: opent de feedbackHash via het bonnetje op deze afrekening?
  if (!receipt || !salt) {
    feiten.feedbackHashOpensReceipt = feit('not_measured', 'no receipt and salt were given')
  } else {
    const commitment = laag(receipt.payload?.authorizationCommitment ?? receipt.authorizationCommitment)
    if (!commitment) feiten.feedbackHashOpensReceipt = feit('false', 'the receipt carries no authorizationCommitment (a version 1 receipt)')
    else if (commitment !== laag(fb.feedbackHash)) feiten.feedbackHashOpensReceipt = feit('false', 'the feedbackHash is not the commitment of this receipt')
    else if (link.fout) feiten.feedbackHashOpensReceipt = feit('not_measured', 'the chain read to open the commitment failed: ' + link.fout)
    else if (!link.linked) feiten.feedbackHashOpensReceipt = feit('false', 'no candidate settlement in the searched window opens this commitment: ' + (link.reden ?? 'not linked'))
    else if (betalingTx && laag(link.afrekening?.tx) !== laag(betalingTx)) feiten.feedbackHashOpensReceipt = feit('false', 'the commitment opens a different settlement than the payment that was checked')
    else feiten.feedbackHashOpensReceipt = feit('true', `the feedbackHash is the receipt commitment and it opens exactly the settlement ${kort(link.afrekening.tx)}`)
  }

  const vier = ['raterIsPayer', 'paidIsBoundWallet', 'paymentBeforeFeedback', 'raterNotOwnerOrOperator'].map((n) => feiten[n].status)
  const grounded = vier.includes('false') ? 'no' : vier.every((s) => s === 'true') ? 'yes' : 'incomplete'
  return {
    network, feedback: fb,
    payment: betaling.gevonden ? { tx: betalingTx, bron: bronBetaling, from: betaling.from, to: betaling.to, value: betaling.value, blok: betaling.blok, logIndex: betaling.logIndex, aantalOverdrachten: betaling.aantalOverdrachten } : { tx: betalingTx, reden: betaling.reden },
    binding, feiten, grounded,
    groundedWithCommitment: grounded === 'yes' && feiten.feedbackHashOpensReceipt.status === 'true',
  }
}

// ── commandoregel ──────────────────────────────────────────────────────────────────────────────
function vlag(naam, standaard = null) {
  const v = process.argv.find((a) => a.startsWith(`--${naam}=`))
  return v ? v.slice(naam.length + 3) : standaard
}

const TEKST = {
  raterIsPayer: 'the rater is the payer',
  paidIsBoundWallet: "the paid address is the agent's bound wallet",
  paymentBeforeFeedback: 'the payment lands before the feedback',
  raterNotOwnerOrOperator: 'the rater is neither owner nor approved operator',
  feedbackHashOpensReceipt: 'the feedbackHash opens through the receipt (extra)',
}

/**
 * De opgenomen controles nadraaien zonder netwerk en vergelijken met het oordeel van een ander.
 * Geeft per vector terug welke feiten afwijken, zodat een afwijking de bevinding is en niets wordt bijgeschaafd.
 */
export async function draaiVectoren(map = fileURLToPath(new URL('../vectors/grounding/', import.meta.url))) {
  const uit = []
  for (const f of readdirSync(map).filter((x) => x.endsWith('.json')).sort()) {
    const v = JSON.parse(readFileSync(map + f, 'utf8'))
    const opname = new Map(v.opname)
    const rpc = async (method, params) => {
      const a = opname.get(JSON.stringify([method, params]))
      if (!a) throw new Error('call not in the recording: ' + method)
      if (a.fout) throw new Error(a.fout)
      return a.resultaat
    }
    const u = await beoordeelGrounding({ rpc, network: v.network, feedbackTx: v.feedbackTx, paymentTx: v.paymentTx })
    const afwijkend = Object.entries(v.oordeelVanEenAnder.verwacht).filter(([n, s]) => u.feiten[n].status !== s).map(([n]) => n)
    if (v.oordeelVanEenAnder.eindoordeel && u.grounded !== v.oordeelVanEenAnder.eindoordeel) afwijkend.push('eindoordeel')
    uit.push({ naam: v.naam, bron: v.oordeelVanEenAnder.bron, afwijkend })
  }
  return uit
}

if (process.argv[1]?.endsWith('x402-grounding.mjs') && process.argv.includes('--vectors')) {
  const rijen = await draaiVectoren()
  console.log('Recorded Base mainnet controls, replayed offline, against the verdicts someone else wrote down first.')
  console.log('')
  for (const r of rijen) {
    console.log(`  ${r.afwijkend.length === 0 ? 'agree   ' : 'DISAGREE'}  ${r.naam}${r.afwijkend.length ? '  (differs on: ' + r.afwijkend.join(', ') + ')' : ''}`)
    console.log(`            verdict by: ${r.bron}`)
  }
  const eens = rijen.filter((r) => r.afwijkend.length === 0).length
  console.log('')
  console.log(`${eens} of ${rijen.length} recorded controls agree with the other party's verdict.`)
  console.log('A disagreement is the finding. It is not tuned away.')
  process.exit(eens === rijen.length ? 0 : 1)
}

if (process.argv[1]?.endsWith('x402-grounding.mjs')) {
  const feedbackTx = vlag('feedback')
  if (!feedbackTx) {
    console.log(`usage: node src/x402-grounding.mjs --feedback=<tx hash> [--network=eip155:8453] [--payment=<tx hash>]
                                   [--receipt=<file.json> --salt=0x.. [--asset=0x..]] [--rpc=<url>]

Checks whether an ERC-8004 feedback is grounded in a payment, by four facts read from the chain
(the definition AgenticFinanceGraph uses in erc-8004/erc-8004-contracts#99) plus one extra: does the
feedbackHash open, through the receipt, on exactly that settlement. Read-only, no key, no account.
Without --payment the feedbackHash is tried as a transaction hash.`)
    process.exit(2)
  }
  const network = vlag('network', 'eip155:8453')
  const cfg = NETWERKEN[network]
  if (!cfg) { console.error('unknown network ' + network + ', known: ' + Object.keys(NETWERKEN).join(', ')); process.exit(2) }
  const rpcUrl = vlag('rpc', cfg.rpc)
  let receipt = null
  const bestand = vlag('receipt')
  if (bestand) {
    const j = JSON.parse(readFileSync(bestand, 'utf8'))
    receipt = j.receipt ?? j.bonnetje ?? j
  }
  console.log(`network      : ${cfg.naam} (${network})`)
  console.log(`rpc          : ${rpcUrl}`)
  let u
  try {
    u = await beoordeelGrounding({ rpc: maakRpc(rpcUrl), network, feedbackTx, paymentTx: vlag('payment'), receipt, salt: vlag('salt'), asset: vlag('asset'), feedbackIndex: vlag('index') === null ? null : Number(vlag('index')) })
  } catch (e) {
    console.log('GROUNDED     : unknown, the check could not be completed')
    console.log(`  reason     : ${e.message}`)
    console.log('  note: this is an incomplete check, not a feedback that is ungrounded.')
    process.exit(2)
  }
  const f = u.feedback
  console.log(`feedback     : agent ${f.agentId}, rater ${f.rater}, block ${f.blok} (log ${f.logIndex}), tag1 "${f.tag1}"`)
  console.log(`feedbackHash : ${f.feedbackHash}`)
  if (f.aantalInTransactie > 1) console.log(`  note: that transaction holds ${f.aantalInTransactie} feedbacks, this is index ${f.feedbackIndex}`)
  if (u.payment.from) {
    console.log(`payment      : ${u.payment.tx} (${u.payment.bron}), ${Number(u.payment.value) / 1e6} USDC from ${u.payment.from} to ${u.payment.to}`)
    if (u.payment.aantalOverdrachten > 1) console.log(`  note: that transaction holds ${u.payment.aantalOverdrachten} USDC transfers, the rater's was used`)
  } else console.log(`payment      : not found (${u.payment.reden})`)
  console.log(`binding      : agent wallet ${u.binding.agentWallet}, read at ${u.binding.walletGelezenOp === 'latest' ? 'the latest block (the node could not read the feedback block)' : 'block ' + u.binding.walletGelezenOp}`)
  console.log('')
  for (const [naam, tekst] of Object.entries(TEKST)) {
    const x = u.feiten[naam]
    console.log(`${x.status.padEnd(12)} ${tekst}${x.status === 'not_measured' && naam === 'feedbackHashOpensReceipt' ? '' : ''}`)
    console.log(`             ${x.bewijs}`)
  }
  console.log('')
  console.log(`GROUNDED     : ${u.grounded === 'yes' ? 'yes, all four facts hold' : u.grounded === 'no' ? 'no, at least one fact is false' : 'unknown, at least one fact could not be measured'}`)
  if (u.groundedWithCommitment) console.log('  and the feedbackHash opens on that exact settlement through the receipt')
  console.log('  note: this is about the chain facts above, not a statement about whether the rating is fair.')
  process.exit(u.grounded === 'yes' ? 0 : u.grounded === 'no' ? 1 : 2)
}
