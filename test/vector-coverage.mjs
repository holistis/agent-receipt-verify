// Tests for tools/vector-coverage.mjs. The point of the tool is to see a gap, so every test plants one gap in a good set and the tool must report exactly that.
// Cite as: github.com/holistis/agent-receipt-verify, tools/vector-coverage.mjs, 2026-11-20.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { meet } from '../tools/vector-coverage.mjs'

const WORTEL = resolve(import.meta.dirname, '..')
const PROFIEL = {
  name: 'test set', pattern: '^known-answer-.*\\.json$', wrongSuffix: '-wrong', rejectPrefix: 'known-answer-reject-',
  dimensions: [{ path: 'input.reason', label: 'reason', closedSet: ['a', 'b', 'c'] }, { path: 'input.state', label: 'state', closedSet: ['open', 'closed'] }],
  context: [{ when: 'input.state', is: 'closed', vary: 'input.reason' }],
}
const paar = (naam, input, goed, fout) => [[`known-answer-${naam}.json`, { input: structuredClone(input), observed: goed }], [`known-answer-${naam}-wrong.json`, { input: structuredClone(input), observed: fout }]]
const goedeSet = () => new Map([
  ...paar('a-open', { reason: 'a', state: 'open' }, { v: 1 }, { v: 2 }),
  ...paar('b-closed', { reason: 'b', state: 'closed' }, { v: 1 }, { v: 2 }),
  ...paar('c-closed', { reason: 'c', state: 'closed' }, { v: 1 }, { v: 2 }),
  ['known-answer-reject-x.json', { input: { reason: 'a', state: 'open' }, expected: { code: 'k' } }],
])
const soorten = (r) => r.bevindingen.map((b) => b.soort).sort()

test('a clean set has no findings and the counts are right', () => {
  const r = meet(goedeSet(), PROFIEL)
  assert.deepEqual(r.bevindingen, [])
  assert.equal(r.bestanden, 7); assert.equal(r.rechts, 3); assert.equal(r.wrongTwins, 3); assert.equal(r.afwijzingen, 1)
})

// the mutation matrix on the set: remove, change, duplicate, swap, empty, cut off
test('a right file without its wrong twin is reported', () => {
  const s = goedeSet(); s.delete('known-answer-b-closed-wrong.json')
  assert.deepEqual(soorten(meet(s, PROFIEL)), ['twin-ontbreekt'])
})
test('a wrong twin without its right file is reported', () => {
  const s = goedeSet(); s.delete('known-answer-a-open.json')
  const r = meet(s, PROFIEL)
  assert.ok(soorten(r).includes('twin-wees'))
})
test('a wrong twin with another input is reported', () => {
  const s = goedeSet(); s.get('known-answer-a-open-wrong.json').input = { reason: 'a', state: 'closed' }
  assert.ok(soorten(meet(s, PROFIEL)).includes('twin-andere-invoer'))
})
test('a wrong twin that records the same answer is reported (it is not wrong)', () => {
  const s = goedeSet(); s.get('known-answer-a-open-wrong.json').observed = { v: 1 }
  assert.deepEqual(soorten(meet(s, PROFIEL)), ['twin-gelijk'])
})
test('a declared value that appears in no file is reported, whichever file is removed', () => {
  for (const naam of ['a-open', 'b-closed', 'c-closed']) {
    const s = goedeSet(); s.delete(`known-answer-${naam}.json`); s.delete(`known-answer-${naam}-wrong.json`)
    const r = meet(s, PROFIEL)
    // reason a is also used by the rejection file, so for a the finding is 'only in rejection files'; for b and c it is 'in no file'
    const verwacht = naam[0] === 'a' ? 'waarde-alleen-in-afwijzing' : 'waarde-zonder-vector'
    assert.ok(r.bevindingen.some((b) => b.soort === verwacht && b.pad === 'input.reason' && b.waarde === naam[0]), naam + ': ' + JSON.stringify(r.bevindingen.map((b) => b.uitleg)))
  }
})
test('a value used by a file but not in the declared set is reported', () => {
  const s = goedeSet(); s.get('known-answer-a-open.json').input.reason = 'zzz'; s.get('known-answer-a-open-wrong.json').input.reason = 'zzz'
  const r = meet(s, PROFIEL)
  assert.ok(r.bevindingen.some((b) => b.soort === 'waarde-buiten-lijst' && b.waarde === 'zzz'))
  assert.ok(r.bevindingen.some((b) => b.soort === 'waarde-alleen-in-afwijzing' && b.waarde === 'a'), 'a is now only in the rejection file')
})
test('a field that no file has at all makes every declared value uncovered, never green', () => {
  const p = { ...PROFIEL, dimensions: [{ path: 'input.missing', closedSet: ['x', 'y'] }] }
  const r = meet(goedeSet(), p)
  assert.equal(r.bevindingen.filter((b) => b.soort === 'waarde-zonder-vector').length, 2)
})
test('one context: every file for a value comes from the same other value', () => {
  const s = goedeSet(); s.delete('known-answer-c-closed.json'); s.delete('known-answer-c-closed-wrong.json')
  const r = meet(s, { ...PROFIEL, dimensions: [] })
  assert.deepEqual(soorten(r), ['een-context'])
  assert.deepEqual(r.contexten[0].verschillendeWaarden, ['b'])
  assert.deepEqual(soorten(meet(goedeSet(), { ...PROFIEL, dimensions: [] })), [], 'two contexts: no finding')
})
test('a wrong twin is not counted as coverage of a value', () => {
  const s = goedeSet(); s.get('known-answer-c-closed.json').input.reason = 'a'
  const r = meet(s, PROFIEL)
  assert.ok(r.bevindingen.some((b) => b.soort === 'twin-andere-invoer'), 'the twin now differs')
})

// the command line: exit codes
const draai = (map, profiel, extra = []) => {
  const p = join(map, 'profiel.json'); writeFileSync(p, JSON.stringify(profiel))
  return spawnSync('node', [join(WORTEL, 'tools/vector-coverage.mjs'), map, '--profile=' + p, ...extra], { encoding: 'utf8' })
}
const schrijf = (s) => { const map = mkdtempSync(join(tmpdir(), 'vc-')); for (const [n, v] of s) writeFileSync(join(map, n), JSON.stringify(v)); return map }
test('exit codes: report 0, strict with findings 1, an empty set and a broken profile 2', () => {
  const goed = schrijf(goedeSet())
  assert.equal(draai(goed, PROFIEL).status, 0)
  assert.equal(draai(goed, PROFIEL, ['--strict']).status, 0, 'no findings with --strict is 0')
  const s = goedeSet(); s.delete('known-answer-b-closed-wrong.json')
  const gat = schrijf(s)
  assert.equal(draai(gat, PROFIEL).status, 0)
  assert.equal(draai(gat, PROFIEL, ['--strict']).status, 1)
  const leeg = mkdtempSync(join(tmpdir(), 'vc-leeg-'))
  const r = draai(leeg, PROFIEL)
  assert.equal(r.status, 2); assert.match(r.stdout, /NOT MEASURED/)
  const kapot = mkdtempSync(join(tmpdir(), 'vc-kapot-')); writeFileSync(join(kapot, 'known-answer-x.json'), '{niet json')
  assert.equal(draai(kapot, PROFIEL).status, 2)
  assert.equal(spawnSync('node', [join(WORTEL, 'tools/vector-coverage.mjs')], { encoding: 'utf8' }).status, 2)
})
test('--json prints the same findings as the table', () => {
  const s = goedeSet(); s.delete('known-answer-b-closed-wrong.json')
  const r = draai(schrijf(s), PROFIEL, ['--json'])
  assert.equal(JSON.parse(r.stdout).bevindingen.length, 1)
})
test('a rejection file may use invalid values on purpose: that is not reported as outside the declared set', () => {
  const s = goedeSet(); s.get('known-answer-reject-x.json').input.reason = 'unreviewed'
  assert.deepEqual(meet(s, PROFIEL).bevindingen, [])
})

test('a dimension that counts rejection files only (like an expected code) is read from the rejection files', () => {
  const p = { ...PROFIEL, dimensions: [{ path: 'expected.code', closedSet: ['k', 'm'], in: 'reject' }] }
  const r = meet(goedeSet(), p)
  assert.deepEqual(r.bevindingen.map((b) => b.soort + ':' + b.waarde), ['waarde-zonder-vector:m'])
})
