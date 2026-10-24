// Test voor de suite die de vectorcontroles van de hele keten achter elkaar draait.
//
// DE BELANGRIJKSTE CONTROLE IS DE ROODE. Een suite die altijd groen is bewijst niets, dus de test maakt
// een mislukking na (een kindproces dat met 1 eindigt, en een opname waarvan het verwachte oordeel is
// omgedraaid) en eist dat de suite daar rood op wordt, op de goede plek.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { CONTROLES, draaiSuite } from '../src/conformance-suite.mjs'
import { draaiVectoren } from '../src/x402-grounding.mjs'

let goed = 0, fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}
const bestand = (p) => fileURLToPath(new URL(p, import.meta.url))

console.log('the suite, as a stranger runs it')
{
  const r = spawnSync(process.execPath, [bestand('../src/conformance-suite.mjs')], { encoding: 'utf8' })
  toets('exits 0 when every check behaves as recorded', r.status === 0, 'status ' + r.status + ' ' + r.stdout.slice(-300))
  toets('lists all four checks, in the order of the chain', CONTROLES.map((c) => c.sleutel).every((k, i, a) => r.stdout.indexOf(k) > (i ? r.stdout.indexOf(a[i - 1]) : -1)))
  toets('says plainly that it is not a certification of anyone else', /not a certification of anyone else/.test(r.stdout))
  toets('every check line carries a summary, not only pass', r.stdout.split('\n').filter((l) => /^ {6}\S/.test(l)).length >= CONTROLES.length * 2)
}

console.log('a failing check turns the suite red, at the right place')
{
  const u = draaiSuite({ run: (c) => ({ status: c[0] === 'kanon' ? 1 : 0, stdout: 'agree on 9 of 10, disagree 1, not measured 0' }) })
  toets('the suite does not pass', u.geslaagd === false)
  toets('only the check that failed is marked failed', u.rijen.filter((r) => !r.geslaagd).map((r) => r.sleutel).join() === 'kanon')
  toets('the summary line is the one with the counts', u.rijen[0].regel.startsWith('agree on 9 of 10'))
}
{
  const u = draaiSuite({ run: () => ({ status: 0, stdout: 'a long explanation\n19 of 19 vectors behave as recorded\nWhat this does NOT do: x' }) })
  toets('the summary is the last line with counts, not the last line of text', u.rijen[0].regel === '19 of 19 vectors behave as recorded')
  toets('all passing gives a passing suite', u.geslaagd === true)
}

console.log('the recorded grounding controls, and a disagreement being found')
{
  const r = spawnSync(process.execPath, [bestand('../src/x402-grounding.mjs'), '--vectors'], { encoding: 'utf8' })
  toets('ground --vectors replays the recordings offline and exits 0', r.status === 0 && /2 of 2 recorded controls agree/.test(r.stdout), r.stdout.slice(-200))
  toets('each line names who gave the verdict', (r.stdout.match(/verdict by: https:\/\/github\.com\//g) ?? []).length === 2)

  // een opname waarvan het verwachte oordeel is omgedraaid: de controle moet het zien
  const bron = bestand('../vectors/grounding/')
  const tijdelijk = mkdtempSync(join(tmpdir(), 'ground-'))
  for (const f of readdirSync(bron).filter((x) => x.endsWith('.json'))) copyFileSync(join(bron, f), join(tijdelijk, f))
  const pad = join(tijdelijk, 'afg-positief-agent-1085288.json')
  const v = JSON.parse(readFileSync(pad, 'utf8'))
  v.oordeelVanEenAnder.verwacht.raterIsPayer = 'false'
  writeFileSync(pad, JSON.stringify(v))
  const rijen = await draaiVectoren(tijdelijk + '/')
  const afwijkend = rijen.find((x) => x.naam === 'afg-positief-agent-1085288')
  toets('a reversed expectation is reported as a disagreement on exactly that fact', afwijkend.afwijkend.join() === 'raterIsPayer', JSON.stringify(afwijkend.afwijkend))
  toets('the other recording is unaffected', rijen.find((x) => x.naam === 'afg-negatief-agent-524087').afwijkend.length === 0)
}

console.log('it is reachable the way a stranger reaches it')
{
  const help = spawnSync(process.execPath, [bestand('../bin/cli.mjs'), '--help'], { encoding: 'utf8' })
  toets('suite and ground are in --help, or they do not exist for a stranger', /agent-receipt-verify suite/.test(help.stdout) && /agent-receipt-verify ground/.test(help.stdout))
  const via = spawnSync(process.execPath, [bestand('../bin/cli.mjs'), 'suite'], { encoding: 'utf8' })
  toets('the dispatcher runs the suite', via.status === 0 && /All 4 checks behave as recorded/.test(via.stdout), via.stdout.slice(-200))
}

console.log(`\nconformance suite: ${goed} pass, ${fout} fail`)
process.exitCode = fout === 0 ? 0 : 1
