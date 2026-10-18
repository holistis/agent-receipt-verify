// Test voor de poging-identiteit, en tegelijk de DEKKINGSMETING over paragraaf 5.5.
//
// De dekkingsmeting is hier geen extraatje maar de kern. Een vectorset voor een spec is
// pas bruikbaar als ELKE normatieve clausule zowel een goedkeuring als een afkeuring
// heeft. Met alleen afkeuringen weet een lezer niet of het harnas ooit ja zegt, en met
// alleen goedkeuringen weet hij niet of het ooit nee zegt. Die meting staat hieronder als
// harde toets, zodat een nieuwe clausule in de spec niet stil onbedekt kan blijven.
//
// En de belangrijkste losse toets is de vierde uitkomst: een vector zonder waarnemingen
// moet NOT_MEASURED geven. Zou hij PASS geven, dan kan een implementatie naleving claimen
// door niets te laten zien.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toetsPogingIdentiteit, CLAUSULES, UITKOMSTEN, velddigest, bytedigest, sorteerStabiel } from '../src/attempt-identity.mjs'

const hier = path.dirname(fileURLToPath(import.meta.url))
const vectorMap = path.join(hier, '..', 'vectors', 'attempt-identity')

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) {
    goed++
    console.log('  pass  ' + naam)
  } else {
    fout++
    console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : ''))
  }
}

console.log('elke vector op schijf wordt echt gedraaid')
const bestanden = fs.readdirSync(vectorMap).filter((b) => b.endsWith('.json')).sort()
const vectoren = bestanden.map((b) => ({ b, v: JSON.parse(fs.readFileSync(path.join(vectorMap, b), 'utf8')) }))
{
  t('er staan vectoren op schijf', vectoren.length >= 15, String(vectoren.length))
  let past = 0
  for (const { b, v } of vectoren) {
    const u = toetsPogingIdentiteit(v.input)
    const e = v.expected
    const ok = u.outcome === e.outcome && (e.reason_code === undefined || u.reason_code === e.reason_code)
    if (ok) past++
    else t('vector ' + b, false, u.outcome + '/' + u.reason_code)
  }
  t('alle vectoren geven hun verwachte uitkomst', past === vectoren.length, past + ' van ' + vectoren.length)
  t(
    'elke vector noemt zijn herkomst, zijn clausule en zijn grenzen',
    vectoren.every(({ v }) => Array.isArray(v.provenance) && v.provenance.length && v.clause && Array.isArray(v.limits) && v.limits.length),
  )
  t('geen vector vraagt een ketenlezing', vectoren.every(({ v }) => v.requires_chain_read === false))
}

console.log('')
console.log('DEKKINGSMETING over paragraaf 5.5')
{
  const perClausule = new Map(CLAUSULES.map((c) => [c.id, { pass: 0, fail: 0 }]))
  for (const { v } of vectoren) {
    const vak = perClausule.get(v.clause)
    if (!vak) continue
    if (v.expected.outcome === 'PASS') vak.pass++
    if (v.expected.outcome === 'FAIL') vak.fail++
  }
  const zonderGoedkeuring = []
  const zonderAfkeuring = []
  for (const c of CLAUSULES) {
    const vak = perClausule.get(c.id)
    console.log('  ' + (vak.pass > 0 && vak.fail > 0 ? 'gedekt  ' : 'GAT     ') + c.id + '  (' + vak.pass + ' pass, ' + vak.fail + ' fail)')
    if (vak.pass === 0) zonderGoedkeuring.push(c.id)
    if (vak.fail === 0) zonderAfkeuring.push(c.id)
  }
  t('elke clausule heeft minstens een GOEDKEURING', zonderGoedkeuring.length === 0, zonderGoedkeuring.join(', '))
  t('elke clausule heeft minstens een AFKEURING', zonderAfkeuring.length === 0, zonderAfkeuring.join(', '))
  t('elke clausule draagt het letterlijke citaat uit de spec', CLAUSULES.every((c) => String(c.citaat).length > 40))
  t('er zijn acht normatieve clausules benoemd', CLAUSULES.length === 8, String(CLAUSULES.length))
}

console.log('')
console.log('de vierde uitkomst, en waarom hij er is')
{
  const leeg = toetsPogingIdentiteit({})
  t('niets vastgelegd geeft NOT_MEASURED', leeg.outcome === 'NOT_MEASURED', leeg.outcome)
  t('en geen enkele clausule telt als gemeten', leeg.gemeten === 0, String(leeg.gemeten))
  t('niet-object invoer breekt niets', toetsPogingIdentiteit(null).outcome === 'NOT_MEASURED')
  t('de drie uitkomsten staan vast', UITKOMSTEN.length === 3 && UITKOMSTEN.includes('NOT_MEASURED'))
}

console.log('')
console.log('een enkele overtreding weegt zwaarder dan elke goedkeuring ernaast')
{
  const SNAP = { method: 'POST', path: '/x', amount: '1000' }
  const id = velddigest(SNAP)
  const gemengd = toetsPogingIdentiteit({
    ingress: { snapshot: SNAP, identity: id },
    paths: [
      { path: 'challenge-quote', snapshot: SNAP, identity: id, derived_from: 'ingress-snapshot' },
      { path: 'settle', snapshot: SNAP, identity: id, derived_from: 'ingress-snapshot' },
    ],
    outcome_variants: [
      { delivered: 100, identity: id },
      { delivered: 40, identity: velddigest({ anders: true }) },
    ],
  })
  t('een invariant is geen cijferlijst, dus dit faalt', gemengd.outcome === 'FAIL', gemengd.outcome)
  t('en de reden is de overtreding, niet de goedkeuring', gemengd.reason_code === 'OUTCOME_FOLDED_INTO_IDENTITY', String(gemengd.reason_code))
  t('het aantal gemeten clausules staat er los bij', gemengd.gemeten >= 3, String(gemengd.gemeten))
}

console.log('')
console.log('de twee omgekeerde vallen, want een implementatie doet er bijna zeker een verkeerd')
{
  const stuk = '{"b":2,"a":1}'
  const overBytes = { signed_artifact_reference: { transmitted: stuk, reference_hash: bytedigest(stuk) } }
  const overVelden = { signed_artifact_reference: { transmitted: stuk, reference_hash: velddigest(JSON.parse(stuk)) } }
  t('een verwijzing over de verzonden bytes is goed', toetsPogingIdentiteit(overBytes).outcome === 'PASS')
  t(
    'dezelfde verwijzing over een gecanonicaliseerde vorm is fout',
    toetsPogingIdentiteit(overVelden).reason_code === 'REFERENCE_CANONICALIZED_BEFORE_HASHING',
  )
  t('en de controleur rekent beide kandidaten ZELF uit, dus een verkeerd label haalt het niet',
    toetsPogingIdentiteit({ signed_artifact_reference: { transmitted: stuk, reference_hash: 'f'.repeat(64) } }).reason_code === 'REFERENCE_HASH_UNEXPLAINED')

  // En het omgekeerde: bij de EIGEN identiteit moet de sleutelvolgorde juist niets doen.
  const velden = { a: 1, b: 2 }
  const stabiel = {
    wire_variants: [
      { decoded: velden, identity: 'aa'.repeat(32) },
      { decoded: { b: 2, a: 1 }, identity: 'aa'.repeat(32) },
    ],
  }
  t('dezelfde velden in een andere volgorde horen dezelfde identiteit te hebben', toetsPogingIdentiteit(stabiel).outcome === 'PASS')
  t('de stabiele sortering maakt die twee gelijk', velddigest(velden) === velddigest({ b: 2, a: 1 }))
  t('en sorteerStabiel raakt gewone waarden niet aan', sorteerStabiel('x') === 'x' && sorteerStabiel(3) === 3)
}

console.log('')
console.log('varianten met verschillende velden zijn ONGEMETEN, geen afkeuring')
{
  const anders = {
    wire_variants: [
      { decoded: { a: 1 }, identity: 'aa'.repeat(32) },
      { decoded: { a: 2 }, identity: 'bb'.repeat(32) },
    ],
  }
  const u = toetsPogingIdentiteit(anders)
  t('andere velden betekent dat de vergelijking niet opgaat', u.outcome === 'NOT_MEASURED', u.outcome)
}

console.log('')
console.log('attempt-identity: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
