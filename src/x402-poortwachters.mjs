// Meet de POORTWACHTERS, niet de kraampjes.
//
// WAAROM DIT APART STAAT VAN DE ANDERE METINGEN. x402-conformance-check meet een
// verkoper, en x402-discovery-census telt wat verkopers in EEN index hebben
// aangemeld. Beide meten de kraampjes. Maar een verkoper kan niets afrekenen zonder
// een facilitator, en niemand vindt hem zonder een index. Dat zijn er maar een paar,
// en daar zit de macht in deze laag. Een scorebord over een handvol poortwachters is
// daarom iets anders dan een scorebord over duizend winkeltjes: de poortwachters
// kunnen niet doen alsof ze het niet lezen.
//
// WAT HIER MET OPZET NIET GEBEURT. Geen afrekening, geen betaling, geen poging om
// iets af te dwingen, en nooit meer dan een paar gewone GET-verzoeken per host, met
// een eerlijke user-agent en rust ertussen. Dit meet wat een poortwachter ZELF
// publiek over zichzelf zegt via zijn eigen endpoints. Niets meer.
//
// DE TREDEN, en net als bij de verkopersladder is "niet gemeten" geen afkeuring:
//   G0  antwoordt /supported met bruikbare JSON (minstens een netwerk en een scheme)
//   G1  noemt in dat antwoord welke extensies hij ondersteunt
//   G2  biedt een discovery-index aan die JSON teruggeeft
//   G3  die index meldt een totaal, zodat zijn omvang narekenbaar is
//   G4  de index is niet door een enkele partij gedomineerd (grootste host onder de
//       helft van de EERSTE PAGINA)
//
// EN DAAR ZIT EEN VALKUIL IN DIE BIJ DE EERSTE RUN METEEN BLEEK. De eerste pagina is
// NIET representatief. Op payai gaf de eerste pagina 21,0 procent voor de grootste
// host, terwijl onze volledige census over alle 20.597 registraties 51,8 procent
// vond voor het grootste domein. Een index wordt niet in willekeurige volgorde
// geleverd, dus wie alleen de eerste pagina weegt onderschat de concentratie, en in
// dit geval met meer dan een factor twee. G4 is daarom een ONDERGRENS en nooit een
// vrijbrief: hij haalt alleen de gevallen boven water die al op de eerste pagina
// zichtbaar zijn. De echte concentratie meet je met x402-discovery-census.mjs, dat
// de hele index leest.
//
// G4 bestaat omdat onze eigen census op 2026-10-17 vond dat in de grootste index
// EEN domein meer dan de helft van alle registraties houdt, over elf subdomeinen.
// Dat is geen verwijt aan die partij (gemeten: het zijn echte, losse eindpunten),
// maar het betekent dat de omvang van een index niets zegt over het aantal partijen
// in de markt. Een index die dat niet zichtbaar maakt, laat iedereen die hem citeert
// een verkeerd getal noemen.

const UA = 'x402-conformance-check/1 (read-only, github.com/holistis/agent-receipt-verify)'
const slaap = (ms) => new Promise((r) => setTimeout(r, ms))

/** De lijst die x402 zelf publiceert, plus de twee die wij al gemeten hebben. */
export const POORTWACHTERS = [
  { naam: 'payai', basis: 'https://facilitator.payai.network' },
  { naam: 'x402.org', basis: 'https://x402.org/facilitator' },
  { naam: 'celo', basis: 'https://api.x402.celo.org' },
  { naam: 'celo-sepolia', basis: 'https://api.x402.sepolia.celo.org' },
  { naam: 'corbits', basis: 'https://corbits.dev' },
  { naam: 'dexter', basis: 'https://dexter.cash/facilitator' },
  { naam: 'mogami', basis: 'https://facilitator.mogami.tech' },
  { naam: 'mrdn', basis: 'https://mrdn.finance' },
  { naam: 'solvador', basis: 'https://solvador.com' },
  { naam: 'mikedotexe', basis: 'https://x402.mikedotexe.com' },
  { naam: 't54-xrpl', basis: 'https://xrpl-x402.t54.ai' },
  { naam: 'ftptech', basis: 'https://www.ftptech.xyz/x402' },
]

async function haalJson(url, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    const tekst = await r.text().catch(() => '')
    if (!r.ok) return { status: r.status, json: null, reden: 'status ' + r.status }
    try {
      return { status: r.status, json: JSON.parse(tekst) }
    } catch {
      // Een HTML-pagina op een API-pad is GEEN kapotte facilitator, het betekent
      // dat dit endpoint hier niet bestaat. Dat onderscheid hoort in de uitslag.
      return { status: r.status, json: null, reden: tekst.trim().startsWith('<') ? 'html, geen json' : 'geen json' }
    }
  } catch (e) {
    return { status: null, json: null, reden: 'onbereikbaar: ' + String(e.message).slice(0, 50) }
  }
}

/** Leest een /supported-antwoord zonder aan te nemen hoe het precies heet. */
export function leesSupported(j) {
  if (!j || typeof j !== 'object') return { netwerken: [], schemes: [], extensies: [] }
  const rijen = Array.isArray(j) ? j : (j.kinds ?? j.supported ?? j.data ?? j.items ?? [])
  const netwerken = new Set()
  const schemes = new Set()
  const extensies = new Set()
  for (const r of Array.isArray(rijen) ? rijen : []) {
    if (r?.network) netwerken.add(String(r.network))
    if (r?.scheme) schemes.add(String(r.scheme))
    // Een lijst en een object moeten apart: Object.keys op een lijst geeft de
    // INDEXEN, dus ["bazaar"] zou "0" als extensienaam opleveren. Gevonden door de
    // test, en precies het soort stille fout dat een scorebord onzin maakt.
    if (Array.isArray(r?.extensions)) for (const e of r.extensions) extensies.add(String(e))
    else for (const k of Object.keys(r?.extensions ?? {})) extensies.add(k)
  }
  if (Array.isArray(j.extensions)) for (const e of j.extensions) extensies.add(String(e))
  else for (const k of Object.keys(j.extensions ?? {})) extensies.add(k)
  return { netwerken: [...netwerken], schemes: [...schemes], extensies: [...extensies] }
}

/** Concentratie op de EERSTE pagina: het aandeel van de grootste host. */
export function concentratie(items) {
  const perHost = new Map()
  let bruikbaar = 0
  for (const it of Array.isArray(items) ? items : []) {
    let h = null
    try { h = new URL(it?.resource ?? it?.url ?? '').host.toLowerCase() } catch { h = null }
    if (!h) continue
    bruikbaar++
    perHost.set(h, (perHost.get(h) ?? 0) + 1)
  }
  if (bruikbaar === 0) return { hosts: 0, grootste: null, aandeel: null, gemeten: 0 }
  const top = [...perHost.entries()].sort((a, b) => b[1] - a[1])[0]
  return { hosts: perHost.size, grootste: top[0], aandeel: top[1] / bruikbaar, gemeten: bruikbaar }
}

/** De hoogste trede die deze poortwachter aantoonbaar haalt. */
export function hoogsteTrede(m) {
  if (!m.g0) return -1
  if (!m.g1) return 0
  if (!m.g2) return 1
  if (!m.g3) return 2
  if (!m.g4) return 3
  return 4
}

export async function meetPoortwachter(p, { fetchImpl = fetch, pauzeMs = 900 } = {}) {
  const m = { naam: p.naam, basis: p.basis, bewijs: {} }

  const sup = await haalJson(p.basis.replace(/\/$/, '') + '/supported', { fetchImpl })
  const gelezen = leesSupported(sup.json)
  m.g0 = gelezen.netwerken.length > 0 && gelezen.schemes.length > 0
  m.bewijs.g0 = m.g0
    ? gelezen.netwerken.length + ' netwerk(en), scheme(s): ' + gelezen.schemes.join(', ')
    : 'geen bruikbaar /supported (' + (sup.reden ?? 'leeg antwoord') + ')'
  m.netwerken = gelezen.netwerken
  m.schemes = gelezen.schemes

  m.g1 = gelezen.extensies.length > 0
  m.bewijs.g1 = m.g1 ? 'noemt: ' + gelezen.extensies.join(', ') : 'noemt geen enkele extensie'
  m.extensies = gelezen.extensies

  await slaap(pauzeMs)
  const disc = await haalJson(p.basis.replace(/\/$/, '') + '/discovery/resources?limit=100&offset=0', { fetchImpl })
  const items = disc.json?.items ?? disc.json?.resources ?? disc.json?.data ?? null
  m.g2 = Array.isArray(items)
  m.bewijs.g2 = m.g2 ? items.length + ' op de eerste pagina' : 'geen index (' + (disc.reden ?? 'geen items-lijst') + ')'

  const totaal = disc.json?.pagination?.total ?? disc.json?.total ?? null
  m.g3 = m.g2 && Number.isFinite(Number(totaal))
  m.bewijs.g3 = m.g3 ? 'meldt totaal ' + totaal : 'meldt geen totaal, dus zijn omvang is niet na te rekenen'
  m.gemeldTotaal = m.g3 ? Number(totaal) : null

  const c = m.g2 ? concentratie(items) : null
  m.concentratie = c
  if (!m.g2) {
    m.g4 = false
    m.bewijs.g4 = 'geen index om te wegen'
  } else if (!c || c.gemeten === 0) {
    m.g4 = false
    m.bewijs.g4 = 'index zonder bruikbare adressen'
  } else {
    m.g4 = c.aandeel < 0.5
    m.bewijs.g4 = 'grootste host ' + c.grootste + ' is ' + (c.aandeel * 100).toFixed(1) +
      '% van ' + c.gemeten + ' op de EERSTE PAGINA, over ' + c.hosts + ' hosts. Dit is een' +
      ' ondergrens: een volledige census van dezelfde index gaf een duidelijk hoger aandeel.'
  }

  m.trede = hoogsteTrede(m)
  return m
}

if (process.argv[1]?.endsWith('x402-poortwachters.mjs')) {
  const uitPad = process.argv[2]

  // Controles eerst, net als bij de verkopersmeting: een ronde waarin alles faalt
  // bewijst niet dat de wereld faalt, hij kan ook bewijzen dat het gereedschap kapot
  // is. payai is bekend als index-aanbieder, en een documentatiepagina hoort niets
  // te halen.
  console.log('--- controls first ---')
  const pos = await meetPoortwachter({ naam: 'control-payai', basis: 'https://facilitator.payai.network' })
  const neg = await meetPoortwachter({ naam: 'control-docs', basis: 'https://docs.github.com' })
  const posOk = pos.g2 === true
  const negOk = neg.trede === -1
  console.log((posOk ? '  ok   ' : '  FAIL ') + 'a known index offers one: g2=' + pos.g2)
  console.log((negOk ? '  ok   ' : '  FAIL ') + 'a documentation site reaches nothing: level ' + neg.trede)
  if (!posOk || !negOk) {
    console.log('')
    console.log('The harness did not behave on the controls. Treat everything below as invalid.')
  }
  console.log('')

  const uit = []
  for (const p of POORTWACHTERS) {
    const m = await meetPoortwachter(p)
    uit.push(m)
    console.log(
      (m.trede >= 0 ? 'G' + m.trede : 'G-') + '  ' + m.naam.padEnd(14) +
      (m.netwerken.length ? m.netwerken.length + ' net' : '      ') +
      '  ' + (m.g2 ? 'index ja' : 'index nee') +
      (m.gemeldTotaal != null ? ', totaal ' + m.gemeldTotaal : '')
    )
    await slaap(900)
  }

  console.log('')
  const metIndex = uit.filter((m) => m.g2)
  const metExt = uit.filter((m) => m.g1)
  console.log('  ' + uit.filter((m) => m.g0).length + ' of ' + uit.length + ' answer /supported with a usable network and scheme')
  console.log('  ' + metExt.length + ' of ' + uit.length + ' name any extension at all')
  console.log('  ' + metIndex.length + ' of ' + uit.length + ' offer a discovery index that returns json')
  for (const m of metIndex) {
    if (m.concentratie?.aandeel != null) {
      console.log('     ' + m.naam + ': largest host ' + (m.concentratie.aandeel * 100).toFixed(1) + '% of the FIRST PAGE')
    }
  }
  if (metIndex.some((m) => m.concentratie?.aandeel != null)) {
    console.log('')
    console.log('  Read that last number as a floor, not as the concentration. An index is not')
    console.log('  served in random order, so the first page understates it: on payai the first')
    console.log('  page gives 21.0% while a full census of the same index gave 51.8% for the')
    console.log('  largest domain. Use x402-discovery-census.mjs when the number matters.')
  }
  console.log('')
  console.log('  levels 1 to 4 are about what a gatekeeper publishes about itself. A facilitator')
  console.log('  that settles fine but documents nothing scores low here, and that is the point:')
  console.log('  a seller cannot choose what he cannot inspect.')

  if (uitPad) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(uitPad), { recursive: true })
    writeFileSync(uitPad, JSON.stringify({
      bron: 'docs/dev-tools/facilitators.md in x402-foundation/x402, plus x402.org/facilitator',
      controles: { positief: { g2: pos.g2 }, negatief: { trede: neg.trede }, geldig: posOk && negOk },
      poortwachters: uit,
    }, null, 2))
    console.log('')
    console.log('written: ' + uitPad)
  }
}
