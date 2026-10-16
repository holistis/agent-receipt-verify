// Test voor de keten-helft van 5.6.4, zonder netwerk.
//
// De RPC wordt hier nagemaakt, en dat is geen verarming van de test maar de
// enige manier om de gevallen te halen die in het echt bijna nooit voorkomen en
// juist het gevaarlijkst zijn: nul treffers, twee treffers, en een RPC die een
// fout teruggeeft. Dat laatste is de belangrijkste: een geweigerde zoekopdracht
// mag NOOIT als "niets gevonden" doorsijpelen.

import {
  AUTHORIZATION_USED_TOPIC,
  adresAlsTopic,
  blokBijTijd,
  haalKandidaten,
  linkBonnetje,
} from '../src/x402-link-onchain.mjs'
import { berekenCommitment } from '../src/x402-offer-receipt.mjs'

let goed = 0, fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  groen  ' + naam) }
  else { fout++; console.log('  ROOD   ' + naam + (extra ? '  <- ' + extra : '')) }
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

console.log('adres als topic')
{
  toets('vult aan tot 32 bytes', adresAlsTopic(PAYER) === '0x' + '0'.repeat(24) + PAYER.slice(2).toLowerCase())
  let gooide = false
  try { adresAlsTopic('0x1234') } catch { gooide = true }
  toets('weigert een te kort adres', gooide)
}

console.log('bloktijd wordt gemeten, niet aangenomen')
{
  const { rpc } = nepRpc({ bloktijdS: 2 })
  const r = await blokBijTijd(rpc, ISSUED)
  toets('meet 2 seconden', Math.abs(r.blokTijd - 2) < 0.01, 'kreeg ' + r.blokTijd)
  toets('landt op het juiste blok', Math.abs(r.blok - 48209372) <= 2, 'kreeg ' + r.blok)
}
{
  // Een keten met een ANDER tempo moet nog steeds goed landen. Dit is het geval
  // waar een hardgecodeerde bloktijd stil zou falen.
  const { rpc } = nepRpc({ bloktijdS: 12 })
  const r = await blokBijTijd(rpc, ISSUED)
  toets('werkt ook bij 12 seconden per blok', Math.abs(r.blokTijd - 12) < 0.01 && Math.abs(r.blok - 48209372) <= 2)
}

console.log('kandidaten ophalen')
{
  const { rpc, aanroepen } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const r = await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 48209000, totBlok: 48209449 })
  toets('knipt in stukken van 200', aanroepen.filter(a => a === 'eth_getLogs').length === 3, 'aanroepen: ' + aanroepen.length)
  toets('vindt de nonce', r.nonces.length === 1 && r.nonces[0].nonce === NONCE)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE, topics: [AUTHORIZATION_USED_TOPIC, adresAlsTopic(PAYER)] }] })
  const r = await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 48209300, totBlok: 48209400 })
  toets('negeert een log met de verkeerde vorm', r.nonces.length === 0)
}
{
  const { rpc } = nepRpc({ logFout: 'rate limited' })
  let gooide = false
  try { await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 1, totBlok: 100 }) } catch { gooide = true }
  toets('een geweigerde zoekopdracht wordt een FOUT, geen leeg resultaat', gooide)
}

console.log('het volledige pad')
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }, { blok: 48209300, nonce: ANDERE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('linkt aan precies een afrekening', r.linked === true && r.identifier === NONCE)
  toets('noemt de transactie erbij', !!r.afrekening?.tx)
  toets('meldt welk venster is afgezocht', r.venster.vanBlok < r.venster.totBlok && r.venster.aanroepen > 0)
  toets('telt de kandidaten die het echt zag', r.venster.kandidaten === 2)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: ANDERE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('linkt NIET als geen kandidaat opent', r.linked === false)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }, { blok: 48209373, nonce: NONCE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('linkt NIET bij twee gelijke treffers, in plaats van de eerste te gokken', r.linked === false && /ambiguous/.test(r.reden))
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: '0x' + '99'.repeat(32), asset: ASSET })
  toets('linkt NIET met het verkeerde zout', r.linked === false)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const r = await linkBonnetje(rpc, { payload: bonnetje, salt: ZOUT, asset: '0x' + '11'.repeat(20) })
  toets('linkt NIET met het verkeerde asset, want zout alleen is niet genoeg', r.linked === false)
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
  toets('een commitment voor een ander adres opent op niets', r.linked === false)
}
{
  const { rpc } = nepRpc({ logs: [{ blok: 48209372, nonce: NONCE }] })
  const v1 = { version: 1, payer: PAYER, issuedAt: ISSUED, transaction: '' }
  const r = await linkBonnetje(rpc, { payload: v1, salt: ZOUT, asset: ASSET })
  toets('een versie-1-bonnetje meldt dat er geen commitment is', r.linked === false && /no commitment/.test(r.reden))
}
{
  const { rpc } = nepRpc()
  let gooide = false
  try { await linkBonnetje(rpc, { payload: { payer: PAYER }, salt: ZOUT, asset: ASSET }) } catch { gooide = true }
  toets('weigert een bonnetje zonder issuedAt in plaats van het hele venster af te zoeken', gooide)
}


console.log('bovengrens op het aantal aanroepen')
{
  const { rpc } = nepRpc()
  let bericht = ''
  try { await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 1, totBlok: 1_000_000 }) }
  catch (e) { bericht = e.message }
  toets('weigert een venster dat een publieke RPC zou platleggen', /RPC calls/.test(bericht), bericht.slice(0, 60))
}
{
  // een log BINNEN het opgegeven bereik, anders meet deze test niets
  const { rpc } = nepRpc({ logs: [{ blok: 500_000, nonce: NONCE }] })
  const r = await haalKandidaten(rpc, { asset: ASSET, authorizer: PAYER, vanBlok: 1, totBlok: 1_000_000, maxAanroepen: 10_000 })
  toets('maar laat het wel bewust verhogen', r.nonces.length === 1)
}

console.log(`\n${goed} groen, ${fout} rood`)
process.exit(fout === 0 ? 0 : 1)
