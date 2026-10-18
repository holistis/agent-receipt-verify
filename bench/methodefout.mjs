#!/usr/bin/env node
/**
 * METHODEFOUT-BENCHMARK -- meet de foutmarge van DEZE meter tegen de echte markt.
 *
 * WAAROM DIT BESTAAT, en het is een eigen fout die het nodig maakte. Deze verifieerder
 * sondeert standaard met POST. Een betaalde route die alleen GET bedient antwoordt
 * daarop 405, of 404 bij veel webraamwerken, en dat las de meter als "dit eindpunt vraagt
 * niet om betaling zoals x402 voorschrijft". Gemeten op 18 oktober 2026, op zestig unieke
 * hosts uit de CDP-index: van de 57 die ECHT om betaling vragen keurde de meter er 36 af.
 * 63,2 procent. Dat bleef onopgemerkt omdat er alleen tegen eigen testvectoren getoetst
 * werd, en testvectoren bevatten precies de vorm die de schrijver al in gedachten had.
 *
 * Een meter die zijn eigen foutmarge tegen de werkelijkheid niet meet, meet niets.
 *
 * DIT GEBRUIKT DE ECHTE METER, niet een nagebouwde sonde. Een eerste versie van dit
 * bestand bouwde het verzoek zelf na, en dat is precies de fout die het wil opsporen: dan
 * benchmark je een replica die met de echte code uit elkaar loopt. Daarom importeert dit
 * `meetEindpunt` uit src.
 *
 * GEDRAGSREGELS, hard, want dit raakt eindpunten van anderen:
 *  - de meter doet zelf een POST en hoogstens een herhaling; dit voegt er alleen bij een
 *    AFKEURING nog een GET aan toe om te zien of de afkeuring terecht was
 *  - een host maar een keer, anders weegt een operator met honderd paden honderd keer
 *  - nooit betalen, nooit fuzzen, nooit herhalen om iets af te dwingen
 *  - rust tussen de hosts
 *
 * GEBRUIK:
 *   node bench/methodefout.mjs --urls <bestand.json>   een array van resource-urls
 *   node bench/methodefout.mjs --urls - < bronnen.json  hetzelfde, van stdin
 *   node bench/methodefout.mjs --urls x.json --uit uitslag.jsonl
 *
 * De lijst met bronnen komt van buiten dit bestand, want die vergt indextoegang en een
 * sleutel, en een benchmark hoort geen geheimen te hoeven lezen.
 *
 * EXITCODES: 0 gemeten, 1 er is een RESTFOUT (de meter keurt nog hosts af die wel om
 * betaling vragen), 2 de meting kon niet draaien.
 */

import fs from 'node:fs'
import { meetEindpunt, hoogsteTrede } from '../src/x402-conformance-check.mjs'

const UA = 'x402-conformance-check/1 (read-only, github.com/holistis/agent-receipt-verify)'
const rust = (ms) => new Promise((r) => setTimeout(r, ms))

function vlag(naam, standaard = null) {
  const v = process.argv.find((a) => a === naam || a.startsWith(naam + '='))
  if (!v) return standaard
  if (v.includes('=')) return v.slice(naam.length + 1)
  return process.argv[process.argv.indexOf(v) + 1] ?? standaard
}

/** Een host maar EEN keer, anders weegt een operator met honderd paden honderd keer. */
export function eenPerHost(urls) {
  const perHost = new Map()
  for (const u of urls) {
    try {
      const h = new URL(u).host
      if (!perHost.has(h)) perHost.set(h, u)
    } catch {}
  }
  return [...perHost.values()]
}

/**
 * Antwoordt dit eindpunt op GET WEL met 402? Dit wordt alleen gevraagd als de meter het
 * eindpunt AFKEURDE, om te zien of die afkeuring terecht was. Een afkeuring die wij niet
 * natrekken, telt stil als een eigenschap van de markt in plaats van als onze restfout.
 */
async function tweedeKansOpGet(url, fetchImpl) {
  try {
    const r = await fetchImpl(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    return r.status === 402
  } catch {
    return false
  }
}

export async function benchmark(urls, { fetchImpl = fetch, pauzeMs = 500 } = {}) {
  const t = {
    gemeten: 0,
    haaltL0: 0,
    // Hoeveel hosts de meter alleen haalt DOORDAT hij een herhaling doet. Dit is wat de
    // reparatie oplevert, en het is tegelijk de omvang van de oude fout.
    gereddenDoorHerhaling: 0,
    // De restfout: de meter keurt af, maar het eindpunt antwoordt wel 402 op GET. Dit
    // hoort nul te zijn. Staat hij boven nul, dan is er nog een vorm die wij missen.
    restfout: 0,
    terechtAfgekeurd: 0,
    ongemeten: 0,
  }
  const gered = []
  const rest = []
  for (const u of urls) {
    t.gemeten++
    const m = await meetEindpunt(u, { fetchImpl })
    const trede = hoogsteTrede(m)
    if (m.treden.t0 === 'ONGEMETEN') {
      t.ongemeten++
    } else if (trede >= 0) {
      t.haaltL0++
      if (m.bewijs.methode_opnieuw) {
        t.gereddenDoorHerhaling++
        gered.push({ url: u, eerste_status: m.bewijs.methode_opnieuw.eerste_status, tweede: m.bewijs.methode_opnieuw.tweede })
      }
    } else {
      await rust(Math.min(300, pauzeMs))
      if (await tweedeKansOpGet(u, fetchImpl)) {
        t.restfout++
        rest.push({ url: u, bewijs: m.bewijs.t0 })
      } else {
        t.terechtAfgekeurd++
      }
    }
    if (pauzeMs) await rust(pauzeMs)
  }
  const vraagtEchtOmBetaling = t.haaltL0 + t.restfout
  return {
    ...t,
    vraagtEchtOmBetaling,
    restfoutPct: vraagtEchtOmBetaling > 0 ? Number(((t.restfout / vraagtEchtOmBetaling) * 100).toFixed(1)) : null,
    zonderHerhalingFoutPct:
      vraagtEchtOmBetaling > 0
        ? Number((((t.gereddenDoorHerhaling + t.restfout) / vraagtEchtOmBetaling) * 100).toFixed(1))
        : null,
    gered,
    rest,
  }
}

if (process.argv[1]?.endsWith('methodefout.mjs')) {
  const bron = vlag('--urls')
  if (!bron) {
    console.error('geef een bestand met resource-urls: --urls bronnen.json (of - voor stdin)')
    process.exit(2)
  }
  let ruw
  try {
    ruw = bron === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(bron, 'utf8')
  } catch (e) {
    console.error('kan de bronlijst niet lezen: ' + e.message)
    process.exit(2)
  }
  let lijst
  try {
    const j = JSON.parse(ruw)
    lijst = Array.isArray(j) ? j : (j.urls ?? j.resources ?? [])
  } catch {
    lijst = ruw.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s))
  }
  const hosts = eenPerHost(lijst.filter((u) => typeof u === 'string'))
  const aantal = Number(vlag('--aantal', String(hosts.length)))
  const teMeten = hosts.slice(0, aantal)
  if (teMeten.length === 0) {
    console.error('geen bruikbare urls, dus NIETS gemeten. Dit is geen uitslag van nul fouten.')
    process.exit(2)
  }

  console.log('urls in de lijst ' + lijst.length + ', unieke hosts ' + hosts.length + ', gemeten ' + teMeten.length)
  const u = await benchmark(teMeten)
  console.log('')
  console.log('  haalt trede 0                              : ' + u.haaltL0)
  console.log('    waarvan alleen door de methode-herhaling : ' + u.gereddenDoorHerhaling)
  console.log('  RESTFOUT, afgekeurd maar antwoordt 402     : ' + u.restfout)
  console.log('  terecht afgekeurd                          : ' + u.terechtAfgekeurd)
  console.log('  niet bereikbaar, dus ongemeten             : ' + u.ongemeten)
  console.log('')
  console.log('  van de ' + u.vraagtEchtOmBetaling + ' hosts die echt om betaling vragen:')
  console.log('    foutmarge NU                 : ' + u.restfoutPct + ' procent')
  console.log('    foutmarge ZONDER de herhaling: ' + u.zonderHerhalingFoutPct + ' procent')
  if (u.rest.length) {
    console.log('')
    console.log('  nog steeds fout, en dit is het werk dat overblijft:')
    for (const r of u.rest.slice(0, 12)) console.log('    ' + r.url + '  ' + r.bewijs)
  }

  const uit = vlag('--uit')
  if (uit) {
    const regel = {
      gemeten_op: new Date().toISOString(),
      gemeten: u.gemeten,
      haalt_l0: u.haaltL0,
      gered_door_herhaling: u.gereddenDoorHerhaling,
      restfout: u.restfout,
      terecht_afgekeurd: u.terechtAfgekeurd,
      ongemeten: u.ongemeten,
      vraagt_echt_om_betaling: u.vraagtEchtOmBetaling,
      restfout_pct: u.restfoutPct,
      zonder_herhaling_fout_pct: u.zonderHerhalingFoutPct,
      rest: u.rest.slice(0, 10).map((r) => r.url),
    }
    fs.appendFileSync(uit, JSON.stringify(regel) + '\n')
    console.log('')
    console.log('regel bijgeschreven in ' + uit)
  }

  // Een restfout boven nul is een echte, open fout van deze meter. Die hoort een
  // exitcode te geven, anders leest een groene run als "alles klopt" terwijl er hosts
  // afgekeurd worden die wel om betaling vragen.
  if (u.restfout > 0) process.exitCode = 1
}
