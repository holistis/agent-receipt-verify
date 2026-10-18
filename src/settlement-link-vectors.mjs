#!/usr/bin/env node
// Draait de afrekening-vectoren: hoort dit bonnetje bij die ene betaling?
//
// WAAROM DIT EEN LOPER IS EN NIET EEN DOCUMENT. Een vectorbestand dat niemand kan
// draaien is een bewering met extra stappen. Dit commando leest de vectoren, rekent elk
// commitment opnieuw uit, en vergelijkt dat met wat er verwacht wordt. Een vreemde
// draait het zonder account, zonder sleutel, en voor elf van de twaalf gevallen ook
// zonder internet.
//
// DE DRIE UITKOMSTEN, en de derde is het hele punt. LINKED als het commitment op
// precies een kandidaat opent. NOT_LINKED als er kandidaten waren en geen enkele opent.
// NOT_MEASURED als er geen kandidatenlijst is VERKREGEN. Dat laatste is geen afkeuring
// van het bonnetje maar een onvolledige controle, en een woordenlijst met twee waarden
// kan dat verschil niet uitdrukken. Precies dat gat benoemde de auteur van de
// kanon-vectoren op 2026-10-17 als iets dat hij wil toevoegen.
//
// LET OP HET VERSCHIL TUSSEN LEEG EN AFWEZIG. `candidates: null` betekent dat er geen
// lijst is opgehaald, `candidates: []` dat er wel een lijst is en die leeg was. Het
// eerste is NOT_MEASURED, het tweede NOT_LINKED. Een loper die die twee door elkaar
// haalt, gooit geldige bonnetjes weg bij een haperende RPC.
//
// Gebruik:
//   node src/settlement-link-vectors.mjs            de offline vectoren
//   npx agent-receipt-verify link-vectors           hetzelfde, als commando

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { berekenCommitment } from './x402-offer-receipt.mjs'

const WORTEL = fileURLToPath(new URL('..', import.meta.url))
export const VECTORMAP = path.join(WORTEL, 'vectors', 'settlement-link')

/**
 * Beoordeel een enkele vector, puur rekenkundig.
 *
 * Geeft altijd een `outcome` terug uit de drie, nooit een throw voor een gewone
 * uitkomst: een verifieerder die bij een ongeldig bonnetje crasht, is zelf de storing.
 */
/**
 * Een commitment berekenen zonder dat een kapot veld de hele ronde omver trekt.
 *
 * WAAROM DIT BESTAAT. De koptekst van dit bestand belooft dat deze loper nooit gooit
 * voor een gewone uitkomst, want een verifieerder die bij een ongeldig bonnetje crasht
 * is zelf de storing. De aanroepen stonden toch kaal in een filter, dus EEN vector met
 * een veld van de verkeerde lengte brak de ronde af voordat ook maar een andere vector
 * beoordeeld was. Een niet-berekenbare kandidaat is geen treffer, en dat is hier de
 * juiste en enige betekenis.
 */
function veiligCommitment(velden) {
  try {
    return berekenCommitment(velden)
  } catch {
    return '0x-niet-te-berekenen'
  }
}

export function beoordeelVector(v) {
  if (v.requires_chain_read) return { outcome: 'SKIPPED', reden: 'requires an RPC; run the link command for this one' }

  // Het geval met twee bonnetjes tegelijk: elk moet op zijn eigen kandidaat openen en
  // op geen enkele andere.
  if (Array.isArray(v.input?.receipts)) {
    // GEEN `?? []` HIER. Dat stond er en het maakte van een ONTBREKENDE lijst een LEGE
    // lijst, dus van NOT_MEASURED een NOT_LINKED. De koptekst van dit bestand noemt dat
    // zelf de ergste fout die deze loper kan maken, want dan beschuldigt hij een
    // eerlijke verkoper omdat de keten even niet te lezen was.
    if (v.input.candidates == null) {
      return { outcome: 'NOT_MEASURED', reden: 'no candidate set was obtained' }
    }
    if (!Array.isArray(v.input.candidates)) {
      return { outcome: 'NOT_MEASURED', reden: 'the candidate set is not a list' }
    }
    const kandidaten = v.input.candidates
    const mapping = []
    for (const [i, r] of v.input.receipts.entries()) {
      const p = r?.receipt?.payload
      if (!p) return { outcome: 'NOT_MEASURED', reden: `receipt ${i} has no payload` }
      if (!p.authorizationCommitment) {
        return { outcome: 'NOT_MEASURED', reden: `receipt ${i} carries no commitment` }
      }
      const passend = kandidaten.filter((k) =>
        String(veiligCommitment({
          method: p.authorizationMethod ?? 'eip3009',
          asset: r.asset,
          authorizer: k?.authorizer,
          identifier: k?.nonce,
          salt: r.authorizationSalt,
        })).toLowerCase() === String(p.authorizationCommitment).toLowerCase())
      if (passend.length !== 1) {
        return { outcome: 'NOT_LINKED', reden: `receipt ${i} opened on ${passend.length} candidates, expected exactly one` }
      }
      mapping.push({ receipt_index: i, identifier: passend[0].nonce })
    }
    return { outcome: 'LINKED', mapping }
  }

  const p = v.input?.receipt?.payload
  if (!p) return { outcome: 'NOT_MEASURED', reden: 'no receipt payload in the vector' }
  if (!p.authorizationCommitment) {
    // Een bonnetje van versie 1 draagt geen commitment. Dat is geen fout van het
    // bonnetje en ook geen afkeuring, er valt alleen niets te openen.
    return { outcome: 'NOT_MEASURED', reden: 'receipt is version 1 and carries no commitment' }
  }

  const kandidaten = v.input.candidates
  if (kandidaten == null) return { outcome: 'NOT_MEASURED', reden: 'no candidate set was obtained' }
  // Een lijst die geen lijst is, is ook geen meting. Zonder deze regel gooide .filter
  // en ging de hele ronde eraan.
  if (!Array.isArray(kandidaten)) return { outcome: 'NOT_MEASURED', reden: 'the candidate set is not a list' }

  const passend = kandidaten.filter((k) =>
    String(veiligCommitment({
      method: p.authorizationMethod ?? 'eip3009',
      asset: v.input.asset,
      authorizer: k?.authorizer,
      identifier: k?.nonce,
      salt: v.input.authorizationSalt,
    })).toLowerCase() === String(p.authorizationCommitment).toLowerCase())

  if (passend.length === 1) return { outcome: 'LINKED', identifier: passend[0].nonce }
  if (passend.length === 0) return { outcome: 'NOT_LINKED', reden: `none of ${kandidaten.length} candidates opened the commitment` }
  return { outcome: 'AMBIGUOUS', reden: `${passend.length} candidates opened the same commitment, which a random 32 byte salt should make practically impossible` }
}

export function laadVectoren(map = VECTORMAP) {
  if (!fs.existsSync(map)) return []
  return fs.readdirSync(map).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ bestand: f, ...JSON.parse(fs.readFileSync(path.join(map, f), 'utf8')) }))
}

const ditBestand = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ditBestand)) {
  const vectoren = laadVectoren()
  if (!vectoren.length) {
    console.error('no vectors found in vectors/settlement-link')
    process.exitCode = 1
  } else {
    console.log('settlement-link vectors: does this receipt belong to that one payment?')
    console.log('')
    let goed = 0, fout = 0, overgeslagen = 0
    for (const v of vectoren) {
      const u = beoordeelVector(v)
      if (u.outcome === 'SKIPPED') {
        overgeslagen++
        console.log(`  skip  ${v.id}`)
        console.log(`        ${u.reden}`)
        continue
      }
      // Een vector zonder verwachting is een kapotte vector, geen reden om de hele
      // ronde af te breken. Zonder deze regel gooide dit een TypeError en werd geen
      // enkele andere vector meer beoordeeld, ook de twaalf goede niet.
      if (!v.expected || typeof v.expected.outcome !== 'string') {
        fout++
        console.log(`  FAIL  ${v.id ?? v.bestand}`)
        console.log('        this vector carries no expected outcome, so it cannot be judged')
        continue
      }
      const ok = u.outcome === v.expected.outcome
      if (ok) goed++; else fout++
      console.log(`  ${ok ? 'pass' : 'FAIL'}  ${v.id}`)
      console.log(`        expected ${v.expected.outcome}, got ${u.outcome}${u.reden ? ' (' + u.reden + ')' : ''}`)
    }
    console.log('')
    console.log(`${goed} agree, ${fout} disagree, ${overgeslagen} skipped because they need an RPC`)
    console.log('')
    console.log('Every positive case here was re-derived, not copied: the commitment is recomputed')
    console.log('from tag, method, asset, authorizer, identifier and salt, and compared against the')
    console.log('authorizationCommitment field carried in the receipt.')
    console.log('')
    console.log('What this command does NOT do: it does not check the signature over that receipt.')
    console.log('So this answers "does this commitment open on that settlement", not "is this')
    console.log('receipt genuine". For the signature, run the conformance check on the endpoint.')
    process.exitCode = fout === 0 ? 0 : 1
  }
}
