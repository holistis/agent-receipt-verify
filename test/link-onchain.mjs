// Test voor de keten-helft van 5.6.4, zonder netwerk.
//
// De RPC wordt hier nagemaakt, en dat is geen verarming van de test maar de
// enige manier om de gevallen te halen die in het echt bijna nooit voorkomen en
// juist het gevaarlijkst zijn: nul treffers, twee treffers, en een RPC die een
// fout teruggeeft. Dat laatste is de belangrijkste: een geweigerde zoekopdracht
// mag NOOIT als "niets gevonden" doorsijpelen.

import { AUTHORIZATION_USED_TOPIC, adresAlsTopic, blokBijTijd, haalKandidaten, linkBonnetje, kiesBonnetjePad } from '../src/x402-link-onchain.mjs'
import { berekenCommitment } from '../src/x402-offer-receipt.mjs'

let goed = 0, fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const PAYER = '0x87f344b6Ec48A936373d774D3De8649DEEB66Ee1'
const ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const ZOUT = '0x' + 'ab'.repeat(32)
const NONCE = '0x1120412c78ea1b2e8bf9eacfc3264c71a23ecd9b1fa579eb16030693344d5dfe'
const ANDERE = '0x' + '77'.repeat(32)
const ISSUED = 1_792_187_030

const COMMITMENT = berekenCommitment({
  method: 'eip3009', asset: ASSET, authorizer: PAYER, identifier: NONCE, salt: ZOUT,
})

/** Een nagemaakte keten. `logsPerBlok` bepaalt wat eth_getLogs teruggeeft. */
function nepRpc({ laatsteBlok = 48209388, bloktijdS = 2, logs = [], logFout = null } = {}) {
  const tijdVanBlok = n => ISSUED + (n - 48209372) * bloktijdS
  const aanroepen = []
  return {
    aanroepen,
    rpc: async (method, params) => {
      aanroepen.push(method)
      if (method === 'eth_blockNumber') return '0x' + laatsteBlok.toString(16)
      if (method === 'eth_getBlockByNumber') {
        const n = parseInt(params[0], 16)
        return { number: params[0], timestamp: '0x' + tijdVanBlok(n).toString(16) }
      }
      if (method === 'eth_getLogs') {
        if (logFout) throw new Error(logFout)
        const van = parseInt(params[0].fromBlock, 16), tot = parseInt(params[0].toBlock, 16)
        if (tot - van + 1 > 200) throw new Error('eth_getLogs is limited to a 200 range')
        const wil = params[0].topics[1]
        return logs
          .filter(l => l.blok >= van && l.blok <= tot)
          .filter(l => !wil || adresAlsTopic(l.payer ?? PAYER) === wil)
          .map(l => ({
            topics: l.topics ?? [AUTHORIZATION_USED_TOPIC, adresAlsTopic(l.payer ?? PAYER), l.nonce],
            blockNumber: '0x' + l.blok.toString(16),
            transactionHash: l.tx ?? '0x' + 'ee'.repeat(32),
          }))
      }
      throw new Error('onverwachte methode ' + method)
    },
  }
}

const bonnetje = {
  version: 2, network: 'eip155:84532', resourceUrl: 'https://api.tokenizen.nl/api/paid/verify-ownership',
  payer: PAYER, issuedAt: ISSUED, transaction: '',
  authorizationMethod: 'eip3009', authorizationCommitment: COMMITMENT,
}

console.log('address as a log topic')
{
  toets('pads to 32 bytes', adresAlsTopic(PAYER) === '0x' + '0'.repeat(24) + PAYER.slice(2).toLowerCase())
  let gooide = false
  try { adresAlsTopic('0x1234') } catch { gooide = true }
  toets('refuses an address that is too short', gooide)
}

console.log('block time is measured, not assumed')
{
  const { rpc } = nepRpc({ bloktijdS: 2 })
  const r = await blokBijTijd(rpc, ISSUED)
  toets('measures 2 seconds', Math.abs(r.blokTijd - 2) < 0.01, 'kreeg ' + r.blokTijd)
  toets('lands on the right block', Math.abs(r.blok - 48209372) <= 2, 'kreeg ' + r.blok)
}
{
  // Een keten met een ANDER tempo moet nog steeds goed landen. Dit is het geval
  // waar een hardgecodeerde bloktijd stil zou falen.
  const { rpc } = nepRpc({ bloktijdS: 12 })
  const r = await blokBijTijd(rpc, ISSUED)
  toets('still lands when blocks take 12 seconds', Math.abs(r.blokTijd - 12) < 0.01 && Math.abs(r.blok - 48209372) <= 2)
}

console.log('fetching candidates')
{
  const { rpc, aanroepen } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const r = await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 48209000, totBlok: 48209449 })
  toets('splits the range into chunks of 200', aanroepen.filter(a => a === 'eth_getLogs').length === 3, 'aanroepen: ' + aanroepen.length)
  toets('finds the nonce', r.nonces.length === 1 && r.nonces[0].nonce === NONCE)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE, topics: [AUTHORIZATION_USED_TOPIC, adresAlsTopic(PAYER)] }] })
  const r = await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 48209300, totBlok: 48209400 })
  toets('ignores a log of the wrong shape', r.nonces.length === 0)
}
{
  const { rpc } = nepRpc({ logFout: 'rate limited' })
  let gooide = false
  try { await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 1, totBlok: 100 }) } catch { gooide = true }
  toets('a refused query raises an error, never an empty result', gooide)
}

console.log('the whole procedure')
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }, { blok: 48209300, nonce: ANDERE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('links to exactly one settlement', r.linked === true && r.identifier === NONCE)
  toets('names the transaction', !!r.afrekening?.tx)
  toets('reports which window it searched', r.venster.vanBlok < r.venster.totBlok && r.venster.aanroepen > 0)
  toets('counts the candidates it actually saw', r.venster.kandidaten === 2)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: ANDERE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('does NOT link when no candidate opens it', r.linked === false)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }, { blok: 48209373, nonce: NONCE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('does NOT link on two equal matches, instead of guessing the first', r.linked === false && /ambiguous/.test(r.reden))
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: '0x' + '99'.repeat(32), asset: ASSET })
  toets('does NOT link with the wrong salt', r.linked === false)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: ZOUT, asset: '0x' + '11'.repeat(20) })
  toets('does NOT link with the wrong asset, because a salt alone is not enough', r.linked === false)
}
{
  // 5.6.4 stap 1: de autorisator komt uit het ondertekende payer-veld. Een
  // commitment dat voor een ANDER adres is gemaakt mag nergens op openen.
  const vreemd = {
    ...bonnetje,
    authorizationCommitment: berekenCommitment({
      method: 'eip3009', asset: ASSET, authorizer: '0x' + '22'.repeat(20), identifier: NONCE, salt: ZOUT,
    }),
  }
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const r = await linkBonnetje(rpc, { payload: vreemd, salt: ZOUT, asset: ASSET })
  toets('a commitment made for another address opens to nothing', r.linked === false)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const v1 = { version: 1, payer: PAYER, issuedAt: ISSUED, transaction: '' }
  const r = await linkBonnetje(rpc, { payload: v1, salt: ZOUT, asset: ASSET })
  toets('a version 1 receipt reports that it carries no commitment', r.linked === false && /no commitment/.test(r.reden))
}
{
  const { rpc } = nepRpc()
  let gooide = false
  try { await linkBonnetje(rpc, { payload: { payer: PAYER }, salt: ZOUT, asset: ASSET }) } catch { gooide = true }
  toets('refuses a receipt without issuedAt instead of scanning everything', gooide)
}


console.log('cap on the number of RPC calls')
{
  const { rpc } = nepRpc()
  let bericht = ''
  try { await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 1, totBlok: 1_000_000 }) }
  catch (e) { bericht = e.message }
  toets('refuses a window that would hammer a public RPC', /RPC calls/.test(bericht), bericht.slice(0, 60))
}
{
  // een log BINNEN het opgegeven bereik, anders meet deze test niets
  const { rpc } = nepRpc({ logs: [{ blok: 500_000, nonce: NONCE }] })
  const r = await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 1, totBlok: 1_000_000, maxAanroepen: 10_000 })
  toets('but allows it to be raised deliberately', r.nonces.length === 1)
}

console.log('')
console.log('waar een bonnetje gezocht wordt')
{
  // GEMETEN LES, 2026-10-17. Het commando dat wij publiceren
  // (npx github:holistis/agent-receipt-verify link --receipt=examples/...) wees naar
  // een pad in de werkmap van de aanroeper. Vanuit een lege map gaf dat een kale
  // ENOENT-stacktrace, dus het enige commando in onze eigen uitleg werkte alleen bij
  // ons. Voor een gereedschap dat om narekenbaarheid vraagt is dat het ergste dat er
  // kan misgaan, en het was onzichtbaar omdat wij altijd in de repo staan.
  const bestaatAlles = () => true
  const bestaatNiets = () => false
  const alleenPakket = (p) => String(p).includes('agent-receipt-verify') && String(p).includes('examples')

  const eigen = kiesBonnetjePad('mijn-eigen-bonnetje.json', { bestaat: bestaatAlles })
  toets('een pad dat de aanroeper zelf heeft gaat voor', eigen.pad === 'mijn-eigen-bonnetje.json' && eigen.uitPakket === false)

  const terugval = kiesBonnetjePad('examples/receipt-live-base-sepolia.json', { bestaat: alleenPakket })
  toets('staat het er niet, dan het meegeleverde bestand, en dat wordt gemeld', !!terugval && terugval.uitPakket === true)
  toets('die terugval wijst naar een absoluut pad binnen het pakket zelf',
    !!terugval && terugval.pad.includes('examples') && terugval.pad !== 'examples/receipt-live-base-sepolia.json')

  toets('bestaat het nergens, dan null in plaats van een stacktrace',
    kiesBonnetjePad('bestaat-nergens.json', { bestaat: bestaatNiets }) === null)

  toets('de drie live voorbeelden liggen echt in het pakket', ['', '-2', '-3'].every((n) => {
    const r = kiesBonnetjePad('examples/receipt-live-base-sepolia' + n + '.json')
    return r !== null
  }))
}

console.log(`\n${goed} passed, ${fout} failed`)
process.exit(fout === 0 ? 0 : 1)
