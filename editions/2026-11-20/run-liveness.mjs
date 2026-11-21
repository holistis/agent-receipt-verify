// Draait de liveness-meting van editie 2 over ALLE hosts van de census, met een controlepunt na elke 20 hosts, zodat een onderbreking niets kost.
// Volgorde: de hosts worden in een vast, over de hele registratievolgorde verspreid patroon afgewerkt (stap-volgorde), zodat een tussenresultaat
// ook zonder het eind een eerlijke steekproef is en niet alleen de eerste, in bulk aangemelde partijen meet. Dezelfde meting als src/x402-index-liveness.mjs
// (zelfde controles, zelfde verzoek per host, zelfde 1,2 seconde pauze, nooit een betaling); alleen het opslaan en de volgorde verschillen.
//
//   node editions/2026-11-20/run-liveness.mjs <census.json> <uit.json> <controlepunt.jsonl>
// Opnieuw starten gaat verder waar het was gebleven. Cite as: github.com/holistis/agent-receipt-verify, editions/2026-11-20, 2026-11-20.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { kiesSteekproef, meetSteekproef, emmer } from '../../src/x402-index-liveness.mjs'
import { meetEindpunt, hoogsteTrede } from '../../src/x402-conformance-check.mjs'

const [, , censusPad, uitPad, cpPad] = process.argv
if (!censusPad || !uitPad || !cpPad) { console.log('usage: node run-liveness.mjs <census.json> <uit.json> <controlepunt.jsonl>'); process.exit(2) }
const slaap = (ms) => new Promise((r) => setTimeout(r, ms))
const census = JSON.parse(readFileSync(censusPad, 'utf8'))
const alle = kiesSteekproef(census.operators, census.operators.length) // alle hosts, op indexpositie
const n = alle.length
// stap-volgorde: een stap die geen deler van n deelt met n, zodat elke host precies eens voorkomt
const stap = (() => { let s = Math.floor(n * 0.6180339887) | 1; const gcd = (a, b) => (b ? gcd(b, a % b) : a); while (gcd(s, n) !== 1) s += 2; return s })()
const volgorde = Array.from({ length: n }, (_, i) => alle[(i * stap) % n])
if (new Set(volgorde.map((o) => o.host)).size !== n) { console.log('INTERN: de volgorde bevat een host dubbel of mist er een'); process.exit(2) }

const POS = { url: 'https://api.tokenizen.nl/api/paid/verify-ownership', methode: 'POST', verwacht: 2 }
const NEG = { url: 'https://example.com/', methode: 'GET', verwacht: -1 }
console.log('--- controls first ---')
const controles = []
for (const c of [POS, NEG]) {
  const m = await meetEindpunt(c.url, { methode: c.methode })
  const t = hoogsteTrede(m)
  controles.push({ ...c, gemeten: t, emmer: emmer(m), status: m.bewijs?.status ?? null, ok: t === c.verwacht })
  console.log((t === c.verwacht ? '  ok   ' : '  FAIL ') + c.url + '  expected L' + c.verwacht + ', measured L' + t)
  await slaap(1200)
}
const controlesGoed = controles.every((c) => c.ok)
if (!controlesGoed) { console.log('the controls failed: stopping, the numbers would be invalid'); process.exit(2) }

const gedaan = new Map()
if (existsSync(cpPad)) for (const regel of readFileSync(cpPad, 'utf8').split('\n').filter(Boolean)) { const m = JSON.parse(regel); gedaan.set(m.host, m) }
console.log('already measured in the checkpoint: ' + gedaan.size + ' of ' + n)
const todo = volgorde.filter((o) => !gedaan.has(o.host))
for (let i = 0; i < todo.length; i += 20) {
  const deel = todo.slice(i, i + 20)
  const metingen = await meetSteekproef(deel)
  for (const m of metingen) { gedaan.set(m.host, m); appendFileSync(cpPad, JSON.stringify(m) + '\n') }
  console.log(new Date().toISOString().slice(11, 19) + '  ' + gedaan.size + ' of ' + n + ' hosts')
}
const metingen = alle.map((o) => gedaan.get(o.host)).filter(Boolean)
const tel = new Map()
for (const m of metingen) tel.set(m.emmer, (tel.get(m.emmer) ?? 0) + 1)
writeFileSync(uitPad, JSON.stringify({
  bron: census.bron,
  steekproefregel: 'ALL hosts of the census, one request each with the method the party declares in the index; processed in a fixed stride order with a checkpoint after every 20 hosts; the result lists hosts by index position',
  hostsInCensus: n, steekproefGrootte: metingen.length, controles, controlesGoed,
  emmers: Object.fromEntries(tel), metingen,
}, null, 2))
console.log('written: ' + uitPad + ' (' + metingen.length + ' of ' + n + ')')
