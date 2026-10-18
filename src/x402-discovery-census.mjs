// Census of the DECLARED layer of one x402 discovery index, counted per host.
//
// WAAROM DIT APART STAAT VAN x402-conformance-check.mjs. Dat bestand meet een
// eindpunt LIVE: het stuurt een verzoek en leest wat er terugkomt. Dit bestand
// raakt geen enkel eindpunt van iemand anders aan. Het leest alleen wat partijen
// ZELF in een discovery-index hebben laten registreren. Dat zijn twee
// verschillende beweringen en ze mogen nooit tot een cijfer samengeknepen worden:
//
//   gedeclareerd  = wat in de index staat, door de partij zelf aangemeld
//   live          = wat het eindpunt vandaag werkelijk antwoordt
//
// Een census van de eerste is goedkoop en volledig. Een meting van de tweede kost
// een verzoek aan iemand anders en kan daarom alleen op een steekproef. Daarom
// deze volgorde: eerst de census, en de census bepaalt waar de live-steekproef
// naar kijkt. Een willekeurige steekproef trekken voor je weet wat er te vinden
// is, is verzoeken verspillen aan andermans server.
//
// DE EENHEID IS DE HOST, NIET DE RESOURCE. Een partij met driehonderd paden zou
// anders driehonderd keer zo zwaar wegen als een partij met een pad. Zie
// CONFORMANCE.md; dit bestand telt op dezelfde eenheid.
//
// WAT DIT NIET IS, en dit hoort in elke uitslag die eruit komt:
//  - geen ecosysteem-meting. Het is EEN index, op EEN dag.
//  - host is niet hetzelfde als operator. Twee subdomeinen van hetzelfde bedrijf
//    tellen hier als twee. Dat is een bekende grens, niet stilzwijgend opgelost.
//  - een registratie zegt niets over of het eindpunt vandaag nog leeft.

const UA = 'x402-conformance-check/1 (read-only, github.com/holistis/agent-receipt-verify)'
const INDEX = 'https://facilitator.payai.network/discovery/resources'
const PAGINA = 1000

const slaap = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * De door de partij zelf gedeclareerde invoer: padparameters en voorbeeldlichaam.
 *
 * Toegevoegd 2026-10-17, nadat de eerste editie bleek dat de index SJABLOON-URL's
 * bevat (".../v1/ip/:ip") en dat wij die letterlijk opvroegen. De index levert de
 * waarde ernaast; wij gebruikten hem niet. Dat gaf een 400 die niets over x402 zei.
 * Dit veld staat er zodat een volgende meting dat niet overdoet.
 */
export function gedeclareerdeInvoer(item) {
  const ext = item?.extensions ?? {}
  for (const k of Object.keys(ext)) {
    const inp = ext[k]?.info?.input
    if (inp && typeof inp === 'object') {
      return {
        pathParams: inp.pathParams ?? null,
        queryParams: inp.queryParams ?? null,
        body: inp.body ?? null,
      }
    }
  }
  return { pathParams: null, queryParams: null, body: null }
}

/** De door de partij zelf gedeclareerde HTTP-methode, of null als hij niets zegt. */
export function gedeclareerdeMethode(item) {
  const ext = item?.extensions ?? {}
  for (const k of Object.keys(ext)) {
    const m = ext[k]?.info?.input?.method
    if (typeof m === 'string' && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(m.trim())) {
      return m.trim().toUpperCase()
    }
  }
  return null
}

function host(url) {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Haalt de hele index op, pagina voor pagina.
 *
 * Een pagina die faalt WERPT, in plaats van stil een korter resultaat te geven.
 * Een census met een onbekend gat erin is geen census, en een halve uitslag die
 * zich als heel voordoet is precies de fout die deze hele meetlat moet vermijden.
 */
export async function haalIndex({ fetchImpl = fetch, pauzeMs = 800, maxPaginas = 60 } = {}) {
  const items = []
  let offset = 0
  let gemeldTotaal = null
  for (let p = 0; p < maxPaginas; p++) {
    const url = INDEX + '?limit=' + PAGINA + '&offset=' + offset
    const resp = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    })
    if (!resp.ok) throw new Error('index page at offset ' + offset + ' returned ' + resp.status)
    const j = await resp.json()
    const batch = Array.isArray(j.items) ? j.items : []
    if (gemeldTotaal === null) gemeldTotaal = j.pagination?.total ?? null
    // De echte lusindex, niet indexOf: twee registraties kunnen inhoudelijk gelijk
    // zijn en dan geeft indexOf beide dezelfde positie. De positie bepaalt welke
    // resource per host de live-steekproef in gaat, dus een verschuiving hier
    // maakt de steekproef onnavolgbaar voor iemand die hem natrekt.
    for (let i = 0; i < batch.length; i++) items.push({ item: batch[i], offset: offset + i })
    offset += batch.length
    if (batch.length < PAGINA) return { items, gemeldTotaal, paginas: p + 1 }
    if (pauzeMs) await slaap(pauzeMs)
  }
  throw new Error('index did not end within ' + maxPaginas + ' pages')
}

/** Vouwt de ruwe index samen tot een telling per host. */
export function censusPerHost(ruw) {
  const perHost = new Map()
  let zonderHost = 0
  const gezieneResources = new Set()
  let dubbeleResources = 0

  for (const { item, offset } of ruw) {
    const res = item?.resource
    const h = host(res)
    if (!h) {
      zonderHost++
      continue
    }
    if (gezieneResources.has(res)) dubbeleResources++
    else gezieneResources.add(res)

    if (!perHost.has(h)) {
      perHost.set(h, {
        host: h,
        aantalRegistraties: 0,
        eersteOffset: offset,
        eersteResource: res,
        eersteMethode: gedeclareerdeMethode(item),
        eersteInvoer: gedeclareerdeInvoer(item),
        extensieSleutels: new Set(),
        netwerken: new Set(),
        schemes: new Set(),
        x402Versies: new Set(),
        declareertOfferReceipt: false,
      })
    }
    const o = perHost.get(h)
    o.aantalRegistraties++
    // Eerste in index-volgorde is de deterministische keuze voor de live-meting,
    // zodat iemand anders exact dezelfde steekproef kan natrekken.
    if (offset < o.eersteOffset) {
      o.eersteOffset = offset
      o.eersteResource = res
      o.eersteMethode = gedeclareerdeMethode(item)
      o.eersteInvoer = gedeclareerdeInvoer(item)
    }
    for (const k of Object.keys(item?.extensions ?? {})) {
      o.extensieSleutels.add(k)
      if (/offer-?receipt/i.test(k)) o.declareertOfferReceipt = true
    }
    const a = Array.isArray(item?.accepts) ? item.accepts[0] : null
    if (a?.network) o.netwerken.add(String(a.network))
    if (a?.scheme) o.schemes.add(String(a.scheme))
    if (item?.x402Version != null) o.x402Versies.add(String(item.x402Version))
  }

  const operators = [...perHost.values()]
    .map((o) => ({
      ...o,
      extensieSleutels: [...o.extensieSleutels].sort(),
      netwerken: [...o.netwerken].sort(),
      schemes: [...o.schemes].sort(),
      x402Versies: [...o.x402Versies].sort(),
    }))
    .sort((a, b) => b.aantalRegistraties - a.aantalRegistraties || a.host.localeCompare(b.host))

  return { operators, zonderHost, dubbeleResources, uniekeResources: gezieneResources.size }
}

/**
 * Het tweede argument is een uitvoerpad, maar een vlag is geen pad.
 *
 * WAAROM DIT EEN APARTE FUNCTIE IS. Zonder deze controle schrijft dit commando naar
 * letterlijk wat je het geeft, dus `census --help` maakt een bestand met de naam
 * `--help` in de map waar de gebruiker staat. Dat is precies de klasse fout die dit
 * pakket eerder al kostte: een commando dat wij publiceren moet bij een vreemde doen
 * wat hij verwacht, niet rommel achterlaten. Onze eigen testsuite liet er zelf een van
 * achter, en dat was het signaal.
 */
export function uitvoerPadUitArgument(arg) {
  if (arg === undefined) return { pad: null }
  if (typeof arg !== 'string' || arg.startsWith('-')) {
    return { pad: null, klacht: `"${arg}" looks like a flag, not an output path. This command takes an optional file path and nothing else.` }
  }
  return { pad: arg }
}

if (process.argv[1]?.endsWith('x402-discovery-census.mjs')) {
  const keuze = uitvoerPadUitArgument(process.argv[2])
  if (keuze.klacht) {
    console.error(keuze.klacht)
    process.exit(2)
  }
  const uitPad = keuze.pad
  const ruw = await haalIndex()
  const c = censusPerHost(ruw.items)

  const extTelling = new Map()
  for (const o of c.operators) {
    for (const k of o.extensieSleutels) extTelling.set(k, (extTelling.get(k) ?? 0) + 1)
  }
  const netwerkTelling = new Map()
  for (const o of c.operators) {
    for (const n of o.netwerken) netwerkTelling.set(n, (netwerkTelling.get(n) ?? 0) + 1)
  }

  console.log('source      : ' + INDEX)
  console.log('reported    : ' + ruw.gemeldTotaal + ' resources, in ' + ruw.paginas + ' pages')
  console.log('seen        : ' + ruw.items.length + ' records, ' + c.uniekeResources + ' distinct resource URLs')
  if (c.dubbeleResources) console.log('duplicates  : ' + c.dubbeleResources + ' records repeat a resource URL already seen')
  if (c.zonderHost) console.log('unparseable : ' + c.zonderHost + ' records without a usable URL')
  console.log('hosts       : ' + c.operators.length)
  console.log('')
  console.log('registrations per host, the ten largest:')
  for (const o of c.operators.slice(0, 10)) {
    console.log(
      '  ' + String(o.aantalRegistraties).padStart(6) + '  ' + o.host +
      '  [' + (o.extensieSleutels.join(', ') || 'no extensions') + ']'
    )
  }
  const een = c.operators.filter((o) => o.aantalRegistraties === 1).length
  console.log('')
  console.log('  ' + een + ' of ' + c.operators.length + ' hosts registered exactly one resource')
  console.log('  largest host holds ' + c.operators[0].aantalRegistraties + ' of ' + c.uniekeResources +
    ' resources (' + ((c.operators[0].aantalRegistraties / c.uniekeResources) * 100).toFixed(1) + ' percent)')
  console.log('')
  console.log('extensions declared, counted per host:')
  for (const [k, v] of [...extTelling].sort((a, b) => b[1] - a[1])) {
    console.log('  ' + String(v).padStart(6) + '  ' + k)
  }
  const or = c.operators.filter((o) => o.declareertOfferReceipt)
  console.log('')
  console.log('offer-receipt declared by ' + or.length + ' of ' + c.operators.length + ' hosts')
  for (const o of or.slice(0, 25)) console.log('  ' + o.host + '  ' + o.eersteResource)
  console.log('')
  console.log('networks, counted per host:')
  for (const [k, v] of [...netwerkTelling].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log('  ' + String(v).padStart(6) + '  ' + k)
  }

  if (uitPad) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(uitPad), { recursive: true })
    writeFileSync(
      uitPad,
      JSON.stringify(
        {
          bron: INDEX,
          gemeldTotaal: ruw.gemeldTotaal,
          paginas: ruw.paginas,
          recordsGezien: ruw.items.length,
          uniekeResources: c.uniekeResources,
          dubbeleResources: c.dubbeleResources,
          zonderHost: c.zonderHost,
          operators: c.operators,
        },
        null,
        2
      )
    )
    console.log('')
    console.log('written: ' + uitPad)
  }
}
