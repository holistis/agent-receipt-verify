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
 * Matcht deze kandidaat het commitment? Ja of nee, en nooit iets daartussenin.
 *
 * WAAROM DIT EEN BOOLEAN IS EN GEEN WAARDE. De eerste versie van deze reparatie gaf bij
 * een onberekenbaar veld de TEKENREEKS `0x-niet-te-berekenen` terug, en die werd daarna
 * vergeleken met het commitment uit het bonnetje. Een foutwaarde die in dezelfde ruimte
 * leeft als de echte waarde is geen foutwaarde maar een sleutel: een bonnetje dat
 * precies die tekst als commitment droeg, met een kandidaat die niet te berekenen was,
 * kwam er als GELINKT uit zonder dat er een byte cryptografie aan te pas kwam. Onze
 * eigen keuring heeft dat gedraaid, met en zonder hoofdletters, op beide takken van
 * beoordeelVector. Dat is precies de klasse fout die dit bestand moet uitsluiten, en hij
 * zat er een uur in.
 *
 * `null` teruggeven lost het NIET op, en dat is de reden dat hier een boolean staat:
 * `String(null)` is de tekenreeks "null", dus een bonnetje met commitment "null" zou
 * het gat meteen heropenen. De enige vorm die dicht is, is er niets uit laten komen dat
 * ooit vergeleken wordt. De vergelijking zelf hoort daarom HIER en nergens anders.
 *
 * En de oorspronkelijke reden blijft staan: een kapot veld mag de ronde niet omver
 * trekken. Een onberekenbare kandidaat is geen treffer. Dat is hier de enige betekenis.
 */
function kandidaatMatcht(velden, commitment) {
  if (typeof commitment !== 'string' || !commitment) return false
  let berekend
  try {
    berekend = berekenCommitment(velden)
  } catch {
    return false
  }
  // berekenCommitment geeft altijd een 0x-sha256 terug of gooit. Deze controle staat er
  // zodat een toekomstige wijziging daar nooit stil iets anders dan een hash kan laten
  // doorstromen naar een gelijkheidsvergelijking.
  if (typeof berekend !== 'string' || !/^0x[0-9a-f]{64}$/i.test(berekend)) return false
  return berekend.toLowerCase() === commitment.toLowerCase()
}

/**
 * Is dit een kandidaat waar uberhaupt iets mee te doen valt?
 *
 * Zonder deze zeef overleefde een `null` in de kandidatenlijst de filter (want
 * `k?.authorizer` is dan gewoon undefined), en als zo'n kandidaat dan matchte, knalde
 * `passend[0].nonce` met een TypeError. De koptekst van dit bestand belooft letterlijk
 * dat deze loper niet gooit voor een gewone uitkomst. Gemeten in de eigen keuring.
 */
function bruikbareKandidaat(k) {
  return Boolean(k) && typeof k === 'object' && typeof k.nonce === 'string' && typeof k.authorizer === 'string'
}

/**
 * Kunnen wij met ONZE eigen vaste velden uberhaupt een commitment uitrekenen?
 *
 * WAAROM DIT APART STAAT VAN DE KANDIDATEN. Een kapotte KANDIDAAT is geen treffer, en
 * dat is de juiste uitkomst. Een kapot EIGEN veld (een zout of een asset die onze RPC
 * verkeerd teruggaf) laat elke kandidaat falen, en dan rolt er een stellige "geen enkele
 * kandidaat opende dit commitment" uit terwijl de waarheid is dat er niets te berekenen
 * viel. De koptekst van dit bestand noemt dat zelf de ergste fout die deze loper kan
 * maken: een geldig bonnetje weggooien bij een haperende RPC.
 *
 * Deze controle zat al in opentCommitment, en niet hier. Dezelfde commit repareerde de
 * ene functie en liet de andere staan, en de eigen keuring heeft dat gemeten.
 */
function eigenVeldenMeetbaar({ method, asset, salt }) {
  try {
    berekenCommitment({ method, asset, authorizer: '0x' + '00'.repeat(20), identifier: '0x' + '00'.repeat(32), salt })
    return { ok: true }
  } catch (e) {
    return { ok: false, reden: 'cannot compute a commitment here: ' + String(e?.message ?? e).slice(0, 90) }
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
      const meetbaar = eigenVeldenMeetbaar({
        method: p.authorizationMethod ?? 'eip3009',
        asset: r.asset,
        salt: r.authorizationSalt,
      })
      if (!meetbaar.ok) return { outcome: 'NOT_MEASURED', reden: `receipt ${i}: ` + meetbaar.reden }
      const passend = kandidaten.filter(bruikbareKandidaat).filter((k) =>
        kandidaatMatcht({
          method: p.authorizationMethod ?? 'eip3009',
          asset: r.asset,
          authorizer: k.authorizer,
          identifier: k.nonce,
          salt: r.authorizationSalt,
        }, p.authorizationCommitment))
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

  const meetbaar = eigenVeldenMeetbaar({
    method: p.authorizationMethod ?? 'eip3009',
    asset: v.input.asset,
    salt: v.input.authorizationSalt,
  })
  if (!meetbaar.ok) return { outcome: 'NOT_MEASURED', reden: meetbaar.reden }

  const passend = kandidaten.filter(bruikbareKandidaat).filter((k) =>
    kandidaatMatcht({
      method: p.authorizationMethod ?? 'eip3009',
      asset: v.input.asset,
      authorizer: k.authorizer,
      identifier: k.nonce,
      salt: v.input.authorizationSalt,
    }, p.authorizationCommitment))

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
