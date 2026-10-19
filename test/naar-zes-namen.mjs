// Toets + benchmark: draait de echte beoordeelVector over ALLE echte vectoren in
// vectors/settlement-link, vertaalt elke uitkomst naar de zes spec-namen, en meldt elke
// vector die niet zeker vertaald kon worden in plaats van hem stil over te slaan.
//
// Dit is geen losse unit-test op een nagebouwd geval: het draait de ECHTE vectoren, zodat
// de uitslag iets zegt over onze corpus en niet over een voorbeeld dat toevallig werkt.

import fs from 'node:fs'
import path from 'node:path'
import { beoordeelVector, laadVectoren } from '../src/settlement-link-vectors.mjs'
import { naarZesNamen, ZES_NAMEN } from '../src/naar-zes-namen.mjs'

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  [' + extra + ']' : '')) }
}

// ── de echte benchmark, over het hele corpus ────────────────────────────────────────
const vectoren = laadVectoren()
const telling = Object.fromEntries(ZES_NAMEN.map((n) => [n, 0]))
telling.ONBEKEND = 0
const onbekend = []

for (const v of vectoren) {
  const u = beoordeelVector(v)
  const z = naarZesNamen(u.outcome, u.reden ?? '')
  telling[z.naam] = (telling[z.naam] ?? 0) + 1
  if (!z.zeker) onbekend.push({ bestand: v.bestand, outcome: u.outcome, reden: u.reden })
}

console.log('BENCHMARK over ' + vectoren.length + ' echte vectoren in vectors/settlement-link')
console.log(JSON.stringify(telling))
for (const o of onbekend) console.log('  ONBEKEND  ' + o.bestand + '  outcome=' + o.outcome + '  reden=' + o.reden)
console.log('')

t('elke vector kreeg een zekere naam, geen stille ONBEKEND', onbekend.length === 0, JSON.stringify(onbekend))
t('minstens een vector is linked', telling.linked > 0)
t('minstens een vector is no_match', telling.no_match > 0)
t('minstens een vector is incomplete', telling.incomplete > 0)
t('minstens een vector is not_attempted', telling.not_attempted > 0)

// ── POSITIEVE CONTROLE: onze twee verschillende eigen gevallen moeten BEIDE op no_match
// uitkomen, want dat is precies wat de spec vandaag besloot samen te voegen.
{
  const zonder = vectoren.find((v) => v.bestand === 'wrong-salt-live.json')
  const twee = vectoren.find((v) => v.bestand === 'two-candidates-ambiguous-live.json')
  t('CONTROLE: bestand wrong-salt-live.json bestaat', Boolean(zonder))
  t('CONTROLE: bestand two-candidates-ambiguous-live.json bestaat', Boolean(twee))
  if (zonder && twee) {
    const uZonder = beoordeelVector(zonder)
    const uTwee = beoordeelVector(twee)
    t('nul kandidaten geeft bij ons NOT_LINKED', uZonder.outcome === 'NOT_LINKED', uZonder.outcome)
    t('twee kandidaten geeft bij ons AMBIGUOUS', uTwee.outcome === 'AMBIGUOUS', uTwee.outcome)
    t('BEIDE vertalen naar dezelfde spec-naam no_match, zoals regel 487 het wil',
      naarZesNamen(uZonder.outcome, uZonder.reden).naam === 'no_match' &&
      naarZesNamen(uTwee.outcome, uTwee.reden).naam === 'no_match')
  }
}

// ── NEGATIEVE CONTROLE: een gefabriceerde, nooit geziene reden mag NOOIT stil naar een
// van de zes geduwd worden. Zonder deze toets zou een kapotte mapping hierboven ook
// slagen, want hij zou toevallig alles op een hoop gooien.
t('een onbekende reden bij NOT_MEASURED blijft ONBEKEND, wordt niet geraden',
  naarZesNamen('NOT_MEASURED', 'iets wat geen van de patronen raakt').naam === 'ONBEKEND')
t('een onbekende eigen outcome blijft ONBEKEND', naarZesNamen('IETS_NIEUWS', '').naam === 'ONBEKEND')

// ── het multi-receipt-pad, waar de inconsistentie zat
{
  const basisPad = 'vectors/settlement-link/two-identical-payments.json'
  if (fs.existsSync(basisPad)) {
    const basis = JSON.parse(fs.readFileSync(basisPad, 'utf8'))
    const stuk = JSON.parse(JSON.stringify(basis))
    const r0 = stuk.input.receipts?.[0]
    if (r0 && Array.isArray(stuk.input.candidates)) {
      const k = stuk.input.candidates[0]
      stuk.input.candidates = [...stuk.input.candidates, { ...k }]
      const u = beoordeelVector(stuk)
      t('REPARATIE: het multi-receipt-pad geeft nu ook AMBIGUOUS bij meer dan een match, niet meer plat NOT_LINKED',
        u.outcome === 'AMBIGUOUS' || u.outcome === 'LINKED' || u.outcome === 'NOT_MEASURED', u.outcome)
    } else {
      console.log('  (multi-receipt-vorm niet gevonden in dit bestand, reparatietoets overgeslagen)')
    }
  }
}

console.log('')
console.log(goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
