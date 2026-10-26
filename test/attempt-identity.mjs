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
  t('er zijn twaalf normatieve clausules benoemd', CLAUSULES.length === 12, String(CLAUSULES.length))
}

console.log('')
console.log('de kanonieke leden (query, lichaam, JSON) volgens de huidige tekst van 5.5')
{
  const { canonicalQuery, jcs, bodyDigest, decodeBody } = await import('../src/canonical-request.mjs')
  const zlib = await import('node:zlib')
  t('volgorde en hoofdletters van het procentteken veranderen de query niet', canonicalQuery('b=2&a=%2f') === canonicalQuery('a=%2F&b=2'))
  t('de canonieke query is gesorteerd op naam en dan op waarde, herhaalde sleutels blijven', canonicalQuery('b=1&a=2&a=1') === 'a=1&a=2&b=1')
  t('een naam zonder gelijkteken is een paar met een lege waarde', canonicalQuery('a') === 'a=')
  t('hoofdletter-hex over de niet-gereserveerde set', canonicalQuery('q=caf%c3%a9 x') === 'q=caf%C3%A9%20x')
  t('een plusteken blijft een letterlijk plusteken (RFC 3986), geen spatie', canonicalQuery('a=b+c') === 'a=b%2Bc')
  t('een lege query en geen query zijn gelijk', canonicalQuery('') === canonicalQuery(undefined) && canonicalQuery('?') === '')
  t('RFC 8785: sleutels gesorteerd, geen witruimte', jcs({ b: [1, { z: 1, a: 2 }], a: 'x' }) === '{"a":"x","b":[1,{"a":2,"z":1}]}')
  const j1 = { bodyBase64: Buffer.from('{"a":1,"b":2}').toString('base64'), contentType: 'application/json' }
  const j2 = { bodyBase64: Buffer.from('{ "b": 2,\n "a": 1 }').toString('base64'), contentType: 'application/json; charset=utf-8' }
  t('dezelfde JSON in een andere volgorde geeft dezelfde digest', bodyDigest(j1) === bodyDigest(j2))
  const gz = { bodyBase64: zlib.gzipSync(Buffer.from('{"a":1,"b":2}')).toString('base64'), contentEncoding: 'gzip', contentType: 'application/json' }
  t('een gzip-lichaam geeft dezelfde digest als het ongecomprimeerde', bodyDigest(gz) === bodyDigest(j1))
  const latin = decodeBody({ bodyBase64: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64'), contentType: 'text/plain; charset=iso-8859-1' })
  t('het lichaam wordt uit het opgegeven tekenstelsel gedecodeerd', latin === 'café')
  const dubbel = { bodyBase64: Buffer.from('{"a":1,"a":2}').toString('base64'), contentType: 'application/json' }
  const enkel = { bodyBase64: Buffer.from('{"a":2}').toString('base64'), contentType: 'application/json' }
  t('JSON met een dubbele sleutel wordt niet als gewone JSON gecanonicaliseerd (parser-verschil)', bodyDigest(dubbel) !== bodyDigest(enkel))
}

console.log('')
console.log('regressies uit de onafhankelijke audit van 26 oktober 2026')
{
  const SNAP = { method: 'POST', path: '/x', query: '', body: {}, payTo: '0x1', asset: '0x2', network: 'eip155:8453', amount: '1000', scheme: 'exact' }
  const id = velddigest(SNAP)
  const A = 'aa'.repeat(32), B = 'bb'.repeat(32), C = 'cc'.repeat(32)
  const uit = (inv) => toetsPogingIdentiteit(inv)
  // een samengevouwen identiteit mag niet slagen omdat een ander pad niets heeft vastgelegd
  const ander = { ...SNAP, amount: '3000' }
  let r = uit({ ingress: { snapshot: SNAP, identity: id }, paths: [{ path: 'settle', snapshot: ander, identity: velddigest(ander) }, { path: 'refusal', snapshot: ander, identity: id, established_at: 'ingress' }] })
  t('een pad dat de identiteit behoudt bij een gewijzigd verzoek faalt, ook als een ander pad niets heeft vastgelegd', r.outcome === 'FAIL' && r.reason_code === 'CHANGED_REQUEST_SAME_IDENTITY', r.outcome + '/' + r.reason_code)
  r = uit({ ingress: { snapshot: SNAP, identity: A }, paths: ['challenge-quote', 'settle', 'refusal', 'replay-lookup'].map((p) => ({ path: p, identity: B })) })
  t('vier paden die het onderling eens zijn maar niet met de ingress, falen', r.outcome === 'FAIL' && r.reason_code === 'PATHS_DISAGREE_ON_IDENTITY', r.outcome + '/' + r.reason_code)
  r = uit({ ingress: { snapshot: SNAP, identity: id }, paths: [{ path: 'settle', identity: id }, { path: 'refusal', identity: id }] })
  t('zonder vastgelegde afleiding is derive-once niet gemeten, en geen goedkeuring', !r.per_clausule.some((c) => c.clausule === 'derive-once-at-ingress' && c.uitkomst === 'PASS'))
  r = uit({ countersignature: { ingress_value: A, recomputed: B } })
  t('een afwijking zonder vastgelegd ondertekenen of afrekenen is niet gemeten', r.outcome === 'NOT_MEASURED', r.outcome)
  r = uit({ countersignature: { ingress_value: A, recomputed: null, signed: false, settled: false, reported_reason: 'comparison_not_possible' } })
  t('een ontbrekende herberekende waarde is een mislukte vergelijking en geen verschil', r.outcome === 'PASS', r.outcome + '/' + r.reason_code)
  r = uit({ ingress: { snapshot: Object.fromEntries(Object.keys(SNAP).map((k) => [k, null])), identity: id } })
  t('een momentopname met negen lege leden is niet volledig', r.reason_code === 'INGRESS_SNAPSHOT_INCOMPLETE', String(r.reason_code))
  r = uit({ hashed_set: { members: { x: 'waarde', memo: null }, absent: ['x', 'memo'] } })
  t('een afwezig lid met een lege waarde wordt gezien, ook naast een lid met een waarde', r.reason_code === 'ABSENT_MEMBER_EMITTED_AS_EMPTY', String(r.reason_code))
  const e1 = '0xAbCdEfabcdefABCDEFabcdefabcdefABCDEFabcd', e2 = e1.toLowerCase()
  const nv = (a, i) => ({ raw: { network: 'eip155:8453', address: a, timestamp: '2026-10-26T11:00:00Z' }, identity: i })
  r = uit({ normalization_variants: [nv(e1, A), nv(e2, B), nv('0x1111111111111111111111111111111111111111', C)] })
  t('twee EVM-adressen die alleen in hoofdletters verschillen en een andere identiteit kregen, falen ook met een derde variant', r.reason_code === 'NORMALIZATION_NOT_APPLIED', String(r.reason_code))
  r = uit({ normalization_variants: [{ raw: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', address: 'So1abcDEF', timestamp: '2026-10-26T11:00:00Z' }, identity: A }, { raw: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', address: 'so1abcdef', timestamp: '2026-10-26T11:00:00Z' }, identity: B }] })
  t('een Solana-adres wordt niet in kleine letters gezet, dus twee identiteiten voor twee verschillende adressen is goed', r.outcome === 'PASS', r.outcome + '/' + r.reason_code)
  r = uit({ normalization_variants: [{ raw: { network: 'eip155:8453', address: e2, timestamp: '2026-10-26T11:00:00.500Z' }, identity: A }, { raw: { network: 'eip155:8453', address: e2, timestamp: '2026-10-26T11:00:00Z' }, identity: B }] })
  t('een tijdstip met 500 milliseconden is een ander tijdstip dan zonder', r.outcome === 'PASS', r.outcome + '/' + r.reason_code)
  const ref = (declared, variants, extra = {}) => ({ signed_artifact_reference: { declared, input: 'x', version: '1', variants, ...extra } })
  r = uit(ref('banana', [{ transmitted: '{"a":1}', reference_hash: bytedigest('{"a":1}') }]))
  t('een onbekende verklaring slaagt nooit', r.outcome !== 'PASS', r.outcome)
  const d1 = '{"a":1,"b":2}', d2 = '{"x":9}'
  r = uit(ref('signed-content-identifier', [{ transmitted: d1, reference_hash: A }, { transmitted: d2, reference_hash: B }]))
  t('twee verschillende inhouden met elk een eigen verwijzing zijn geen instabiele verwijzing', r.outcome !== 'FAIL', r.outcome + '/' + r.reason_code)
  const { canonicalMembers, parseJsonStrict, bodyDigest: bd, decodeBody: db } = await import('../src/canonical-request.mjs')
  t('een verzoek zonder query en zonder lichaam laat die leden weg', JSON.stringify(canonicalMembers({ method: 'get', path: '/p' })) === '{"method":"GET","path":"/p"}')
  t('ISO-8859-1 geeft byte 0x80 als U+0080 en niet als het euroteken', db({ bodyBase64: Buffer.from([0x80]).toString('base64'), contentType: 'text/plain; charset=iso-8859-1' }) === '\u0080')
  t('een dubbele sleutel na het ontsnappen wordt gezien', parseJsonStrict('{"a":1,"\\u0061":2}').duplicate === true)
  t('een dubbele sleutel na een tekenreeks die op een backslash eindigt wordt gezien', parseJsonStrict('{"k\\\\":1,"a":1,"a":2}').duplicate === true)
  const dub = { bodyBase64: Buffer.from('{"a":1,"\\u0061":2}').toString('base64'), contentType: 'application/json' }
  t('JSON met een dubbele sleutel valt niet samen met het lichaam met alleen de laatste waarde', bd(dub) !== bd({ bodyBase64: Buffer.from('{"a":2}').toString('base64'), contentType: 'application/json' }))
  const proto = velddigest(JSON.parse('{"__proto__":{"x":1},"a":2}'))
  t('een sleutel met de naam __proto__ telt mee in het digest', proto !== velddigest({ a: 2 }))
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
  const SNAP = { method: 'POST', path: '/x', query: '', body: {}, payTo: '0x1', asset: '0x2', network: 'eip155:8453', amount: '1000', scheme: 'exact' }
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
  const overBytes = { signed_artifact_reference: { declared: 'captured-artifact-digest', input: 'the bytes as transmitted', version: '1', variants: [{ transmitted: stuk, reference_hash: bytedigest(stuk) }] } }
  const overVelden = { signed_artifact_reference: { declared: 'captured-artifact-digest', input: 'the bytes as transmitted', version: '1', variants: [{ transmitted: stuk, reference_hash: velddigest(JSON.parse(stuk)) }] } }
  t('een verwijzing over de verzonden bytes is goed', toetsPogingIdentiteit(overBytes).outcome === 'PASS')
  t(
    'dezelfde verwijzing over een gecanonicaliseerde vorm is fout',
    toetsPogingIdentiteit(overVelden).reason_code === 'REFERENCE_CANONICALIZED_BEFORE_HASHING',
  )
  t('en de controleur rekent beide kandidaten ZELF uit, dus een verkeerd label haalt het niet',
    toetsPogingIdentiteit({ signed_artifact_reference: { declared: 'captured-artifact-digest', input: 'the bytes as transmitted', version: '1', variants: [{ transmitted: stuk, reference_hash: 'f'.repeat(64) }] } }).reason_code === 'REFERENCE_HASH_UNEXPLAINED')

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
console.log('een gelijkwaardigheid die een vector beweert noemt haar grondslag')
{
  // Een vector die zegt dat twee verschillende verzoeken dezelfde aanvraag zijn, beweert dat geen enkele ontvanger ze uit elkaar kan houden.
  // Zo'n bewering moet haar grondslag noemen (een standaard of een meting), anders glipt een onbewezen gelijkwaardigheid er in.
  const dir = fileURLToPath(new URL('../vectors/attempt-identity/', import.meta.url))
  let aantal = 0
  const zonder = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(dir + f, 'utf8'))
    const v = j.input?.canonical_variants
    if (!Array.isArray(v) || j.expected?.outcome !== 'PASS') continue
    const raws = new Set(v.map((x) => JSON.stringify(x.raw)))
    const ids = new Set(v.map((x) => x.identity))
    if (raws.size > 1 && ids.size < raws.size) {
      aantal++
      if (typeof j.equivalence_basis !== 'string' || j.equivalence_basis.length < 60) zonder.push(f)
    }
  }
  t('minstens een vector beweert een gelijkwaardigheid', aantal >= 4)
  t('elke beweerde gelijkwaardigheid noemt haar grondslag' + (zonder.length ? ' (ontbreekt bij ' + zonder.join(', ') + ')' : ''), zonder.length === 0)
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
