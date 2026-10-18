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
export function beoordeelVector(v) {
  if (v.requires_chain_read) return { outcome: 'SKIPPED', reden: 'requires an RPC; run the link command for this one' }

  // Het geval met twee bonnetjes tegelijk: elk moet op zijn eigen kandidaat openen en
  // op geen enkele andere.
  if (Array.isArray(v.input?.receipts)) {
    const kandidaten = v.input.candidates ?? []
    const mapping = []
    for (const [i, r] of v.input.receipts.entries()) {
      const p = r.receipt.payload
      const passend = kandidaten.filter((k) =>
        String(berekenCommitment({
          method: p.authorizationMethod ?? 'eip3009',
          asset: r.asset,
          authorizer: k.authorizer,
          identifier: k.nonce,
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

  const passend = kandidaten.filter((k) =>
    String(berekenCommitment({
      method: p.authorizationMethod ?? 'eip3009',
      asset: v.input.asset,
      authorizer: k.authorizer,
      identifier: k.nonce,
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
      const ok = u.outcome === v.expected.outcome
      if (ok) goed++; else fout++
      console.log(`  ${ok ? 'pass' : 'FAIL'}  ${v.id}`)
      console.log(`        expected ${v.expected.outcome}, got ${u.outcome}${u.reden ? ' (' + u.reden + ')' : ''}`)
    }
    console.log('')
    console.log(`${goed} agree, ${fout} disagree, ${overgeslagen} skipped because they need an RPC`)
    console.log('')
    console.log('Every positive case here was re-derived from the signed receipt, not copied:')
    console.log('the commitment is recomputed from tag, method, asset, authorizer, identifier and')
    console.log('salt, and compared against what the seller actually signed.')
    process.exitCode = fout === 0 ? 0 : 1
  }
}
