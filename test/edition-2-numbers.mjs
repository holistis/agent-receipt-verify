// Edition 2 quotes numbers. This test recounts them: the pasted output block must equal what the summary tool prints today, and every number that the prose
// states must appear in the recount. A planted fault in the text (a changed digit) must fail here.
// Cite as: github.com/holistis/agent-receipt-verify, editions/2026-11-20, 2026-11-20.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { samenvatting, print } from '../src/x402-edition-summary.mjs'

const L = (p) => JSON.parse(readFileSync(new URL('../editions/2026-11-20/' + p, import.meta.url), 'utf8'))
const tekst = readFileSync(new URL('../editions/2026-11-20/EDITION-2.md', import.meta.url), 'utf8').replace(/\r/g, '')
const census = L('census-payai.json'), a = L('liveness-run-a.json'), b = L('liveness-run-b.json'), e1 = L('editie1-gecorrigeerd.json'), tweede = L('tweede-resource.json')
const r = samenvatting(census, a, [e1])
const blok = () => { const m = /<!-- summary:start -->\n```\n([\s\S]*?)\n```\n<!-- summary:end -->/.exec(tekst); assert.ok(m, 'the summary block is in the text'); return m[1] }

test('the pasted summary block equals what the tool prints now', () => { assert.equal(blok(), print(r)) })
test('the checks of the recount pass', () => { assert.deepEqual(r.fouten, []) })
test('every number the prose states appears in the recount', () => {
  const buckets = Object.fromEntries(r.live.emmers.map((e) => [e.emmer, e.hosts]))
  const lvl = (M, t) => M.metingen.filter((m) => m.hoogsteTrede === t).length
  const gelijk = a.metingen.filter((m) => b.metingen.find((x) => x.host === m.host)?.emmer === m.emmer).length
  const gelijkJN = a.metingen.filter((m) => (b.metingen.find((x) => x.host === m.host)?.hoogsteTrede >= 0) === (m.hoogsteTrede >= 0)).length
  const feiten = {
    '17,737': census.recordsGezien, '1,127': 1127, '1,703': census.operators.length,
    '1,324': r.live.antwoordtX402, '379': census.operators.length - r.live.antwoordtX402,
    '179': buckets.pad_weg, '48': buckets.status_402_onbruikbaar, '46': buckets.geen_betaalmuur, '34': buckets.verzoek_geweigerd, '30': buckets.afgeschermd,
    '19': buckets.serverfout, '11': buckets.onbereikbaar, '10': buckets.methode_geweigerd, '2 rate-limit': buckets.tempo_geweigerd,
    '1,693': gelijk, '1,696': gelijkJN, '1,327': b.metingen.filter((m) => m.hoogsteTrede >= 0).length,
    '8 at level 1': lvl(a, 1), '15 at level 2': lvl(a, 2),
    '113 of the 179': tweede.hostsMetEenResource, '66 that have another': tweede.hostsMetEenAndereResource, '4 answer x402': tweede.antwoordtOpNieuwsteResource,
  }
  const verwacht = { '17,737': 17737, '1,127': 1127, '1,703': 1703, '1,324': 1324, '379': 379, '179': 179, '48': 48, '46': 46, '34': 34, '30': 30, '19': 19, '11': 11, '10': 10, '2 rate-limit': 2, '1,693': 1693, '1,696': 1696, '1,327': 1327, '8 at level 1': 8, '15 at level 2': 15, '113 of the 179': 113, '66 that have another': 66, '4 answer x402': 4 }
  for (const [sleutel, waarde] of Object.entries(feiten)) {
    assert.equal(waarde, verwacht[sleutel], `${sleutel}: the data now says ${waarde}`)
    const getal = sleutel.split(' ')[0]
    assert.ok(tekst.includes(getal), `the text does not state ${getal}`)
  }
  // the domain check: recounted from the raw file, and every number the prose states about it must match
  const dom = (h) => h.split('.').slice(-2).join('.')
  const perDom = new Map()
  for (const m of a.metingen) { const d = dom(m.host); const o = perDom.get(d) ?? { n: 0, ok: 0 }; o.n++; if (m.hoogsteTrede >= 0) o.ok++; perDom.set(d, o) }
  assert.equal(perDom.size, 655); assert.deepEqual(perDom.get('workers.dev'), { n: 446, ok: 398 }); assert.deepEqual(perDom.get('vercel.app'), { n: 157, ok: 72 })
  const platform = new Set(['workers.dev', 'vercel.app', 'onrender.com', 'railway.app', 'netlify.app', 'pages.dev', 'fly.dev', 'replit.app'])
  const zonder = a.metingen.filter((m) => !platform.has(dom(m.host)))
  assert.equal(zonder.length, 963); assert.equal(zonder.filter((m) => m.hoogsteTrede >= 0).length, 769)
  assert.equal(new Set(a.metingen.filter((m) => m.hoogsteTrede === 2).map((m) => dom(m.host))).size, 14)
  for (const g of ['655 registrable domains', '446 hosts (26.2 percent)', '398 of them answer', '157 hosts and 72 answer', '769 of 963 hosts answer (79.9 percent)', '14 registrable domains', 'at least 4 of the 179']) assert.ok(tekst.includes(g), 'the text does not state: ' + g)
  assert.ok(!tekst.includes('At most 4'), 'the old overstatement is gone'); assert.ok(!tekst.includes('one afternoon'), 'the old time of day is gone')
  assert.ok(tekst.includes('77.7 percent'), 'the share')
})
test('a changed digit in the block is caught', () => {
  const kapot = blok().replace('1324 of 1703', '1323 of 1703')
  assert.notEqual(kapot, print(r), 'the planted fault differs from the recount')
})
test('the two runs have the same hosts and both passed their controls', () => {
  assert.equal(a.controlesGoed, true); assert.equal(b.controlesGoed, true)
  assert.deepEqual(a.metingen.map((m) => m.host).sort(), b.metingen.map((m) => m.host).sort())
})
