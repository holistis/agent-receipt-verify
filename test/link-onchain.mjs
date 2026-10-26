// Test voor de keten-helft van 5.6.4, zonder netwerk.
//
// De RPC wordt hier nagemaakt, en dat is geen verarming van de test maar de
// enige manier om de gevallen te halen die in het echt bijna nooit voorkomen en
// juist het gevaarlijkst zijn: nul treffers, twee treffers, en een RPC die een
// fout teruggeeft. Dat laatste is de belangrijkste: een geweigerde zoekopdracht
// mag NOOIT als "niets gevonden" doorsijpelen.

import { AUTHORIZATION_USED_TOPIC, adresAlsTopic, blokBijTijd, haalKandidaten, linkBonnetje, kiesBonnetjePad, maakVerkenner, linkBonnetjeViaVerkenner, VERKENNER_STANDAARD, leesFinaliteit } from '../src/x402-link-onchain.mjs'
import { berekenCommitment } from '../src/x402-offer-receipt.mjs'
import { fileURLToPath } from 'node:url'

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
function nepRpc({ laatsteBlok = 48209388, bloktijdS = 2, logs = [], logFout = null, tijdVan = null, vroegsteBlok = 0 } = {}) {
  const tijdVanBlok = tijdVan ?? (n => ISSUED + (n - 48209372) * bloktijdS)
  const aanroepen = []
  return {
    aanroepen,
    rpc: async (method, params) => {
      aanroepen.push(method)
      if (method === 'eth_blockNumber') return '0x' + laatsteBlok.toString(16)
      if (method === 'eth_getBlockByNumber') {
        const n = parseInt(params[0], 16)
        // Een publiek knooppunt dat zijn oude blokken heeft weggegooid antwoordt met een fout, zoals het echte doet.
        if (n < vroegsteBlok) throw new Error(`eth_getBlockByNumber: pruned history unavailable: requested ${n}, earliest available ${vroegsteBlok}`)
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

// ── de bloktijd is niet constant ──────────────────────────────────────────────────────────────────
//
// GEMETEN OP 24 OKTOBER 2026, en het was een fout van ons gereedschap en niet alleen van de knooppunten. Base
// Sepolia maakte op 16 oktober nog een blok per 2 seconden en een week later een per 0,2 seconde. De oude schatting
// nam de bloktijd aan de kop als gemiddelde voor de hele terugweg en kwam 1,9 miljoen blokken te vroeg uit. Op een
// knooppunt met alle geschiedenis (Tenderly) zocht de tool daardoor in een venster waar de afrekening niet lag en
// meldde "LINKED: no", een onwaar antwoord; op de publieke knooppunten gaf het "pruned history", dezelfde fout vanuit een
// andere hoek. Een venster dat naast de afrekening ligt mag nooit als een uitspraak over het bonnetje lezen.
const B0 = 48209372
const BC = B0 + 100_000
const TIP = BC + 1_500_000
const wisselendeTijd = (n) => (n <= BC ? ISSUED + (n - B0) * 2 : ISSUED + 200_000 + Math.floor((n - BC) * 0.2))

console.log('a chain that changed its pace between the receipt and now')
{
  const { rpc } = nepRpc({ laatsteBlok: TIP, tijdVan: wisselendeTijd })
  const r = await blokBijTijd(rpc, ISSUED)
  toets('still lands on the right block when the pace changed tenfold', Math.abs(r.blok - B0) <= 2, 'kreeg ' + r.blok + ' terwijl het ' + B0 + ' is')
  toets('reports the pace around THAT block, not the pace at the tip', Math.abs(r.blokTijd - 2) < 0.05, 'kreeg ' + r.blokTijd)
}
{
  const { rpc, aanroepen } = nepRpc({ laatsteBlok: TIP, tijdVan: wisselendeTijd })
  await blokBijTijd(rpc, ISSUED)
  toets('needs a small number of node calls', aanroepen.length < 60, 'aanroepen ' + aanroepen.length)
}
{
  const { rpc } = nepRpc({ laatsteBlok: TIP, tijdVan: wisselendeTijd, vroegsteBlok: B0 - 5_000 })
  const r = await blokBijTijd(rpc, ISSUED)
  toets('works on a node that keeps only recent history, as long as the block is still there', Math.abs(r.blok - B0) <= 2)
}
{
  const { rpc } = nepRpc({ laatsteBlok: TIP, tijdVan: wisselendeTijd, vroegsteBlok: TIP - 10_000 })
  let boodschap = ''
  try { await blokBijTijd(rpc, ISSUED) } catch (e) { boodschap = e.message }
  toets('a block that is really gone is reported as pruned, never answered with a guess', /pruned history|no longer has block/.test(boodschap), boodschap)
}
{
  // het bonnetje ligt in het snelle deel van de keten en de afrekening 700 seconden later: 3500 blokken verder
  const uitgifte = ISSUED + 250_000
  const eigenBonnetje = { ...bonnetje, issuedAt: uitgifte }
  const nulBlok = BC + (uitgifte - (ISSUED + 200_000)) * 5
  const { rpc } = nepRpc({ laatsteBlok: TIP, tijdVan: wisselendeTijd, logs: [{ blok: nulBlok + 3_500, nonce: NONCE }] })
  const r = await linkBonnetje(rpc, { payload: eigenBonnetje, salt: ZOUT, asset: ASSET })
  toets('finds a settlement 700 seconds after the receipt on a fast chain (a window in seconds, not in blocks)', r.linked === true, 'venster ' + JSON.stringify(r.venster))
  toets('says which window it searched in seconds as well', typeof r.venster.seconden === 'number' && r.venster.seconden > 0)
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
  // ANKER OP DE ECHTE PAKKETMAP, NIET OP ZIJN NAAM. Dit stond als
  // `String(p).includes('agent-receipt-verify')`, en dan hangt de test aan hoe de map
  // heet waarin iemand het pakket heeft gezet. Gemeten: in een git-worktree met een
  // andere mapnaam faalden deze twee toetsen, terwijl de code gewoon werkte. Iemand die
  // `git clone <repo> mijnfork` doet, iets volstrekt normaals, zou dus rood krijgen op
  // iets dat niets met de code te maken heeft. De functie onder test lost zelf op via
  // `import.meta.url`, dus de test hoort hetzelfde anker te gebruiken.
  const PAKKETWORTEL = fileURLToPath(new URL('..', import.meta.url))
  const alleenPakket = (p) => String(p).startsWith(PAKKETWORTEL) && String(p).includes('examples')

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

// ── de uitwijkbron ───────────────────────────────────────────────────────────────────────────────
//
// Gemeten door een vreemde op 24 oktober 2026: zes keer ons commando op drie publieke knooppunten, nul keer een
// uitslag, want ze bewaren alleen recente blokken en onze live voorbeelden zijn ouder. Een verkenner met een
// Etherscan-compatibele API bewaart alles. Hij is een derde partij en geen knooppunt, dus de uitslag zegt wie
// antwoordde, en een weigering van hem leest nooit als een leeg venster.

console.log('a node that no longer has the block says so in plain words')
{
  const rpc = async (method, params) => {
    if (method === 'eth_blockNumber') return '0x' + (48209388).toString(16)
    if (method === 'eth_getBlockByNumber') {
      const n = parseInt(params[0], 16)
      return n > 48000000 ? { number: params[0], timestamp: '0x' + (ISSUED + (n - 48209372) * 2).toString(16) } : null
    }
    throw new Error('onverwachte methode ' + method)
  }
  let boodschap = ''
  try { await blokBijTijd(rpc, ISSUED - 4_000_000) } catch (e) { boodschap = e.message }
  toets('names the pruned history instead of crashing on a null block', /pruned history/.test(boodschap), boodschap)
}

/** Een nagemaakte verkenner. Elke aanvraag wordt bewaard, zodat de test kan zien wat er gevraagd is. */
function nepVerkenner({ blok = 48209372, logs = [], logsAntwoord = null, httpStatus = 200 } = {}) {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(String(url))
    if (httpStatus !== 200) return { ok: false, status: httpStatus, json: async () => ({}) }
    const q = new URL(String(url)).searchParams
    if (q.get('module') === 'block') return { ok: true, status: 200, json: async () => ({ status: '1', message: 'OK', result: { blockNumber: String(blok) } }) }
    if (logsAntwoord) return { ok: true, status: 200, json: async () => logsAntwoord }
    return {
      ok: true, status: 200,
      json: async () => ({
        status: logs.length ? '1' : '0', message: logs.length ? 'OK' : 'No logs found',
        result: logs.map((l) => ({
          address: ASSET.toLowerCase(), blockNumber: '0x' + l.blok.toString(16), transactionHash: l.tx ?? '0x' + 'ee'.repeat(32),
          topics: [AUTHORIZATION_USED_TOPIC, adresAlsTopic(PAYER), l.nonce, null],
        })),
      }),
    }
  }
  return { urls, verkenner: maakVerkenner('https://explorer.example/api', fetchImpl) }
}

console.log('a rate-limited explorer is asked again, and then reported, never read as an empty window')
{
  let aanroepen = 0
  const wachttijden = []
  const fetchImpl = async () => {
    aanroepen++
    if (aanroepen <= 2) return { ok: false, status: 429, headers: { get: () => (aanroepen === 1 ? '3' : null) }, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ status: '1', message: 'OK', result: { blockNumber: '48209372' } }) }
  }
  const v = maakVerkenner('https://explorer.example/api', fetchImpl, { wacht: async (ms) => { wachttijden.push(ms) }, pogingen: 3 })
  const blok = await v.blokBijTijd(ISSUED)
  toets('succeeds on the third try after two 429s', blok === 48209372 && aanroepen === 3)
  toets('waits what the explorer asks for, and 4 seconds when it names nothing', wachttijden[0] === 3000 && wachttijden[1] === 4000, JSON.stringify(wachttijden))
}
{
  let aanroepen = 0
  const fetchImpl = async () => { aanroepen++; return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) } }
  const v = maakVerkenner('https://explorer.example/api', fetchImpl, { wacht: async () => {}, pogingen: 3 })
  let gooide = ''
  try { await v.blokBijTijd(ISSUED) } catch (e) { gooide = e.message }
  toets('keeps being limited: stops after three tries with that reason', aanroepen === 3 && /HTTP 429.*rate limited/.test(gooide), gooide)
}

console.log('the explorer as a second reader of the same chain')
{
  const { verkenner, urls } = nepVerkenner({ logs: [{ blok: 48209372, nonce: NONCE }, { blok: 48209300, nonce: ANDERE }] })
  const r = await linkBonnetjeViaVerkenner(verkenner, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('links to exactly one settlement, like the node does', r.linked === true && r.identifier === NONCE)
  toets('says that it was the explorer who answered', r.bron === 'explorer')
  toets('reads the unused fourth topic as nothing and still sees the nonce', r.venster.kandidaten === 2)
  toets('names the transaction', !!r.afrekening?.tx)
  toets('asks for this payer and this token only, and never sends a key', urls.some((u) => u.includes(adresAlsTopic(PAYER).slice(2))) && urls.some((u) => u.includes(ASSET)) && !urls.some((u) => /apikey|api_key|key=/i.test(u)))
}
{
  const { verkenner } = nepVerkenner({ logs: [{ blok: 48209372, nonce: ANDERE }] })
  const r = await linkBonnetjeViaVerkenner(verkenner, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('a window without our nonce is not linked, and says it came from the explorer', r.linked === false && r.bron === 'explorer')
}
{
  const { verkenner } = nepVerkenner({ logs: [] })
  const r = await linkBonnetjeViaVerkenner(verkenner, { payload: bonnetje, salt: ZOUT, asset: ASSET })
  toets('"No logs found" is a real empty window', r.linked === false && r.venster.kandidaten === 0)
}
{
  const { verkenner } = nepVerkenner({ logsAntwoord: { status: '0', message: 'Rate limit exceeded', result: null } })
  let gooide = ''
  try { await linkBonnetjeViaVerkenner(verkenner, { payload: bonnetje, salt: ZOUT, asset: ASSET }) } catch (e) { gooide = e.message }
  toets('any other refusal stops the check and never reads as an empty window', /refused the log query/.test(gooide), gooide)
}
{
  const { verkenner } = nepVerkenner({ httpStatus: 503 })
  let gooide = ''
  try { await linkBonnetjeViaVerkenner(verkenner, { payload: bonnetje, salt: ZOUT, asset: ASSET }) } catch (e) { gooide = e.message }
  toets('an HTTP error stops the check', /HTTP 503/.test(gooide), gooide)
}
{
  const volle = Array.from({ length: 1000 }, (_, i) => ({ blok: 48209000 + i, nonce: '0x' + String(i).padStart(64, '0') }))
  const { verkenner } = nepVerkenner({ logs: volle })
  let gooide = ''
  try { await linkBonnetjeViaVerkenner(verkenner, { payload: bonnetje, salt: ZOUT, asset: ASSET }) } catch (e) { gooide = e.message }
  toets('a list cut off at the cap is refused instead of being trusted', /may be cut off/.test(gooide), gooide)
}
toets('the default explorers cover the two networks the examples use', Object.keys(VERKENNER_STANDAARD).sort().join() === 'eip155:8453,eip155:84532')

console.log('finality of the settlement block')
{
  const rpcMet = (fin) => async (m, p) => { if (m === 'eth_getBlockByNumber' && p[0] === 'finalized') return fin; throw new Error('unexpected ' + m) }
  const a = await leesFinaliteit(rpcMet({ number: '0x64' }), 90)
  toets('a block at or below the finalized head is finalized', a.status === 'finalized' && a.finalizedBlock === 100 && a.settlementBlock === 90)
  const b = await leesFinaliteit(rpcMet({ number: '0x64' }), 101)
  toets('a block above the finalized head is not yet finalized', b.status === 'not_yet_finalized')
  const c = await leesFinaliteit(rpcMet(null), 90)
  toets('a node that returns no finalized block gives unknown, never finalized', c.status === 'unknown')
  const d = await leesFinaliteit(async () => { throw new Error('invalid block tag') }, 90)
  toets('a node that refuses the tag gives unknown with the reason', d.status === 'unknown' && /invalid block tag/.test(d.reden))
}

console.log(`\n${goed} passed, ${fout} failed`)
process.exit(fout === 0 ? 0 : 1)
