#!/usr/bin/env node
// x402-edition-summary: turns the two raw files of an edition (census and liveness) into the tables that the edition text quotes, so that every number
// in the text can be recounted with one command and no judgement. It reads files only. It never contacts a host.
//
//   node src/x402-edition-summary.mjs <census.json> <liveness.json> [<earlier-liveness.json> ...] [--json]
//
// The earlier liveness files are only used for the cohort table: the hosts that were measured in an earlier edition, and what they answer now.
//
// Exit 0: tables printed and the checks below passed. 1: a check failed (the numbers must not be quoted). 2: the tool could not read the files.
// Checks: the liveness covers exactly the hosts of the census (no host twice, none missing), the positive and negative controls of the run passed,
// and every measurement falls in a known bucket.
//
// Cite as: github.com/holistis/agent-receipt-verify, src/x402-edition-summary.mjs, 2026-11-20.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BEKEND = new Set(['x402_ok', 'status_402_onbruikbaar', 'afgeschermd', 'pad_weg', 'methode_geweigerd', 'tempo_geweigerd', 'verzoek_geweigerd', 'serverfout', 'geen_betaalmuur', 'onbereikbaar'])
const pct = (n, t) => (t === 0 ? '0.0%' : ((n / t) * 100).toFixed(1) + '%')
const tel = (lijst, sleutel) => { const m = new Map(); for (const x of lijst) m.set(sleutel(x), (m.get(sleutel(x)) ?? 0) + 1); return m }

/** Pure: census and liveness are parsed JSON. Returns the tables and the failed checks. */
export function samenvatting(census, liveness, eerdere = []) {
  const fouten = []
  const hosts = census.operators ?? []
  const metingen = liveness.metingen ?? []
  const hostLijst = hosts.map((o) => o.host)
  const gemeten = metingen.map((m) => m.host)
  const dubbel = [...tel(gemeten, (h) => h)].filter(([, n]) => n > 1).map(([h]) => h)
  const ontbreekt = hostLijst.filter((h) => !gemeten.includes(h))
  const overbodig = gemeten.filter((h) => !hostLijst.includes(h))
  if (dubbel.length) fouten.push(dubbel.length + ' host(s) measured more than once')
  if (ontbreekt.length) fouten.push(ontbreekt.length + ' census host(s) have no measurement')
  if (overbodig.length) fouten.push(overbodig.length + ' measured host(s) are not in the census')
  if (liveness.controlesGoed !== true) fouten.push('the controls of the run did not pass: the numbers are invalid')
  const onbekendeEmmers = [...new Set(metingen.map((m) => m.emmer).filter((e) => !BEKEND.has(e)))]
  if (onbekendeEmmers.length) fouten.push('unknown bucket(s): ' + onbekendeEmmers.join(', '))

  const records = census.recordsGezien
  const grootste = hosts.reduce((a, o) => (o.aantalRegistraties > a ? o.aantalRegistraties : a), 0)
  const een = hosts.filter((o) => o.aantalRegistraties === 1).length
  const gedeclareerd = {
    records, unieke: census.uniekeResources, hosts: hosts.length, hostsMetEenRegistratie: een, aandeelEen: pct(een, hosts.length),
    grootsteHostRegistraties: grootste, grootsteHostAandeel: pct(grootste, records),
    declareertOfferReceipt: hosts.filter((o) => o.declareertOfferReceipt === true).length,
  }

  // a measurement on a template URL that could not be filled in measures our request, not their answer: reported apart, not counted against them
  const sjabloon = metingen.filter((m) => (m.sjabloonNietIngevuld ?? []).length > 0)
  const geldig = metingen.filter((m) => (m.sjabloonNietIngevuld ?? []).length === 0)
  const emmers = [...tel(geldig, (m) => m.emmer)].sort((a, b) => b[1] - a[1]).map(([emmer, n]) => ({ emmer, hosts: n, aandeel: pct(n, geldig.length) }))
  const trede = [...tel(geldig, (m) => m.hoogsteTrede)].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ trede: t, hosts: n, aandeel: pct(n, geldig.length) }))
  const antwoordt = geldig.filter((m) => m.hoogsteTrede >= 0)
  const metMethode = geldig.filter((m) => m.gedeclareerdeMethode)
  const zonderMethode = geldig.filter((m) => !m.gedeclareerdeMethode)
  const live = {
    gemeten: metingen.length, geldigGemeten: geldig.length, nietMeetbaarSjabloon: sjabloon.length,
    antwoordtX402: antwoordt.length, aandeelAntwoordt: pct(antwoordt.length, geldig.length),
    declareertOfferReceiptLive: geldig.filter((m) => m.hoogsteTrede >= 1).length,
    methodeGedeclareerd: { hosts: metMethode.length, antwoordt: metMethode.filter((m) => m.hoogsteTrede >= 0).length, aandeel: pct(metMethode.filter((m) => m.hoogsteTrede >= 0).length, metMethode.length) },
    methodeNietGedeclareerd: { hosts: zonderMethode.length, antwoordt: zonderMethode.filter((m) => m.hoogsteTrede >= 0).length, aandeel: pct(zonderMethode.filter((m) => m.hoogsteTrede >= 0).length, zonderMethode.length) },
    emmers, trede,
  }

  // the cohort: hosts measured in an earlier edition, and what they answer now
  const cohorten = eerdere.map((e) => {
    const toen = new Map((e.metingen ?? []).map((m) => [m.host, m]))
    const nu = new Map(metingen.map((m) => [m.host, m]))
    const gedeeld = [...toen.keys()].filter((h) => nu.has(h))
    const verandering = tel(gedeeld, (h) => (toen.get(h).hoogsteTrede >= 0 ? 'antwoordde' : 'antwoordde niet') + ' -> ' + (nu.get(h).hoogsteTrede >= 0 ? 'antwoordt' : 'antwoordt niet'))
    return { eerderGemeten: toen.size, nogInIndex: gedeeld.length, verdwenenUitIndex: toen.size - gedeeld.length, verandering: Object.fromEntries(verandering) }
  })
  return { gedeclareerd, live, cohorten, fouten }
}

export function print(r) {
  const g = r.gedeclareerd, l = r.live
  const regels = []
  regels.push('Declared layer: ' + g.records + ' records, ' + g.unieke + ' distinct resource URLs, ' + g.hosts + ' hosts.')
  regels.push('  ' + g.hostsMetEenRegistratie + ' hosts (' + g.aandeelEen + ') registered exactly one resource. The largest single host holds ' + g.grootsteHostRegistraties + ' records (' + g.grootsteHostAandeel + ').')
  regels.push('  ' + g.declareertOfferReceipt + ' of ' + g.hosts + ' hosts declare the offer-receipt extension in the index.')
  regels.push('Live layer: ' + l.gemeten + ' hosts measured once each, ' + l.geldigGemeten + ' on a usable request, ' + l.nietMeetbaarSjabloon + ' not measurable (a template URL we could not fill in).')
  regels.push('  ' + l.antwoordtX402 + ' of ' + l.geldigGemeten + ' (' + l.aandeelAntwoordt + ') answer the way x402 says, level 0 or higher. ' + l.declareertOfferReceiptLive + ' declare the offer-receipt extension live.')
  for (const e of l.emmers) regels.push('    ' + String(e.hosts).padStart(5) + '  ' + e.aandeel.padStart(6) + '  ' + e.emmer)
  regels.push('  hosts that declare a method in the index: ' + l.methodeGedeclareerd.antwoordt + ' of ' + l.methodeGedeclareerd.hosts + ' answer (' + l.methodeGedeclareerd.aandeel + '); that declare none: ' + l.methodeNietGedeclareerd.antwoordt + ' of ' + l.methodeNietGedeclareerd.hosts + ' (' + l.methodeNietGedeclareerd.aandeel + ')')
  for (const c of r.cohorten) regels.push('Earlier edition: ' + c.eerderGemeten + ' hosts measured then, ' + c.nogInIndex + ' still in the index, ' + c.verdwenenUitIndex + ' gone from it. ' + JSON.stringify(c.verandering))
  regels.push(r.fouten.length ? 'CHECKS FAILED, do not quote these numbers: ' + r.fouten.join('; ') : 'Checks passed: every census host measured exactly once, controls passed, every bucket known.')
  return regels.join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const pads = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  try {
    if (pads.length < 2) { console.log('usage: node src/x402-edition-summary.mjs <census.json> <liveness.json> [<earlier-liveness.json> ...] [--json]'); process.exit(2) }
    const [c, l, ...e] = pads.map((p) => JSON.parse(fs.readFileSync(p, 'utf8')))
    if (!Array.isArray(c.operators) || c.operators.length === 0 || !Array.isArray(l.metingen) || l.metingen.length === 0) { console.log('NOT MEASURED: the census or the liveness file has no hosts. An empty file is never a pass.'); process.exit(2) }
    const r = samenvatting(c, l, e)
    console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 1) : print(r))
    process.exit(r.fouten.length ? 1 : 0)
  } catch (err) { console.log('NOT MEASURED: ' + err.message); process.exit(2) }
}
