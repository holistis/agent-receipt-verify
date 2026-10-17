// Meet een x402-eindpunt tegen de conformance-ladder uit CONFORMANCE.md.
//
// WAAROM DIT BESTAAT, en het is geen getal maar een EENHEID. Er zijn metingen van
// de x402-wereld in omloop ("zoveel duizend resources", "nul declareren de
// offer-receipt-extensie") en geen enkele zegt wat er precies geteld is. Zonder
// gedefinieerde eenheid is elk percentage onvergelijkbaar: twintig eindpunten van
// een operator tellen dan twintig keer zo zwaar als een operator met een
// eindpunt, en "werkt" betekent voor iedere meter iets anders. Dat is precies hoe
// een eerdere eigen meting een onzinnige kop opleverde (15 procent, volledig
// bepaald door een partij met honderden paden) tot er per operator geteld werd.
//
// Dit bestand is daarom de meetlat, niet de uitslag. Wie een andere uitslag
// krijgt kan hier nalezen wat wij geteld hebben en waar hij het anders doet.
//
// GEDRAGSREGELS, hard, want dit raakt eindpunten van anderen:
//  - precies een GET of POST per eindpunt, zoals een gewone koper
//  - NOOIT betalen, nooit fuzzen, nooit herhalen om iets af te dwingen
//  - een eerlijke user-agent zodat iedereen in zijn log ziet wie dit was
//  - rustig tempo tussen eindpunten
//
// WAT NIET MEETBAAR IS ZONDER TE BETALEN, en dat staat met opzet in de uitslag in
// plaats van weggelaten: trede 3 tot 5 vereisen een echte afrekening. Een
// eindpunt dat daar "ongemeten" scoort is NIET afgekeurd; het is niet getoetst.

import { verifyOfferSignature, TREDEN } from './x402-conformance-treden.mjs'

const UA = 'x402-conformance-check/1 (read-only, github.com/holistis/agent-receipt-verify)'

const slaap = (ms) => new Promise((r) => setTimeout(r, ms))

/** Base64-JSON uit een header halen zonder op een kapotte header te klappen. */
function decodeerHeader(waarde) {
  if (!waarde) return null
  try {
    return JSON.parse(Buffer.from(waarde, 'base64').toString('utf8'))
  } catch {
    try {
      return JSON.parse(waarde)
    } catch {
      return null
    }
  }
}

/**
 * Trede 0 tot 2 van de ladder, meetbaar zonder te betalen.
 *
 * Geeft per trede HAALT / HAALT_NIET / ONGEMETEN terug plus het bewijs waarop dat
 * oordeel rust, zodat iemand anders hetzelfde eindpunt kan nameten en kan zien
 * waar hij afwijkt.
 */
export async function meetEindpunt(url, { fetchImpl = fetch, methode = 'POST', lichaam = null } = {}) {
  const r = { url, treden: {}, bewijs: {} }
  let resp
  try {
    resp = await fetchImpl(url, {
      method: methode,
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
      // Een gedeclareerd voorbeeldlichaam als de index er een geeft. Een lege {} naar
      // een route die velden eist, levert een 400 die niets over x402 zegt: dan meet
      // je je eigen verzoek in plaats van het eindpunt.
      body: methode === 'GET' || methode === 'DELETE' ? undefined : lichaam != null ? JSON.stringify(lichaam) : '{}',
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    r.treden.t0 = 'ONGEMETEN'
    r.bewijs.t0 = 'not reachable: ' + String(e.message).slice(0, 80)
    return r
  }

  r.bewijs.status = resp.status
  const tekst = await resp.text().catch(() => '')
  const kopNaam = [...resp.headers.keys()].find((k) => /^payment-required$/i.test(k))
  const uitKop = decodeerHeader(kopNaam ? resp.headers.get(kopNaam) : null)
  const uitLichaam = tekst.trim() ? decodeerHeader(tekst) : null
  const aanbod = uitKop ?? uitLichaam

  // TREDE 0: vraagt dit eindpunt uberhaupt om betaling, op de manier die x402
  // voorschrijft? Een 402 met niets erin haalt dit NIET: de eisen horen mee te
  // komen, anders weet een koper niet wat hij moet betalen.
  if (resp.status !== 402) {
    r.treden.t0 = 'HAALT_NIET'
    r.bewijs.t0 = 'status ' + resp.status + ' instead of 402'
    return r
  }
  const accepts = aanbod?.accepts ?? aanbod?.paymentRequirements
  if (!Array.isArray(accepts) || accepts.length === 0) {
    r.treden.t0 = 'HAALT_NIET'
    r.bewijs.t0 = kopNaam
      ? 'a 402 with a Payment-Required header but no usable accepts'
      : 'a 402 with no payment requirements, neither in the header nor in the body'
    return r
  }
  const a = accepts[0]
  const mist = ['scheme', 'network', 'payTo'].filter((k) => !a?.[k])
  if (!(a?.maxAmountRequired ?? a?.amount)) mist.push('an amount')
  if (mist.length) {
    r.treden.t0 = 'HAALT_NIET'
    r.bewijs.t0 = 'accepts[0] is missing: ' + mist.join(', ')
    return r
  }
  r.treden.t0 = 'HAALT'
  r.bewijs.t0 = a.scheme + ' on ' + a.network + ', ' + (a.maxAmountRequired ?? a.amount) + ' to ' + a.payTo
  r.bewijs.accepts0 = { scheme: a.scheme, network: a.network, asset: a.asset ?? null, payTo: a.payTo }

  // TREDE 1: declareert het de offer-receipt-extensie? Dat is de stap van "ik wil
  // geld" naar "ik geef een bewijsstuk af".
  const ext = aanbod?.extensions ?? {}
  const orSleutel = Object.keys(ext).find((k) => /offer-?receipt/i.test(k))
  if (!orSleutel) {
    r.treden.t1 = 'HAALT_NIET'
    r.bewijs.t1 = 'no offer-receipt in extensions (' + (Object.keys(ext).join(', ') || 'no extensions') + ')'
    return r
  }
  r.treden.t1 = 'HAALT'
  r.bewijs.t1 = 'declares ' + orSleutel

  // TREDE 2: zit er een ONDERTEKEND aanbod in, en klopt die handtekening? Een
  // declaratie zonder geldige handtekening is een bewering over een bewering.
  const aanbiedingen = ext[orSleutel]?.info?.offers ?? []
  if (!Array.isArray(aanbiedingen) || aanbiedingen.length === 0) {
    r.treden.t2 = 'HAALT_NIET'
    r.bewijs.t2 = 'declares the extension but carries no signed offer'
    return r
  }
  const controle = await verifyOfferSignature(aanbiedingen[0])
  // ONGEMETEN, niet HAALT_NIET, als de controle niet KON draaien: een onbekend
  // algoritme of een sleutel die niet op te halen is, zegt niets over de partij.
  // Dit bestand beweert dat beginsel in zijn eigen kop al en volgde het hier niet.
  r.treden.t2 = controle.ok ? 'HAALT' : controle.ongemeten ? 'ONGEMETEN' : 'HAALT_NIET'
  r.bewijs.t2 = controle.ok
    ? 'offer signed by ' + controle.signer + (controle.codering ? ', key as ' + controle.codering : '')
    : controle.ongemeten
      ? 'the signature was not checked: ' + controle.reden
      : 'the signature on the offer does not verify: ' + controle.reden
  // Een afwijkende sleutelcodering is een eigen uitslag: de handtekening klopt, maar
  // een verifieerder die zich aan de specificatie houdt weigert de sleutel. Dat mag
  // niet verdwijnen achter een groene trede.
  if (controle.afwijking) r.bewijs.t2afwijking = controle.afwijking

  // TREDE 3 tot 5 vereisen een echte betaling. Ongemeten is niet afgekeurd, en
  // dat onderscheid hoort in de uitslag te staan in plaats van te verdwijnen.
  for (const t of ['t3', 't4', 't5']) {
    r.treden[t] = 'ONGEMETEN'
    r.bewijs[t] = 'needs a real settlement, not attempted'
  }
  return r
}

/** De hoogste trede die dit eindpunt aantoonbaar haalt. */
export function hoogsteTrede(meting) {
  let hoogste = -1
  for (const t of TREDEN) {
    if (meting.treden[t.sleutel] === 'HAALT') hoogste = t.nummer
    else break
  }
  return hoogste
}

export async function meetLijst(urls, { fetchImpl = fetch, pauzeMs = 1200 } = {}) {
  const uit = []
  for (const u of urls) {
    uit.push(await meetEindpunt(u, { fetchImpl }))
    if (pauzeMs) await slaap(pauzeMs)
  }
  return uit
}

if (process.argv[1]?.endsWith('x402-conformance-check.mjs')) {
  const urls = process.argv.slice(2).filter((a) => a.startsWith('http'))
  if (urls.length === 0) {
    console.log('usage: node src/x402-conformance-check.mjs <url> [url ...]')
    console.log('')
    console.log('Measures levels 0 to 2 of the ladder in CONFORMANCE.md without paying.')
    console.log('Levels 3 to 5 need a real settlement and are reported as not measured.')
    process.exitCode = 2
  } else {
    const metingen = await meetLijst(urls)
    for (const m of metingen) {
      const h = hoogsteTrede(m)
      console.log((h >= 0 ? 'L' + h : 'L-') + '  ' + m.url)
      for (const t of TREDEN) {
        const staat = m.treden[t.sleutel]
        if (!staat) continue
        const merk = staat === 'HAALT' ? ' ok ' : staat === 'HAALT_NIET' ? 'FAIL' : ' .. '
        console.log('    [' + merk + '] L' + t.nummer + ' ' + t.naam + ': ' + (m.bewijs[t.sleutel] ?? ''))
      }
    }
    const gehaald = metingen.filter((m) => hoogsteTrede(m) >= 0).length
    console.log('')
    console.log(gehaald + ' of ' + metingen.length + ' endpoint(s) reach level 0 or higher.')
    console.log('Definition and what is deliberately not measured: CONFORMANCE.md')
  }
}
