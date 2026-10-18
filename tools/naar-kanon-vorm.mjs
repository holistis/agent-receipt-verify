#!/usr/bin/env node
// Zet onze afrekening-vectoren om naar de vorm van de kanon-vectoren.
//
// WAAROM DIT BESTAAT, en het is een verzoek en geen eigen inval. De auteur van de
// kanon-vectoren schreef op 2026-10-17 in x402#3396: "if you want receipt-to-settlement
// vectors in Kanon's shape, I'm open to that, with the part that needs a chain read
// marked as such." Dit is dat, met die markering erin.
//
// WAT HIER WEL EN NIET VERTAALD KAN WORDEN, en dat tweede is het interessante deel.
// Zijn `expected` is `{ valid: boolean, reason_code: string }`. Twee van onze vier
// uitkomsten passen daar precies in. De andere twee niet, en dat is geen slordigheid
// van hem maar het gat dat hij in dezelfde reactie zelf benoemde en zei te willen
// dichten. Daarom laat dit script die twee gevallen ZICHTBAAR open staan in plaats van
// ze in `valid: false` te duwen:
//
//   LINKED       -> valid true,  reason_code LINKED
//   NOT_LINKED   -> valid false, reason_code NOT_LINKED
//   AMBIGUOUS    -> valid false, reason_code AMBIGUOUS
//   NOT_MEASURED -> GEEN valid. `measurable: false` plus een reason_code.
//
// Die laatste regel is het hele punt van de omzetting. Een bonnetje waarvan de
// kandidatenlijst niet opgehaald kon worden is NIET afgekeurd, en het in `valid: false`
// schrijven zou een eerlijke verkoper beschuldigen omdat onze RPC haperde. Liever een
// veld dat zijn validator nog niet kent dan een onwaarheid die hij wel kan lezen.
//
// EN DE GRENS VAN DEZE VERTALING, want die hoort erbij. Zijn corpus dekt de autorisatie
// van de KOPER voor de afrekening: geldigheidsvenster, malleability, domein-replay,
// nonce-hergebruik, bedrag. Dit corpus dekt de andere kant: opent het gezouten
// commitment in een ONDERTEKEND bonnetje op precies een afrekening op de keten. Die
// twee overlappen nergens, dus dit is een aanvulling en geen samenvoeging.
//
// Gebruik:
//   node tools/naar-kanon-vorm.mjs                 schrijft naar vectors/settlement-link-kanon
//   node tools/naar-kanon-vorm.mjs --controleer    schrijft niets, meldt alleen afwijkingen

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORTEL = fileURLToPath(new URL('..', import.meta.url))
export const BRONMAP = path.join(WORTEL, 'vectors', 'settlement-link')
export const DOELMAP = path.join(WORTEL, 'vectors', 'settlement-link-kanon')

/** Hun schema-versie, zoals die in elk van hun eigen vectoren staat. */
export const KANON_SCHEMA_VERSIE = '3.0.0'

/**
 * De vertaaltabel van onze uitkomst naar hun expected-blok.
 *
 * `valid` wordt met opzet WEGGELATEN bij NOT_MEASURED, niet op false gezet. Een
 * ontbrekend veld is voor een lezer een vraag; een false is een beschuldiging.
 */
export function naarExpected(onze) {
  const o = onze?.outcome
  if (o === 'LINKED') {
    return { valid: true, reason_code: 'LINKED' }
  }
  if (o === 'NOT_LINKED') {
    return { valid: false, reason_code: 'NOT_LINKED' }
  }
  if (o === 'AMBIGUOUS') {
    return { valid: false, reason_code: 'AMBIGUOUS' }
  }
  if (o === 'NOT_MEASURED') {
    return {
      measurable: false,
      reason_code: 'NOT_MEASURED',
      note:
        'Deliberately carries no `valid`. The candidate set could not be obtained, so this says ' +
        'nothing about the receipt. Writing valid:false here would blame an honest seller for a ' +
        'failed chain read. This is the third-outcome gap discussed in x402#3396.',
    }
  }
  return null
}

/** Zet een van onze vectoren om. Geeft null terug als de uitkomst niet te vertalen is. */
export function zetOm(v) {
  const expected = naarExpected(v.expected)
  if (!expected) return null
  const uit = {
    id: v.id,
    schema_version: KANON_SCHEMA_VERSIE,
    protocol: v.protocol ?? 'x402',
    scheme: v.scheme ?? 'exact',
    network: v.network,
    asset_transfer_method: v.asset_transfer_method ?? 'eip3009',
    // Een eigen veld, en het staat er omdat hun corpus deze as niet heeft. Hun vectoren
    // gaan allemaal over de autorisatie VOOR de afrekening; deze gaan over het bonnetje
    // NA de afrekening. Zonder dit veld zou een lezer de twee verzamelingen door elkaar
    // halen zodra ze in een map staan.
    verifies: 'receipt-to-settlement',
    encodes: v.encodes,
    provenance: v.provenance,
    description: v.description,
    // DE MARKERING DIE ERO M GEVRAAGD WERD. Hun schema heeft dit veld niet, dus het is
    // additief: een loper die het niet kent negeert het en draait de vector gewoon, een
    // loper die het wel kent weet dat er een RPC nodig is.
    ...(v.requires_chain_read ? { requires_chain_read: true } : {}),
    input: v.input,
    ...(v.context ? { context: v.context } : {}),
    expected,
  }
  return uit
}

export function laadBron(map = BRONMAP) {
  if (!fs.existsSync(map)) return []
  return fs.readdirSync(map).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ bestand: f, inhoud: JSON.parse(fs.readFileSync(path.join(map, f), 'utf8')) }))
}

const ditBestand = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ditBestand)) {
  const alleenControleren = process.argv.includes('--controleer')
  const bron = laadBron()
  if (!bron.length) {
    console.error('no vectors found in vectors/settlement-link')
    process.exit(1)
  }

  if (!alleenControleren) fs.mkdirSync(DOELMAP, { recursive: true })

  let geschreven = 0
  let ongewijzigd = 0
  let afwijkend = 0
  let nietTeVertalen = 0
  const telling = {}

  for (const { bestand, inhoud } of bron) {
    const om = zetOm(inhoud)
    if (!om) {
      nietTeVertalen++
      console.log('  SKIP  ' + bestand + '  (outcome ' + String(inhoud?.expected?.outcome) + ' has no translation)')
      continue
    }
    const code = om.expected.reason_code
    telling[code] = (telling[code] ?? 0) + 1
    const doel = path.join(DOELMAP, bestand)
    const tekst = JSON.stringify(om, null, 2) + '\n'
    if (alleenControleren) {
      const bestaat = fs.existsSync(doel) ? fs.readFileSync(doel, 'utf8') : null
      if (bestaat === tekst) ongewijzigd++
      else { afwijkend++; console.log('  DIFFERS  ' + bestand + (bestaat === null ? '  (missing)' : '')) }
      continue
    }
    fs.writeFileSync(doel, tekst)
    geschreven++
  }

  console.log('')
  if (alleenControleren) {
    console.log(ongewijzigd + ' up to date, ' + afwijkend + ' differ, ' + nietTeVertalen + ' untranslatable')
    process.exitCode = afwijkend === 0 ? 0 : 1
  } else {
    console.log(geschreven + ' vectors written to vectors/settlement-link-kanon')
  }
  console.log('')
  console.log('reason codes used:')
  for (const [k, v] of Object.entries(telling).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + String(v).padStart(3) + '  ' + k)
  }
  const ketenLees = bron.filter((b) => b.inhoud.requires_chain_read).length
  console.log('')
  console.log(ketenLees + ' of ' + bron.length + ' carry requires_chain_read:true, so a runner knows to expect an RPC.')
  console.log('')
  console.log('One honest note about the translation, and it is the reason this exists:')
  console.log('Kanon expected is valid plus a reason_code. LINKED, NOT_LINKED and AMBIGUOUS map')
  console.log('onto that cleanly. NOT_MEASURED does not, so those files carry measurable:false')
  console.log('and no valid at all, rather than a valid:false that would read as a verdict about')
  console.log('a seller when the truth is that our own chain read did not happen.')
}
