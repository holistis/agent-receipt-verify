// Tests for src/x402-edition-summary.mjs. Every number an edition quotes comes out of this tool, so each test plants one fault in good files and the tool must see it.
// Cite as: github.com/holistis/agent-receipt-verify, src/x402-edition-summary.mjs, 2026-11-20.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { samenvatting, print } from '../src/x402-edition-summary.mjs'

const WORTEL = resolve(import.meta.dirname, '..')
const census = () => ({
  recordsGezien: 6, uniekeResources: 6,
  operators: [
    { host: 'a', aantalRegistraties: 1, declareertOfferReceipt: false },
    { host: 'b', aantalRegistraties: 3, declareertOfferReceipt: false },
    { host: 'c', aantalRegistraties: 1, declareertOfferReceipt: true },
    { host: 'd', aantalRegistraties: 1, declareertOfferReceipt: false },
  ],
})
const meting = (host, emmer, hoogsteTrede, methode = 'POST', sjab = []) => ({ host, emmer, hoogsteTrede, gedeclareerdeMethode: methode, sjabloonNietIngevuld: sjab })
const liveness = () => ({
  controlesGoed: true,
  metingen: [meting('a', 'x402_ok', 0), meting('b', 'x402_ok', 1), meting('c', 'pad_weg', -1), meting('d', 'onbereikbaar', -1, null)],
})

test('good files: the counts and shares are right and nothing fails', () => {
  const r = samenvatting(census(), liveness())
  assert.deepEqual(r.fouten, [])
  assert.equal(r.gedeclareerd.hosts, 4); assert.equal(r.gedeclareerd.hostsMetEenRegistratie, 3); assert.equal(r.gedeclareerd.aandeelEen, '75.0%')
  assert.equal(r.gedeclareerd.grootsteHostRegistraties, 3); assert.equal(r.gedeclareerd.grootsteHostAandeel, '50.0%'); assert.equal(r.gedeclareerd.declareertOfferReceipt, 1)
  assert.equal(r.live.antwoordtX402, 2); assert.equal(r.live.aandeelAntwoordt, '50.0%'); assert.equal(r.live.declareertOfferReceiptLive, 1)
  assert.deepEqual(r.live.methodeGedeclareerd, { hosts: 3, antwoordt: 2, aandeel: '66.7%' })
  assert.deepEqual(r.live.methodeNietGedeclareerd, { hosts: 1, antwoordt: 0, aandeel: '0.0%' })
  assert.match(print(r), /Checks passed/)
})

// the mutation matrix on the liveness file: remove, duplicate, add, swap, empty, cut off
test('a census host without a measurement is a failed check', () => {
  const l = liveness(); l.metingen.pop()
  assert.ok(samenvatting(census(), l).fouten.some((f) => /no measurement/.test(f)))
})
test('a host measured twice is a failed check', () => {
  const l = liveness(); l.metingen.push(meting('a', 'x402_ok', 0))
  assert.ok(samenvatting(census(), l).fouten.some((f) => /more than once/.test(f)))
})
test('a measured host that is not in the census is a failed check', () => {
  const l = liveness(); l.metingen.push(meting('zzz', 'x402_ok', 0))
  assert.ok(samenvatting(census(), l).fouten.some((f) => /not in the census/.test(f)))
})
test('failed controls make the numbers invalid', () => {
  const l = liveness(); l.controlesGoed = false
  assert.ok(samenvatting(census(), l).fouten.some((f) => /controls/.test(f)))
  const m = liveness(); delete m.controlesGoed
  assert.ok(samenvatting(census(), m).fouten.some((f) => /controls/.test(f)), 'a missing control flag is never a pass')
})
test('an unknown bucket is a failed check', () => {
  const l = liveness(); l.metingen[0].emmer = 'iets_nieuws'
  assert.ok(samenvatting(census(), l).fouten.some((f) => /unknown bucket/.test(f)))
})
test('a measurement on a template URL that could not be filled in is reported apart and not counted against the host', () => {
  const l = liveness(); l.metingen[3] = meting('d', 'verzoek_geweigerd', -1, 'GET', ['ip'])
  const r = samenvatting(census(), l)
  assert.equal(r.live.nietMeetbaarSjabloon, 1); assert.equal(r.live.geldigGemeten, 3); assert.equal(r.live.aandeelAntwoordt, '66.7%')
})
test('the cohort table: hosts measured in an earlier edition, still in the index, gone from it, and what changed', () => {
  const eerder = { metingen: [meting('a', 'x402_ok', 0), meting('c', 'x402_ok', 0), meting('gone', 'x402_ok', 0)] }
  const r = samenvatting(census(), liveness(), [eerder])
  assert.equal(r.cohorten[0].nogInIndex, 2); assert.equal(r.cohorten[0].verdwenenUitIndex, 1)
  assert.deepEqual(r.cohorten[0].verandering, { 'antwoordde -> antwoordt': 1, 'antwoordde -> antwoordt niet': 1 })
})

const draai = (c, l, extra = []) => {
  const map = mkdtempSync(join(tmpdir(), 'es-'))
  writeFileSync(join(map, 'c.json'), JSON.stringify(c)); writeFileSync(join(map, 'l.json'), JSON.stringify(l))
  return spawnSync('node', [join(WORTEL, 'src/x402-edition-summary.mjs'), join(map, 'c.json'), join(map, 'l.json'), ...extra], { encoding: 'utf8' })
}
test('exit codes: good 0, a failed check 1, empty or missing input 2', () => {
  assert.equal(draai(census(), liveness()).status, 0)
  const l = liveness(); l.metingen.pop()
  assert.equal(draai(census(), l).status, 1)
  assert.equal(draai({ operators: [] }, liveness()).status, 2)
  assert.equal(draai(census(), { metingen: [] }).status, 2)
  assert.equal(spawnSync('node', [join(WORTEL, 'src/x402-edition-summary.mjs')], { encoding: 'utf8' }).status, 2)
})
