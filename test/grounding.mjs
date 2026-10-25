// Test voor de grounding-controle: is een ERC-8004-feedback verankerd in een betaling.
//
// TWEE SOORTEN BEWIJS. De opnames in vectors/grounding zijn wat een echt knooppunt antwoordde op de echte
// keten, en hun verwachte uitslag is die van AgenticFinanceGraph, in een openbare draad opgeschreven voor
// wij deze code schreven. Een positieve en een negatieve controle van een ANDER: komt onze uitslag anders
// uit dan de hunne, dan is dat de bevinding en wordt er niets aan bijgeschaafd. De zelfgebouwde gevallen
// daaronder zijn voor de valkuilen die een opname niet toevallig bevat.

import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  NEW_FEEDBACK_TOPIC, TRANSFER_TOPIC, AUTHORIZATION_USED_TOPIC, NETWERKEN, ontleedNewFeedback, beoordeelGrounding,
} from '../src/x402-grounding.mjs'

let goed = 0, fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const MAP = fileURLToPath(new URL('../vectors/grounding/', import.meta.url))

console.log('the recorded controls, judged by someone else')
for (const f of readdirSync(MAP).filter((x) => x.endsWith('.json')).sort()) {
  const v = JSON.parse(readFileSync(MAP + f, 'utf8'))
  const cassette = new Map(v.opname)
  const rpc = async (method, params) => {
    const antwoord = cassette.get(JSON.stringify([method, params]))
    if (!antwoord) throw new Error('call not in the recording: ' + method + ' ' + JSON.stringify(params).slice(0, 80))
    if (antwoord.fout) throw new Error(antwoord.fout)
    return antwoord.resultaat
  }
  const u = await beoordeelGrounding({ rpc, network: v.network, feedbackTx: v.feedbackTx, paymentTx: v.paymentTx })
  for (const [naam, status] of Object.entries(v.oordeelVanEenAnder.verwacht)) {
    toets(`${v.naam}: ${naam} is ${status}, as ${v.oordeelVanEenAnder.wie?.split(',')[0] ?? 'the other party'} found`, u.feiten[naam].status === status, 'we got ' + u.feiten[naam].status)
  }
  if (v.oordeelVanEenAnder.eindoordeel) toets(`${v.naam}: the end verdict is ${v.oordeelVanEenAnder.eindoordeel}`, u.grounded === v.oordeelVanEenAnder.eindoordeel, 'we got ' + u.grounded)
  toets(`${v.naam}: the source of the verdict is a public link`, /^https:\/\/github\.com\//.test(v.oordeelVanEenAnder.bron ?? ''))
}

// ── zelfgebouwde gevallen ──────────────────────────────────────────────────────────────────────────
const NET = 'eip155:84532'
const CFG = NETWERKEN[NET]
const RATER = '0x1111111111111111111111111111111111111111'
const AGENT_WALLET = '0x2222222222222222222222222222222222222222'
const ANDER = '0x3333333333333333333333333333333333333333'
const FACILITATOR = '0x4444444444444444444444444444444444444444'
const FB_TX = '0x' + 'f1'.repeat(32)
const PAY_TX = '0x' + 'a1'.repeat(32)
const w = (n) => BigInt(n).toString(16).padStart(64, '0')
const adresWoord = (a) => '0x' + a.replace(/^0x/, '').toLowerCase().padStart(64, '0')

function tekstDeel(t) {
  const b = Buffer.from(t, 'utf8')
  return w(b.length) + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0')
}
function feedbackData({ index = 1, value = 10, decimals = 1, tag1 = 'x402:paid-delivery', tag2 = '', endpoint = '', uri = '', hash }) {
  const delen = [tag1, tag2, endpoint, uri].map(tekstDeel)
  let offset = 8 * 32
  const offsets = delen.map((d) => { const o = offset; offset += d.length / 2; return o })
  const waarde = BigInt(value) < 0n ? (1n << 256n) + BigInt(value) : BigInt(value)
  return '0x' + w(index) + waarde.toString(16).padStart(64, '0') + w(decimals) + offsets.map(w).join('') + hash.replace(/^0x/, '') + delen.join('')
}
const feedbackLog = ({ agentId = 7, rater = RATER, blok = 1000, logIndex = 50, data, address = CFG.reputation }) => ({
  address, topics: [NEW_FEEDBACK_TOPIC, '0x' + w(agentId), adresWoord(rater), '0x' + 'ee'.repeat(32)],
  data, blockNumber: '0x' + blok.toString(16), logIndex: '0x' + logIndex.toString(16), transactionHash: FB_TX,
})
const transferLog = ({ from = RATER, to = AGENT_WALLET, value = 1000, blok = 990, logIndex = 20, address = CFG.usdc, tx = PAY_TX }) => ({
  address, topics: [TRANSFER_TOPIC, adresWoord(from), adresWoord(to)], data: '0x' + w(value),
  blockNumber: '0x' + blok.toString(16), logIndex: '0x' + logIndex.toString(16), transactionHash: tx,
})
const autorisatieLog = ({ door = RATER }) => ({ address: CFG.usdc, topics: [AUTHORIZATION_USED_TOPIC, adresWoord(door), '0x' + 'cc'.repeat(32)], data: '0x', blockNumber: '0x3de', logIndex: '0x15', transactionHash: PAY_TX })

/** Een nagemaakte keten. historischWeigert: een eth_call op een bepaald blok geeft een fout, zoals een publiek knooppunt. */
function nepKeten({ txs = {}, wallet = AGENT_WALLET, operator = false, historischWeigert = false, mintBlok = null, walletNu = null, walletVoorBlok = null }) {
  const aanroepen = []
  const rpc = async (method, params) => {
    aanroepen.push([method, params])
    if (method === 'eth_getTransactionReceipt') return txs[params[0]] ?? null
    if (method === 'eth_call') {
      if (historischWeigert && params[1] !== 'latest') throw new Error('missing trie node: historical state is not available')
      const data = params[0].data
      if (data.startsWith('0x6352211e')) {
        const blok = params[1] === 'latest' ? Infinity : parseInt(params[1], 16)
        if (mintBlok !== null && blok >= mintBlok) return adresWoord(wallet)
        throw new Error('execution reverted: ERC721NonexistentToken')
      }
      if (data.startsWith('0x00339509')) {
        if (walletVoorBlok) { const nr = params[1] === 'latest' ? Infinity : parseInt(params[1], 16); return adresWoord(walletVoorBlok(nr) ?? '0x' + '0'.repeat(40)) }
        return adresWoord(params[1] === 'latest' && walletNu ? walletNu : wallet)
      }
      if (data.startsWith('0xd95e72be')) return '0x' + w(operator ? 1 : 0)
    }
    throw new Error('unexpected ' + method)
  }
  return { rpc, aanroepen }
}
const ontvangst = (logs, extra = {}) => ({ status: '0x1', from: FACILITATOR, to: '0xca11bde05977b3631167028862be2a173976ca11', logs, ...extra })
const standaardHash = PAY_TX

console.log('decoding the NewFeedback event')
{
  const d = ontleedNewFeedback(feedbackLog({ data: feedbackData({ value: -25, decimals: 2, tag1: 'tag-é', tag2: 'second', endpoint: 'https://e.example', uri: 'ipfs://x', hash: standaardHash }) }))
  toets('reads agent, rater, value, decimals and the four strings', d.agentId === '7' && d.rater === RATER && d.value === '-25' && d.valueDecimals === 2 && d.tag1 === 'tag-é' && d.tag2 === 'second' && d.endpoint === 'https://e.example' && d.feedbackURI === 'ipfs://x')
  toets('reads the feedbackHash from the event data', d.feedbackHash === standaardHash)
  toets('another event is not decoded as feedback', ontleedNewFeedback({ topics: ['0x' + '00'.repeat(32)], data: '0x' }) === null)
}

console.log('payer and payee come from the USDC log, never from the transaction')
{
  const { rpc } = nepKeten({ txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([transferLog({}), autorisatieLog({})]) } })
  const u = await beoordeelGrounding({ rpc, network: NET, feedbackTx: FB_TX })
  toets('the payer is the account in the log, although the transaction was sent by a facilitator', u.payment.from === RATER && u.feiten.raterIsPayer.status === 'true')
  toets('all four facts hold, so grounded', u.grounded === 'yes')
}
{
  const { rpc } = nepKeten({ txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([transferLog({ address: '0x9999999999999999999999999999999999999999' })]) } })
  const u = await beoordeelGrounding({ rpc, network: NET, feedbackTx: FB_TX })
  toets('a transfer from another token contract is not a USDC payment', u.payment.reden?.includes('no USDC transfer') && u.feiten.raterIsPayer.status === 'not_measured')
  toets('and the verdict is incomplete, never grounded', u.grounded === 'incomplete')
}
{
  const { rpc } = nepKeten({ txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([transferLog({ from: ANDER, to: ANDER, value: 5 }), transferLog({ logIndex: 21 })]) } })
  const u = await beoordeelGrounding({ rpc, network: NET, feedbackTx: FB_TX })
  toets('with two transfers in one transaction it takes the rater\'s and says there were two', u.payment.from === RATER && u.payment.aantalOverdrachten === 2)
}

console.log('the order of payment and feedback')
{
  const maak = (betalingLog, feedbackBlok, feedbackLogIdx) => nepKeten({ txs: { [FB_TX]: ontvangst([feedbackLog({ blok: feedbackBlok, logIndex: feedbackLogIdx, data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([betalingLog]) } })
  let r = await beoordeelGrounding({ rpc: maak(transferLog({ blok: 1000, logIndex: 10 }), 1000, 50).rpc, network: NET, feedbackTx: FB_TX })
  toets('same block, lower log index: before', r.feiten.paymentBeforeFeedback.status === 'true')
  r = await beoordeelGrounding({ rpc: maak(transferLog({ blok: 1000, logIndex: 90 }), 1000, 50).rpc, network: NET, feedbackTx: FB_TX })
  toets('same block, higher log index: not before', r.feiten.paymentBeforeFeedback.status === 'false')
  r = await beoordeelGrounding({ rpc: maak(transferLog({ blok: 1001, logIndex: 1 }), 1000, 50).rpc, network: NET, feedbackTx: FB_TX })
  toets('a later block is not before, whatever the log index', r.feiten.paymentBeforeFeedback.status === 'false')
}

console.log('the binding is read at the block of the feedback, or at latest and then says so')
{
  const { rpc, aanroepen } = nepKeten({ txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([transferLog({})]) } })
  const u = await beoordeelGrounding({ rpc, network: NET, feedbackTx: FB_TX })
  toets('reads at the feedback block when the node can', u.binding.walletGelezenOp === 1000 && aanroepen.some((a) => a[0] === 'eth_call' && a[1][1] === '0x3e8'))
}
{
  const { rpc } = nepKeten({ historischWeigert: true, txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([transferLog({})]) } })
  const u = await beoordeelGrounding({ rpc, network: NET, feedbackTx: FB_TX })
  toets('a node that refuses a historical call is read at latest, and the result says so', u.binding.walletGelezenOp === 'latest' && u.feiten.paidIsBoundWallet.gelezenOp === 'latest')
}

console.log('the rater must not be the owner or an operator, and other refusals')
{
  const { rpc } = nepKeten({ operator: true, txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([transferLog({})]) } })
  const u = await beoordeelGrounding({ rpc, network: NET, feedbackTx: FB_TX })
  toets('an owner or operator as rater fails the fourth fact', u.feiten.raterNotOwnerOrOperator.status === 'false' && u.grounded === 'no')
}
{
  const { rpc } = nepKeten({ txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: '0x' + '07'.repeat(32) }) })]) } })
  const u = await beoordeelGrounding({ rpc, network: NET, feedbackTx: FB_TX })
  toets('a feedbackHash that is not a transaction and no payment given: payment facts are not measured', u.feiten.raterIsPayer.status === 'not_measured' && u.grounded === 'incomplete')
}
{
  const gooit = async (txs) => { try { await beoordeelGrounding({ rpc: nepKeten({ txs }).rpc, network: NET, feedbackTx: FB_TX }); return '' } catch (e) { return e.message } }
  toets('an unknown feedback transaction is an error', /not found/.test(await gooit({})))
  toets('a reverted feedback transaction is an error', /reverted/.test(await gooit({ [FB_TX]: ontvangst([], { status: '0x0' }) })))
  toets('a transaction without a NewFeedback event at this registry is an error', /no NewFeedback/.test(await gooit({ [FB_TX]: ontvangst([feedbackLog({ address: '0x9999999999999999999999999999999999999999', data: feedbackData({ hash: standaardHash }) })]) })))
  try { await beoordeelGrounding({ rpc: nepKeten({}).rpc, network: 'eip155:1', feedbackTx: FB_TX }); toets('an unknown network is an error', false) } catch (e) { toets('an unknown network is an error', /unknown network/.test(e.message)) }
}

console.log('the fifth fact: the feedbackHash opens through the receipt')
{
  const COMMIT = '0x' + 'cd'.repeat(32)
  const ketenMet = (hash) => nepKeten({ txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash }) })]), [PAY_TX]: ontvangst([transferLog({})]) } }).rpc
  const bonnetje = { payload: { version: 2, payer: RATER, issuedAt: 1, authorizationCommitment: COMMIT } }
  const linkOp = (tx) => async () => ({ linked: true, identifier: '0xabc', afrekening: { tx }, venster: {} })
  let u = await beoordeelGrounding({ rpc: ketenMet(COMMIT), network: NET, feedbackTx: FB_TX, paymentTx: null, receipt: bonnetje, salt: '0x' + 'ab'.repeat(32), linkFn: linkOp(PAY_TX) })
  toets('the hash is the commitment and it opens exactly that settlement: true', u.feiten.feedbackHashOpensReceipt.status === 'true' && u.groundedWithCommitment === true)
  toets('the commitment opened the payment, so no payment hash had to be given', u.payment.bron === 'opened by the receipt commitment')
  u = await beoordeelGrounding({ rpc: ketenMet('0x' + '01'.repeat(32)), network: NET, feedbackTx: FB_TX, paymentTx: PAY_TX, receipt: bonnetje, salt: '0x' + 'ab'.repeat(32), linkFn: linkOp(PAY_TX) })
  toets('a feedbackHash that is not the commitment: false', u.feiten.feedbackHashOpensReceipt.status === 'false' && u.groundedWithCommitment === false)
  u = await beoordeelGrounding({ rpc: ketenMet(COMMIT), network: NET, feedbackTx: FB_TX, paymentTx: null, receipt: bonnetje, salt: '0x' + 'ab'.repeat(32), linkFn: async () => { throw new Error('rate limited') } })
  toets('a chain read that fails while opening is not measured, never false', u.feiten.feedbackHashOpensReceipt.status === 'not_measured')
  u = await beoordeelGrounding({ rpc: ketenMet(COMMIT), network: NET, feedbackTx: FB_TX, paymentTx: PAY_TX, receipt: bonnetje, salt: '0x' + 'ab'.repeat(32), linkFn: linkOp('0x' + 'b2'.repeat(32)) })
  toets('a commitment that opens a different settlement than the payment: false', u.feiten.feedbackHashOpensReceipt.status === 'false')
}

console.log('extra facts asked for by AgenticFinanceGraph: registration order, binding now, routing hops')
{
  const keten = (opties, betalingLogs = [transferLog({})]) => nepKeten({ ...opties, txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst(betalingLogs) } })
  let k = keten({ mintBlok: 700 })
  let u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('the registration block is found by bisection, in few calls', u.registration.blok === 700 && k.aanroepen.filter((a) => a[0] === 'eth_call' && a[1][0].data.startsWith('0x6352211e')).length <= 14)
  toets('a payment after the registration: paymentBeforeRegistration is false', u.feiten.paymentAfterRegistration.status === 'true' && u.paymentBeforeRegistration === false)
  toets('and it changes neither the four facts nor the verdict', u.grounded === 'yes')

  k = keten({ mintBlok: 995 })
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('a payment before the registration is reported as such (their pre_registration)', u.feiten.paymentAfterRegistration.status === 'false' && u.paymentBeforeRegistration === true && u.registration.blok === 995)
  toets('but the four facts still hold, so a reader can apply either rule', u.grounded === 'yes')

  k = keten({ mintBlok: 990 })
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('a payment in the very block of the registration is not after it', u.feiten.paymentAfterRegistration.status === 'false')

  k = keten({ mintBlok: 700, historischWeigert: true })
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('a node without historical state: registration not measured, never guessed, verdict unchanged', u.feiten.paymentAfterRegistration.status === 'not_measured' && u.paymentBeforeRegistration === null && u.grounded === 'yes')

  k = keten({})
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('an agent that does not exist at the feedback block: registration not measured', u.feiten.paymentAfterRegistration.status === 'not_measured')

  const ANDER_WALLET = '0x5555555555555555555555555555555555555555'
  k = keten({ mintBlok: 700, walletNu: ANDER_WALLET })
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('a binding that changed since the feedback is reported, with both addresses', u.binding.koppelingVeranderd === true && u.binding.agentWalletNu === ANDER_WALLET && u.binding.agentWallet === AGENT_WALLET)
  k = keten({ mintBlok: 700 })
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('an unchanged binding says so', u.binding.koppelingVeranderd === false)
  k = keten({ mintBlok: 700, historischWeigert: true, walletNu: ANDER_WALLET })
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('when the feedback block could not be read the change is not claimed', u.binding.koppelingVeranderd === null)

  k = keten({ mintBlok: 700 }, [transferLog({ value: 1000 }), transferLog({ from: FACILITATOR, to: RATER, value: 950, logIndex: 22 })])
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('about the same amount back to the payer in the same transaction is flagged as a routing hop', u.feiten.noReturnTransfer.status === 'false' && u.grounded === 'yes')
  k = keten({ mintBlok: 700 }, [transferLog({ value: 1000 }), transferLog({ from: FACILITATOR, to: RATER, value: 100, logIndex: 22 })])
  u = await beoordeelGrounding({ rpc: k.rpc, network: NET, feedbackTx: FB_TX })
  toets('a small refund is not a routing hop', u.feiten.noReturnTransfer.status === 'true')
}

console.log('the third reading: the binding at the block of the payment')
{
  const keten = (opties) => nepKeten({ ...opties, txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([transferLog({})]) } })
  const ANDER_WALLET = '0x5555555555555555555555555555555555555555'
  let u = await beoordeelGrounding({ rpc: keten({ mintBlok: 700, walletVoorBlok: (nr) => (nr >= 500 ? AGENT_WALLET : null) }).rpc, network: NET, feedbackTx: FB_TX })
  toets('a wallet bound before the payment and unchanged: true', u.feiten.paidIsBoundWalletAtPayment.status === 'true' && u.binding.agentWalletBijBetaling === AGENT_WALLET)
  u = await beoordeelGrounding({ rpc: keten({ mintBlok: 995, walletVoorBlok: (nr) => (nr >= 995 ? AGENT_WALLET : null) }).rpc, network: NET, feedbackTx: FB_TX })
  toets('an agent that did not exist at the payment block: false, with the reason', u.feiten.paidIsBoundWalletAtPayment.status === 'false' && /no wallet was bound/.test(u.feiten.paidIsBoundWalletAtPayment.bewijs) && u.grounded === 'yes')
  u = await beoordeelGrounding({ rpc: keten({ mintBlok: 700, walletVoorBlok: (nr) => (nr >= 995 ? ANDER_WALLET : nr >= 500 ? AGENT_WALLET : null) }).rpc, network: NET, feedbackTx: FB_TX })
  toets('a wallet that changed between payment and feedback: true at the payment block, false at the feedback block', u.feiten.paidIsBoundWalletAtPayment.status === 'true' && u.feiten.paidIsBoundWallet.status === 'false')
  u = await beoordeelGrounding({ rpc: keten({ mintBlok: 700, historischWeigert: true }).rpc, network: NET, feedbackTx: FB_TX })
  toets('a node without historical state: not measured, never guessed', u.feiten.paidIsBoundWalletAtPayment.status === 'not_measured')
  u = await beoordeelGrounding({ rpc: nepKeten({ txs: { [FB_TX]: ontvangst([feedbackLog({ data: feedbackData({ hash: '0x' + '07'.repeat(32) }) })]) } }).rpc, network: NET, feedbackTx: FB_TX })
  toets('without a payment transaction the reading is not measured', u.feiten.paidIsBoundWalletAtPayment.status === 'not_measured')
}

console.log('the two cases written first by predge-ai (erc-8004-contracts#99, comment 6397094496), expected verdicts per reading')
{
  const W1 = AGENT_WALLET, W2 = '0x6666666666666666666666666666666666666666'
  const keten = (opties) => nepKeten({ ...opties, txs: { [FB_TX]: ontvangst([feedbackLog({ blok: 1000, data: feedbackData({ hash: standaardHash }) })]), [PAY_TX]: ontvangst([transferLog({ blok: 990 })]) } })
  // Case 1: B1 mint with W1 (500), B2 payment to W1 (990), B3 wallet changed to W2 (995), B4 feedback with the receipt commitment (1000)
  let u = await beoordeelGrounding({ rpc: keten({ mintBlok: 500, walletVoorBlok: (nr) => (nr >= 995 ? W2 : nr >= 500 ? W1 : null) }).rpc, network: NET, feedbackTx: FB_TX })
  toets('case 1, reading at the payment block: W1 is the payee, fact 2 holds, grounded', u.feiten.paidIsBoundWalletAtPayment.status === 'true' && u.binding.agentWalletBijBetaling === W1)
  toets('case 1, reading at the feedback block: W2 is not the payee, fact 2 fails, not grounded', u.feiten.paidIsBoundWallet.status === 'false')
  toets('case 1, reading as it stands now: W2 is not the payee (here now equals the feedback block, so no later change is reported)', u.binding.agentWalletNu === W2 && u.binding.agentWalletNu !== W1 && u.binding.koppelingVeranderd === false)
  // Case 3 (added by us): the wallet changes only AFTER the feedback block (B5). The feedback-block reading holds, "now" differs and the change is reported.
  const u3 = await beoordeelGrounding({ rpc: keten({ mintBlok: 500, walletVoorBlok: (nr) => (nr === Infinity ? W2 : nr >= 500 ? W1 : null), walletNu: W2 }).rpc, network: NET, feedbackTx: FB_TX })
  toets('case 3, wallet changed after the feedback: payment-block and feedback-block readings hold, "now" differs and is reported', u3.feiten.paidIsBoundWalletAtPayment.status === 'true' && u3.feiten.paidIsBoundWallet.status === 'true' && u3.binding.agentWalletNu === W2 && u3.binding.koppelingVeranderd === true)
  toets('case 1: the other facts hold in every reading, only the read time moves the verdict', u.feiten.raterIsPayer.status === 'true')
  // Case 2: same shape, payment (990) before the mint (995): no binding at the payment block
  u = await beoordeelGrounding({ rpc: keten({ mintBlok: 995, walletVoorBlok: (nr) => (nr >= 995 ? W1 : null) }).rpc, network: NET, feedbackTx: FB_TX })
  toets('case 2, reading at the payment block: no binding yet, fact 2 fails, not grounded', u.feiten.paidIsBoundWalletAtPayment.status === 'false' && /no wallet was bound/.test(u.feiten.paidIsBoundWalletAtPayment.bewijs))
  toets('case 2 covers pre_registration without a separate rule', u.paymentBeforeRegistration === true && u.registration.blok === 995)
  toets('case 2, reading at the feedback block: W1 is the payee, fact 2 holds', u.feiten.paidIsBoundWallet.status === 'true' && u.feiten.raterIsPayer.status === 'true')
}

console.log('the command line')
{
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../src/x402-grounding.mjs', import.meta.url))], { encoding: 'utf8' })
  toets('without arguments it prints usage and exits 2', r.status === 2 && /usage:/.test(r.stdout))
}

console.log(`\ngrounding: ${goed} pass, ${fout} fail`)
process.exitCode = fout === 0 ? 0 : 1
