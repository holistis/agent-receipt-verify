// Tegenwerping tegen de kop "een deel van de gedeclareerde hosts antwoordt niet": de liveness-meting vraagt per host maar EEN resource, de met de laagste
// indexpositie, dus meestal de oudste registratie, en die is het meest verlopen. Een host waarvan dat pad weg is (404 of 410) kan nog steeds andere
// resources dienen. Dit script meet voor precies die hosts de NIEUWSTE registratie (hoogste indexpositie) en telt hoeveel dan wel antwoorden.
//
//   node editions/2026-11-20/tweede-resource.mjs <liveness-volledig.json> <uit.json>
// Zelfde meting als de liveness (zelfde methode per host uit de index, geen betaling, 1,2 seconde pauze, eerst de twee controles).
// Cite as: github.com/holistis/agent-receipt-verify, editions/2026-11-20/tweede-resource.mjs, 2026-11-20.
import { readFileSync, writeFileSync } from 'node:fs'
import { haalIndex, gedeclareerdeInvoer, gedeclareerdeMethode } from '../../src/x402-discovery-census.mjs'
import { meetSteekproef, emmer } from '../../src/x402-index-liveness.mjs'
import { meetEindpunt, hoogsteTrede } from '../../src/x402-conformance-check.mjs'

const [, , livenessPad, uitPad] = process.argv
if (!livenessPad || !uitPad) { console.log('usage: node tweede-resource.mjs <liveness-volledig.json> <uit.json>'); process.exit(2) }
const slaap = (ms) => new Promise((r) => setTimeout(r, ms))
const live = JSON.parse(readFileSync(livenessPad, 'utf8'))
const doel = new Set(live.metingen.filter((m) => m.emmer === 'pad_weg').map((m) => m.host))
const eerste = new Map(live.metingen.map((m) => [m.host, m.urlInIndex]))
console.log('hosts whose first resource is gone (404 or 410): ' + doel.size)

const controles = []
for (const c of [{ url: 'https://api.tokenizen.nl/api/paid/verify-ownership', methode: 'POST', verwacht: 2 }, { url: 'https://example.com/', methode: 'GET', verwacht: -1 }]) {
  const m = await meetEindpunt(c.url, { methode: c.methode }); const t = hoogsteTrede(m)
  controles.push({ ...c, gemeten: t, ok: t === c.verwacht }); console.log((t === c.verwacht ? '  ok   ' : '  FAIL ') + c.url); await slaap(1200)
}
if (!controles.every((c) => c.ok)) { console.log('controls failed: stopping'); process.exit(2) }

const { items } = await haalIndex()
const nieuwste = new Map(); const aantal = new Map()
const hostVan = (u) => { try { return new URL(u).hostname } catch { return null } }
for (const { item, offset } of items) {
  const h = hostVan(item?.resource)
  if (!h || !doel.has(h)) continue
  aantal.set(h, (aantal.get(h) ?? 0) + 1)
  if (!nieuwste.has(h) || offset > nieuwste.get(h).offset) nieuwste.set(h, { item, offset })
}
const kandidaten = []
for (const [h, { item, offset }] of nieuwste) {
  if (item.resource === eerste.get(h)) continue // een host met een enkele resource: er is niets anders om te meten
  kandidaten.push({ host: h, aantalRegistraties: aantal.get(h), eersteOffset: offset, eersteResource: item.resource, eersteMethode: gedeclareerdeMethode(item), eersteInvoer: gedeclareerdeInvoer(item) })
}
console.log('of those, hosts with another resource to measure: ' + kandidaten.length + '; hosts with one resource only: ' + (doel.size - kandidaten.length))
const metingen = await meetSteekproef(kandidaten)
const antwoordt = metingen.filter((m) => m.hoogsteTrede >= 0).length
const tel = new Map(); for (const m of metingen) tel.set(m.emmer, (tel.get(m.emmer) ?? 0) + 1)
writeFileSync(uitPad, JSON.stringify({
  regel: 'for the hosts whose first resource returned 404 or 410: the resource with the highest index position, one request each', controles,
  hostsPadWeg: doel.size, hostsMetEenAndereResource: kandidaten.length, hostsMetEenResource: doel.size - kandidaten.length,
  antwoordtOpNieuwsteResource: antwoordt, emmers: Object.fromEntries(tel), metingen,
}, null, 2))
console.log('another resource answers x402 on ' + antwoordt + ' of ' + kandidaten.length + ' hosts; written ' + uitPad)
