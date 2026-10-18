// Test voor de binding tussen bonnetje en acceptatierecord.
//
// De gevallen gaan over de vier manieren waarop juist deze koppeling scheef gaat:
//  1. twee bewijsstukken die netjes ondertekend zijn maar over een ander bestand gaan.
//  2. een record waarvan de controleur ook de producent is, dus zelfbeoordeling.
//  3. criteria die pas na de toets zijn vastgelegd, dus achteraf naar de uitslag geschreven.
//  4. een ontbrekend veld dat als afkeuring wordt gelezen in plaats van als niet gemeten.
//
// En de belangrijkste van allemaal staat als eerste: de POSITIEVE controle. Een set die
// alleen maar afkeuringen bevat bewijst niet dat het harnas werkt, alleen dat het nee zegt.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { koppelAcceptatie, recordTelt, bindingMeetbaar } from '../src/acceptance-binding.mjs'

const hier = path.dirname(fileURLToPath(import.meta.url))
const vectorMap = path.join(hier, '..', 'vectors', 'acceptance-binding')

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

// ── de vectoren op schijf, zoals een vreemde ze zou draaien ──────────────────
{
  const bestanden = fs.readdirSync(vectorMap).filter((f) => f.endsWith('.json')).sort()
  t('er staan vectoren op schijf', bestanden.length >= 2, 'gevonden: ' + bestanden.length)

  let positief = 0
  for (const b of bestanden) {
    const v = JSON.parse(fs.readFileSync(path.join(vectorMap, b), 'utf8'))
    t(b + ' heeft een id', typeof v.id === 'string' && v.id.length > 0)
    t(b + ' zegt wat het verifieert', v.verifies === 'receipt-to-acceptance')
    t(b + ' noemt zijn grenzen', Array.isArray(v.limits) && v.limits.length > 0)

    const uit = koppelAcceptatie(v.input)
    t(b + ' geeft de verwachte geldigheid', uit.valid === v.expected.valid, JSON.stringify(uit))
    t(b + ' geeft de verwachte code', uit.reason_code === v.expected.reason_code, JSON.stringify(uit))
    if (v.expected.detail) {
      t(b + ' geeft het verwachte detail', uit.detail === v.expected.detail, JSON.stringify(uit))
    }
    if (v.expected.valid === true) positief++
  }
  t('de set heeft een positieve controle', positief >= 1, 'positieve gevallen: ' + positief)
}

// ── de twee voorwaarden van de uitgever zelf ─────────────────────────────────
{
  const basis = {
    deliverable_sha256: 'a'.repeat(64),
    checker: 'controleur-1',
    producer: 'producent-1',
    criteria_committed_at: '2026-10-18T00:52:03Z',
    checked_at: '2026-10-18T00:52:09Z',
  }
  t('een onafhankelijke controleur telt', recordTelt(basis).telt === true)

  const zelf = { ...basis, checker: 'Producent-1', producer: 'producent-1' }
  t('zelfbeoordeling telt niet, ook met andere hoofdletters',
    recordTelt(zelf).telt === false && recordTelt(zelf).reden === 'CHECKER_IS_PRODUCER')

  const achteraf = { ...basis, criteria_committed_at: '2026-10-18T00:52:09Z', checked_at: '2026-10-18T00:52:03Z' }
  t('criteria na de toets tellen niet',
    recordTelt(achteraf).reden === 'CRITERIA_NOT_COMMITTED_FIRST')

  const gelijk = { ...basis, criteria_committed_at: '2026-10-18T00:52:09Z', checked_at: '2026-10-18T00:52:09Z' }
  t('criteria op exact hetzelfde moment tellen ook niet',
    recordTelt(gelijk).reden === 'CRITERIA_NOT_COMMITTED_FIRST')

  const zonderTijd = { ...basis, checked_at: 'ergens vanochtend' }
  t('een onleesbaar tijdstip is onbekend, geen stil akkoord',
    recordTelt(zonderTijd).reden === 'CRITERIA_TIMING_UNKNOWN')
}

// ── ontbrekende velden zijn NIET GEMETEN, nooit NIET GEKOPPELD ───────────────
{
  const uit = koppelAcceptatie({ receipt: {}, acceptance: {}, bindings: {} })
  t('een leeg geval is niet gemeten', uit.reason_code === 'NOT_MEASURED' && uit.measurable === false)
  t('en het zegt welk veld ontbreekt', Array.isArray(uit.missing) && uit.missing.length > 0)

  t('een niet-hash wordt niet als hash geaccepteerd',
    bindingMeetbaar({
      receipt: {}, acceptance: { deliverable_sha256: 'a'.repeat(64) },
      bindings: { receipt_sha256: '0x-niet-te-berekenen', deliverable_sha256: 'a'.repeat(64) },
    }).meetbaar === false)
}

// ── een afwijkende machtiging in de sidecar is erger dan geen ────────────────
{
  const gedeeld = {
    receipt: { authorizationNonce: '0x' + 'b'.repeat(64) },
    acceptance: {
      deliverable_sha256: 'c'.repeat(64),
      checker: 'controleur-1', producer: 'producent-1',
      criteria_committed_at: '2026-10-18T00:52:03Z', checked_at: '2026-10-18T00:52:09Z',
    },
    bindings: { receipt_sha256: 'd'.repeat(64), deliverable_sha256: 'c'.repeat(64) },
  }
  t('zonder machtiging in de sidecar koppelt het gewoon',
    koppelAcceptatie(gedeeld).reason_code === 'LINKED')

  const anders = { ...gedeeld, bindings: { ...gedeeld.bindings, authorization: '0x' + 'e'.repeat(64) } }
  t('met een andere machtiging koppelt het niet',
    koppelAcceptatie(anders).detail === 'AUTHORIZATION_MISMATCH')

  const zelfdeAnderGeschreven = {
    ...gedeeld,
    bindings: { ...gedeeld.bindings, authorization: 'B'.repeat(64) },
  }
  t('dezelfde machtiging anders geschreven koppelt wel',
    koppelAcceptatie(zelfdeAnderGeschreven).reason_code === 'LINKED')
}

// ── de sidecar moet ONS bonnetje noemen ──────────────────────────────────────
{
  const basis = {
    receipt: {},
    acceptance: {
      deliverable_sha256: 'c'.repeat(64),
      checker: 'controleur-1', producer: 'producent-1',
      criteria_committed_at: '2026-10-18T00:52:03Z', checked_at: '2026-10-18T00:52:09Z',
    },
    bindings: { receipt_sha256: 'd'.repeat(64), deliverable_sha256: 'c'.repeat(64) },
  }
  t('een sidecar die een ander bonnetje noemt koppelt niet',
    koppelAcceptatie({ ...basis, receiptSha256: 'f'.repeat(64) }).detail === 'RECEIPT_HASH_MISMATCH')
  t('en met het juiste bonnetje koppelt het wel',
    koppelAcceptatie({ ...basis, receiptSha256: 'd'.repeat(64) }).reason_code === 'LINKED')
}

console.log('')
console.log('acceptance-binding: ' + goed + ' pass, ' + fout + ' fail')
if (fout > 0) process.exitCode = 1
