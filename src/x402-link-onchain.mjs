// De tweede helft van 5.6.4: het commitment openen tegen de KETEN zelf.
//
// WAT HIER HET VERSCHIL MAAKT. Het commitment narekenen kan iedereen die het
// zout en de nonce al heeft. Maar wie alleen een bonnetje en een zout krijgt
// toegestuurd, HEEFT die nonce niet. 5.6.4 zegt daarom: vraag de keten welke
// nonces deze betaler ooit heeft verbruikt, en reken het commitment na voor elke
// kandidaat. Precies een MOET matchen. Dat is het moment waarop een bewering van
// de ondertekenaar verandert in bewijs, en volgens 5.6.5 is dat ook het enige
// moment waarop een teller een afrekening mag meetellen.
//
// GEEN SLEUTEL, GEEN ACCOUNT, GEEN PAKKETTEN. Alleen een publieke RPC en de
// ingebouwde fetch. Dat is bewust: een controle die een API-sleutel vereist, is
// voor een vreemde geen controle maar een drempel.
//
// HET ZOEKVENSTER, en waarom het niet "de hele keten" is. De publieke Base
// Sepolia-RPC staat per aanroep maar 200 blokken toe, GEMETEN en niet uit
// documentatie. Terugscannen over een dag zou dus ruim 200 aanroepen kosten. Een
// bonnetje draagt echter zijn eigen tijdstip (issuedAt), en daar zoeken we
// SYMMETRISCH rond.
//
// Symmetrisch, en niet alleen ervoor, en dat is een gecorrigeerde aanname. Een
// eerdere versie van dit commentaar beweerde dat de afrekening per definitie
// vlak VOOR het bonnetje ligt. Dat is onjuist: volgens 5.6.3 houdt de verkoper
// de nonce al vast voordat de afrekening draait, dus een versie-2-bonnetje kan
// ondertekend zijn voordat zijn betaling op de keten staat. De code zocht al
// symmetrisch, de uitleg erbij was fout. Gecorrigeerd door babyblueviper1 op
// x402#3827, en het staat hier omdat de volgende lezer anders dezelfde verkeerde
// reden overneemt.
//
// We melden ALTIJD welk venster is afgezocht, zodat een lege uitslag leest als
// "niet in dit venster" en nooit als "bestaat niet". Verbreden gaat via
// --window, en dat is ook wat de spec-notitie nu aanraadt bij geen match.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { opentCommitment } from './x402-offer-receipt.mjs'

// keccak256("AuthorizationUsed(address,bytes32)"). Hardgecodeerd omdat dit
// pakket geen afhankelijkheden heeft en een keccak-implementatie meeslepen meer
// risico is dan deze ene constante. Zelf na te rekenen met een regel ethers:
//   ethers.id('AuthorizationUsed(address,bytes32)')
export const AUTHORIZATION_USED_TOPIC =
  '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5'

const hex = n => '0x' + Number(n).toString(16)
const getal = h => parseInt(h, 16)

/** Een adres als 32-byte topic. Een onjuiste lengte zou stil op niets matchen. */
export function adresAlsTopic(adres) {
  const kaal = String(adres).replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(kaal)) throw new Error(`geen adres: ${adres}`)
  return '0x' + kaal.padStart(64, '0')
}

export function maakRpc(url, fetchImpl = fetch) {
  let id = 0
  return async function rpc(method, params) {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(25000),
    })
    const j = await r.json()
    if (j.error) throw new Error(`${method}: ${j.error.message}`)
    return j.result
  }
}

/**
 * Zoek het laatste blok op of voor een tijdstip, door te zoeken en niet door te rekenen met een bloktijd.
 *
 * DE OUDE VERSIE NAM DE BLOKTIJD AAN DE KOP ALS GEMIDDELDE VOOR DE HELE TERUGWEG, en dat is stil misgegaan. Base
 * Sepolia maakte op 16 oktober 2026 nog een blok per 2 seconden en een week later een per 0,2 seconde. De schatting
 * kwam 1,9 miljoen blokken te vroeg uit, de correctie met dezelfde verkeerde bloktijd haalde dat niet meer in, en
 * de tool zocht in een venster waar de afrekening niet lag. Op een knooppunt met alle geschiedenis gaf dat
 * "LINKED: no", een onwaar antwoord. Een vreemde die het commando draaide zag het als "pruned history".
 *
 * Nu: een haakje om het tijdstip (een blok erna, en een blok erop of eraf), steeds verkleind door te meten wat
 * het knooppunt zelf zegt, met een interpolatie die de tijden van de uiteinden gebruikt en elke derde stap
 * halveert, zodat het altijd convergeert. De bloktijd die we teruggeven is die RONDOM het gevonden blok.
 * Lukt het niet binnen maxRondes, dan is dat een fout en geen gok.
 */
export async function blokBijTijd(rpc, doelTijd, maxRondes = 60) {
  const tip = getal(await rpc('eth_blockNumber', []))
  const gewist = (bericht) => Object.assign(new Error(bericht), { gewist: true })
  const tijd = async (n) => {
    let b
    try {
      b = await rpc('eth_getBlockByNumber', [hex(n), false])
    } catch (e) {
      // Een publiek knooppunt bewaart maar een deel van de geschiedenis en zegt dat in zijn eigen woorden.
      if (/pruned|missing trie|historical|no longer has|not available/i.test(String(e.message))) throw gewist(e.message)
      throw e
    }
    // Geen blok is een antwoord op zich: er is niets te meten, en dat mag niet lezen als een stacktrace over een leeg object.
    if (!b) throw gewist(`this node no longer has block ${n}: public nodes keep only recent history`)
    return getal(b.timestamp)
  }
  let vloer = 1  // het laagste blok dat dit knooppunt nog kan geven, voor zover bekend
  const tipTijd = await tijd(tip)

  // De bloktijd rond een blok, gemeten over een stuk aan beide kanten, en niet de bloktijd aan de kop.
  const lokaleBloktijd = async (blok) => {
    const van = Math.max(vloer, blok - 100)
    const tot = Math.min(tip, blok + 100)
    if (tot <= van) throw new Error('kon de bloktijd niet meten')
    const verschil = (await tijd(tot)) - (await tijd(van))
    if (!(verschil > 0)) throw new Error('kon de bloktijd niet meten')
    return verschil / (tot - van)
  }

  if (!(tipTijd > doelTijd)) return { blok: tip, blokTijd: await lokaleBloktijd(tip), laatsteBlok: tip }

  let hi = tip, tHi = tipTijd           // tijd boven het doel
  let lo = null, tLo = null             // tijd op of onder het doel
  // Een eerste gok met de bloktijd aan de kop, alleen om te beginnen. Elke meting daarna corrigeert hem.
  let bt = 2
  try {
    const t1 = await tijd(Math.max(1, tip - 1000))
    if (tipTijd > t1) bt = (tipTijd - t1) / Math.min(1000, tip - 1)
  } catch { /* het knooppunt heeft zelfs de laatste duizend blokken niet; de zoektocht zegt het zo meteen */ }
  let n = tip - Math.ceil((tipTijd - doelTijd) / bt)

  for (let ronde = 0; ronde < maxRondes; ronde++) {
    n = Math.max(vloer, Math.min(n, hi - 1))
    if (lo !== null) n = Math.max(n, lo + 1)
    let t
    try {
      t = await tijd(n)
    } catch (e) {
      if (!e.gewist) throw e
      // De schatting viel onder wat het knooppunt nog heeft. Dat is geen reden om op te geven: het doel kan nog
      // binnen zijn geheugen liggen. Noemt het knooppunt zijn vroegste blok, ga daar naartoe, anders halveren.
      const genoemd = Number(/earliest available (\d+)/.exec(e.message)?.[1])
      vloer = Math.max(vloer, Number.isFinite(genoemd) && genoemd > n ? genoemd : n + 1)
      if (vloer >= hi) throw new Error(`pruned history: this node no longer has the block for that time, only blocks from about ${vloer}; public nodes keep only recent history`)
      n = Number.isFinite(genoemd) && genoemd > n ? genoemd : Math.floor((vloer + hi) / 2)
      continue
    }
    if (t <= doelTijd) { lo = n; tLo = t } else {
      hi = n; tHi = t
      // Het vroegste blok dat het knooppunt nog heeft ligt al na het doel: dan is het doel gewist.
      if (n <= vloer && lo === null) throw new Error(`pruned history: this node's earliest block ${n} is already after that time; public nodes keep only recent history`)
    }
    if (lo !== null && hi - lo <= 1) return { blok: lo, blokTijd: await lokaleBloktijd(lo), laatsteBlok: tip }

    if (lo === null) {
      // Nog alleen een bovengrens. De gemiddelde snelheid tussen de kop en dit blok is de beste gok, en we gaan
      // minstens een stuk terug zodat er altijd voortgang is.
      const gemiddeld = (tipTijd - tHi) / Math.max(1, tip - hi)
      if (gemiddeld > 0) bt = gemiddeld
      n = hi - Math.max(1, Math.ceil((tHi - doelTijd) / bt))
    } else if (ronde % 3 === 2 || tHi <= tLo) {
      n = Math.floor((lo + hi) / 2)
    } else {
      n = Math.round(lo + ((doelTijd - tLo) * (hi - lo)) / (tHi - tLo))
    }
  }
  throw new Error('could not place that time on a block within ' + maxRondes + ' reads')
}

/**
 * Alle nonces die deze autorisator in dit venster heeft verbruikt.
 *
 * In stukken van `stap` blokken, want de publieke RPC weigert een groter bereik.
 * Een geweigerde aanroep wordt NOOIT als "geen treffers" doorgegeven: dan stopt
 * dit met een fout, zodat een onmeetbaar venster niet als leeg venster leest.
 */
export async function haalKandidaten(rpc, { asset, authorizer, vanBlok, totBlok, stap = 200, maxAanroepen = 200 }) {
  // Een bovengrens op het aantal aanroepen, want een te ruim venster is hier
  // geen trage controle maar een onbedoelde aanval op een publieke dienst: bij
  // 200 blokken per aanroep kost een venster van een miljoen blokken vijfduizend
  // verzoeken. Liever vooraf stoppen met een duidelijke reden dan iemands IP
  // laten blokkeren door ons gereedschap.
  const nodig = Math.ceil((totBlok - vanBlok + 1) / stap)
  if (nodig > maxAanroepen) {
    throw new Error(
      `that window needs ${nodig} RPC calls (limit ${maxAanroepen}); narrow it, or raise maxAanroepen deliberately`,
    )
  }
  const topics = [AUTHORIZATION_USED_TOPIC, adresAlsTopic(authorizer)]
  const nonces = []
  let aanroepen = 0
  for (let van = vanBlok; van <= totBlok; van += stap) {
    const tot = Math.min(van + stap - 1, totBlok)
    const logs = await rpc('eth_getLogs', [{ address: asset, topics, fromBlock: hex(van), toBlock: hex(tot) }])
    aanroepen++
    for (const l of logs) {
      // Drie topics: de gebeurtenis zelf plus twee geindexeerde velden. Een log
      // met een andere vorm hoort niet bij deze gebeurtenis en wordt genegeerd
      // in plaats van half geinterpreteerd.
      if (!Array.isArray(l.topics) || l.topics.length !== 3) continue
      nonces.push({ nonce: l.topics[2], blok: getal(l.blockNumber), tx: l.transactionHash })
    }
  }
  return { nonces, aanroepen }
}

/**
 * Een tweede lezer van dezelfde keten, voor als het publieke knooppunt het blok niet meer heeft.
 *
 * WAAROM DIT BESTAAT. Gemeten door een vreemde op 24 oktober 2026: zes keer ons commando gedraaid op drie
 * publieke Base Sepolia-knooppunten, nul keer een uitslag, want ze houden alleen recente blokken en onze live
 * voorbeelden zijn ouder. De tool zei eerlijk "onbekend", maar een demo die een vreemde geen uitslag geeft is
 * geen demo. Een verkenner met een Etherscan-compatibele API (Blockscout, zonder sleutel) bewaart de hele
 * geschiedenis.
 *
 * WAT DIT NIET IS. Een verkenner is een derde partij tussen jou en de keten, geen knooppunt. Hij leest
 * dezelfde keten maar kan zich anders gedragen, dus de uitslag zegt altijd welke lezer hem gaf, en het
 * knooppunt blijft de eerste keus. De uitwijk is een tweede mening en nooit een stille vervanging.
 */
export const VERKENNER_STANDAARD = {
  'eip155:84532': 'https://base-sepolia.blockscout.com/api',
  'eip155:8453': 'https://base.blockscout.com/api',
}

export function maakVerkenner(basisUrl, fetchImpl = fetch, { wacht = (ms) => new Promise((r) => setTimeout(r, ms)), pogingen = 3 } = {}) {
  const vraag = async (params) => {
    // Een sleutelloze verkenner begrenst per adres, en een 429 is een verzoek om even te wachten en geen
    // antwoord op de vraag. Tot drie pogingen, met de wachttijd die hij zelf noemt (hooguit 15 seconden) en
    // anders 2 en 4 seconden. Daarna stopt de controle met die reden: ONBEKEND, nooit een leeg venster.
    let r
    for (let poging = 1; poging <= pogingen; poging++) {
      r = await fetchImpl(basisUrl + '?' + new URLSearchParams(params), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      })
      if (r.status !== 429 || poging === pogingen) break
      const genoemd = Number(r.headers?.get?.('retry-after'))
      await wacht(Math.min(15000, Number.isFinite(genoemd) && genoemd > 0 ? genoemd * 1000 : 2000 * poging))
    }
    if (!r.ok) throw new Error(`the explorer answered HTTP ${r.status}${r.status === 429 ? ' (rate limited, try again in a minute)' : ''}`)
    try {
      return await r.json()
    } catch {
      throw new Error('the explorer did not answer with JSON')
    }
  }
  return {
    basisUrl,
    async blokBijTijd(doelTijd) {
      const j = await vraag({ module: 'block', action: 'getblocknobytime', timestamp: String(Math.floor(doelTijd)), closest: 'before' })
      const nr = Number(j?.result?.blockNumber)
      if (j?.status !== '1' || !Number.isFinite(nr)) throw new Error(`the explorer could not place that time on a block (${String(j?.message ?? 'no message').slice(0, 80)})`)
      return nr
    },
    async haalKandidaten({ asset, authorizer, vanBlok, totBlok }) {
      const j = await vraag({
        module: 'logs', action: 'getLogs', fromBlock: String(vanBlok), toBlock: String(totBlok), address: asset,
        topic0: AUTHORIZATION_USED_TOPIC, topic1: adresAlsTopic(authorizer), topic0_1_opr: 'and',
      })
      // "No logs found" is een echt leeg antwoord. Elke andere status 0 is een weigering en NOOIT een leeg venster.
      if (j?.status === '0' && /no logs found/i.test(String(j.message ?? ''))) return { nonces: [], aanroepen: 1 }
      if (j?.status !== '1' || !Array.isArray(j.result)) throw new Error(`the explorer refused the log query (${String(j?.message ?? 'no message').slice(0, 80)})`)
      // Een verkenner kapt een antwoord af op een vast aantal logs. Een afgekapt antwoord is geen volledige lijst.
      if (j.result.length >= 1000) throw new Error('the explorer returned 1000 logs, its cap, so the list may be cut off; narrow --window')
      const nonces = []
      for (const l of j.result) {
        // De verkenner vult het ongebruikte vierde topic met null. Dezelfde vorm als het knooppunt: drie topics.
        const topics = (l.topics ?? []).filter((t) => t !== null)
        if (topics.length !== 3) continue
        nonces.push({ nonce: topics[2], blok: getal(l.blockNumber), tx: l.transactionHash })
      }
      return { nonces, aanroepen: 1 }
    },
  }
}

/** Hetzelfde pad als linkBonnetje, met de verkenner als lezer. De uitslag draagt de bron. */
export async function linkBonnetjeViaVerkenner(verkenner, { payload, salt, asset, venster = null }) {
  if (!payload?.payer) throw new Error('het bonnetje heeft geen payer, dus er is geen autorisator')
  const issuedAt = Number(payload.issuedAt)
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) throw new Error('het bonnetje heeft geen bruikbare issuedAt')
  const blok = await verkenner.blokBijTijd(issuedAt)
  // Een verkenner begrenst het aantal AANVRAGEN en niet het bereik, dus een ruim venster in blokken kost niets extra.
  // Tienduizend blokken is ruim een uur bij 0,2 seconde per blok en ruim vijf uur bij 2 seconden.
  const halfVenster = venster ?? 10_000
  const vanBlok = Math.max(1, blok - halfVenster)
  const totBlok = blok + halfVenster
  const { nonces, aanroepen } = await verkenner.haalKandidaten({ asset, authorizer: payload.payer, vanBlok, totBlok })
  const uitslag = opentCommitment({ receipt: { payload }, salt, asset, kandidaatIdentifiers: nonces.map((n) => n.nonce) })
  const treffer = uitslag.linked ? nonces.find((n) => n.nonce.toLowerCase() === uitslag.identifier.toLowerCase()) : null
  return {
    ...uitslag,
    venster: { vanBlok, totBlok, blokTijd: null, aanroepen, kandidaten: nonces.length },
    afrekening: treffer ?? null,
    bron: 'explorer',
  }
}

/**
 * Het volledige 5.6.4-pad: van bonnetje plus zout naar precies een afrekening.
 *
 * HET VENSTER IS STANDAARD IN SECONDEN, niet in blokken. Een venster van 400 blokken is 800 seconden op een keten met
 * 2 seconden per blok en 80 seconden bij 0,2 seconde per blok, en de afrekening kan best een paar minuten voor of na
 * het bonnetje liggen. Wie zelf blokken kiest (venster) krijgt precies dat, zoals voorheen.
 */
export async function linkBonnetje(rpc, { payload, salt, asset, venster = null, vensterSeconden = 800 }) {
  if (!payload?.payer) throw new Error('het bonnetje heeft geen payer, dus er is geen autorisator')
  const issuedAt = Number(payload.issuedAt)
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) throw new Error('het bonnetje heeft geen bruikbare issuedAt')

  const { blok, blokTijd, laatsteBlok } = await blokBijTijd(rpc, issuedAt)
  const halfVenster = venster ?? Math.ceil(vensterSeconden / blokTijd)
  const vanBlok = Math.max(1, blok - halfVenster)
  const totBlok = Math.min(laatsteBlok, blok + halfVenster)

  const { nonces, aanroepen } = await haalKandidaten(rpc, {
    asset,
    // 5.6.4 stap 1: de autorisator komt uit het ONDERTEKENDE payer-veld. Nooit
    // uit een waarde die naast het zout is aangeleverd, want dan kan iemand het
    // commitment laten openen op de afrekening van een ander.
    authorizer: payload.payer,
    vanBlok,
    totBlok,
  })

  const uitslag = opentCommitment({
    receipt: { payload },
    salt,
    asset,
    kandidaatIdentifiers: nonces.map(n => n.nonce),
  })
  const treffer = uitslag.linked ? nonces.find(n => n.nonce.toLowerCase() === uitslag.identifier.toLowerCase()) : null

  return {
    ...uitslag,
    venster: { vanBlok, totBlok, blokTijd, aanroepen, kandidaten: nonces.length, seconden: Math.round((totBlok - vanBlok) * blokTijd) },
    afrekening: treffer ?? null,
  }
}

// ── commandoregel ────────────────────────────────────────────────────────────
//
// De vlaggen en de uitslag zijn ENGELS, het commentaar hierboven Nederlands. Dat
// is geen slordigheid: dit gereedschap is bedoeld om door een vreemde in een
// protocoldraad gedraaid te worden, en een uitslag die hij niet kan lezen is
// geen controle. De Nederlandse namen blijven wel werken.

function vlag(namen, standaard) {
  for (const naam of [].concat(namen)) {
    const v = process.argv.find(a => a.startsWith(`--${naam}=`))
    if (v) return v.slice(naam.length + 3)
  }
  return standaard
}

/**
 * Waar ligt dit bonnetje: in de werkmap van de aanroeper, of meegeleverd met het pakket.
 *
 * WAAROM DIT BESTAAT. De drie live voorbeelden worden met het pakket meegeleverd, en
 * elke publieke uitleg zegt `--receipt=examples/...`. Wie dat via npx draait staat in
 * zijn EIGEN map, heeft daar geen examples/, en kreeg tot vandaag een kale
 * ENOENT-stacktrace. Voor een gereedschap dat om narekenbaarheid vraagt is dat de
 * ergste uitkomst die er is: het commando dat wij publiceren moet draaien bij de
 * vreemde die het probeert, niet alleen bij ons.
 *
 * Een pad dat de aanroeper zelf meegeeft gaat ALTIJD voor. Pas als dat niet bestaat
 * komt het meegeleverde bestand in beeld, en dan meldt de aanroeper dat ook, want stil
 * een ander bestand lezen dan gevraagd is erger dan een foutmelding.
 *
 * Pure functie met een injecteerbare bestaat-check, zodat een test beide takken kan
 * aantonen zonder bestanden aan te maken of het proces af te breken.
 */
export function kiesBonnetjePad(pad, { bestaat = existsSync } = {}) {
  if (bestaat(pad)) return { pad, uitPakket: false }
  const inPakket = fileURLToPath(new URL('../' + String(pad).replace(/^\.?\//, ''), import.meta.url))
  if (bestaat(inPakket)) return { pad: inPakket, uitPakket: true }
  return null
}

if (process.argv[1]?.endsWith('x402-link-onchain.mjs')) {
  const pad = vlag(['receipt', 'bonnetje'])
  if (!pad) {
    console.log(`usage: node src/x402-link-onchain.mjs --receipt=<file.json> [--salt=0x..] [--asset=0x..] [--rpc=<url>] [--window=400]

The file may be the bare artifact ({format,payload,signature}), or any JSON that
already stores the salt and the asset next to the receipt. Section 5.6.4 needs all
three: receipt, salt and asset. A receipt and a salt alone cannot link.`)
    process.exit(2)
  }

  const gekozen = kiesBonnetjePad(pad)
  if (!gekozen) {
    console.log(`cannot find ${pad}, neither here nor inside the package.`)
    console.log('The three live examples ship with it: examples/receipt-live-base-sepolia.json, -2.json and -3.json.')
    process.exit(2)
  }
  if (gekozen.uitPakket) console.log(`(not found in the working directory, using the copy shipped with the package: ${pad})`)
  const bestand = JSON.parse(readFileSync(gekozen.pad, 'utf8'))
  const artefact = bestand.receipt ?? bestand.bonnetje ?? bestand
  const payload = artefact?.payload ?? artefact
  const salt = vlag(['salt', 'zout'], bestand.authorizationSalt ?? bestand.salt)
  const asset = vlag('asset', bestand.asset)
  const rpcUrl = vlag('rpc', 'https://sepolia.base.org')
  const verkennerUrl = process.argv.includes('--no-explorer') ? null : vlag('explorer', VERKENNER_STANDAARD[String(payload?.network)] ?? null)
  const vensterVlag = vlag(['window', 'venster'], null)
  const venster = vensterVlag === null ? null : Number(vensterVlag)

  const ontbreekt = [
    !payload?.payer && 'payer inside the receipt',
    !salt && 'salt (--salt=)',
    !asset && 'asset (--asset=)',
  ].filter(Boolean)
  if (ontbreekt.length) {
    console.error('missing: ' + ontbreekt.join(', '))
    process.exit(2)
  }

  console.log(`receipt     : version ${payload.version}, payer ${payload.payer}`)
  console.log(`commitment  : ${payload.authorizationCommitment ?? 'none (version 1)'}`)
  console.log(`asset       : ${asset}`)
  console.log(`rpc         : ${rpcUrl}`)

  const rpc = maakRpc(rpcUrl)

  // Drie uitkomsten, drie exitcodes, en dat is precies het onderscheid dat
  // 5.6.4 sinds faa611f eist: gelinkt, niet gelinkt op een VERKREGEN
  // kandidatenlijst, of een controle die niet kon draaien. De module gooide al
  // bij een geweigerde aanroep, maar een onbehandelde fout ziet er voor een
  // script hetzelfde uit als "niet gelinkt", en dat is nu juist het verschil
  // waarop een teller een bonnetje ten onrechte zou weggooien.
  let r
  try {
    r = await linkBonnetje(rpc, { payload, salt, asset, venster })
  } catch (e) {
    console.log(`rpc failed  : ${e.message}`)
    if (verkennerUrl) {
      console.log(`fallback    : asking the explorer ${new URL(verkennerUrl).host}, a third party reading the same chain (use --no-explorer to forbid this)`)
      try {
        r = await linkBonnetjeViaVerkenner(maakVerkenner(verkennerUrl), { payload, salt, asset, venster })
      } catch (e2) {
        console.log('LINKED      : unknown, the check could not be completed')
        console.log(`  reason    : the rpc said "${e.message}" and the explorer said "${e2.message}"`)
        console.log('  note: this is an incomplete check, not a receipt that fails to link.')
        process.exit(2)
      }
    } else {
      console.log('LINKED      : unknown, the check could not be completed')
      console.log(`  reason    : ${e.message}`)
      console.log('  note: this is an incomplete check, not a receipt that fails to link.')
      process.exit(2)
    }
  }

  console.log(`reader      : ${r.bron === 'explorer' ? 'explorer (a third party, not a node)' : 'rpc node'}`)
  console.log(`searched    : blocks ${r.venster.vanBlok} to ${r.venster.totBlok} (${r.venster.aanroepen} calls${r.venster.blokTijd ? `, measured block time ${r.venster.blokTijd.toFixed(2)}s, about ${r.venster.seconden} seconds` : ''})`)
  console.log(`candidates  : ${r.venster.kandidaten} nonce(s) consumed by this payer in that window`)
  if (r.linked) {
    console.log('LINKED      : yes, to exactly one settlement')
    console.log(`  nonce     : ${r.identifier}`)
    console.log(`  tx        : ${r.afrekening.tx}`)
    console.log(`  block     : ${r.afrekening.blok}`)
    process.exit(0)
  }
  console.log(`LINKED      : no (${r.reden})`)
  console.log('  note: that is a statement about the window searched, not about the whole chain.')
  process.exit(1)
}
