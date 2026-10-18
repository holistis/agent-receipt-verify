#!/usr/bin/env node
// Bouwt testvectoren voor de helft NA het betalen: hoort dit bonnetje bij die ene
// afrekening?
//
// WAAROM DEZE ER ZIJN. De gepubliceerde vectoren van iamonuwa/kanon dekken de
// AUTORISATIE van een koper voor de afrekening. Niemand heeft vectoren gepubliceerd
// voor de stap erna. In x402#3396 zei de auteur van die vectoren op 2026-10-17
// letterlijk: "if you want receipt-to-settlement vectors in Kanon's shape, I'm open to
// that, with the part that needs a chain read marked as such." Dit bestand maakt
// precies dat, in zijn vorm, met dat veld.
//
// DE SPLITSING DIE HIJ VROEG, en die is inhoudelijk het hele punt. Een bonnetje aan een
// afrekening binden bestaat uit twee stappen met heel verschillende eisen:
//
//   1. VIND de kandidaat-nonces die deze betaler in dit venster verbruikte.
//      Dat vereist een ketenlezing. Niet reproduceerbaar zonder RPC, en de uitkomst
//      hangt af van hoe ver je terugkijkt.
//   2. OPEN het commitment op precies een van die kandidaten.
//      Dat is pure rekenkunde: sha256 over tag, methode, asset, autorisator,
//      identifier en zout. Offline, deterministisch, en voor altijd reproduceerbaar.
//
// Stap 2 is waar de spec iets beweert, en stap 2 heeft GEEN keten nodig zodra je de
// kandidaten meegeeft. Daarom draagt elke vector hier `requires_chain_read`, en zijn de
// offline vectoren degene waar een vreemde iets aan heeft.
//
// ALLE DATA IS ECHT. De bonnetjes komen uit echte betalingen op Base Sepolia aan
// https://api.tokenizen.nl/api/paid/verify-ownership. De nonces en transactiehashes
// zijn door onze eigen linker op de keten gevonden. Koper en verkoper zijn allebei wij,
// dus dit bewijst dat de keten sluit, niet dat iemand anders hem gebruikt.
//
// DEZE GENERATOR WEIGERT TE LIEGEN. Voor elke positieve vector wordt het commitment
// opnieuw berekend uit de losse velden en vergeleken met wat in het ondertekende
// bonnetje staat. Klopt dat niet, dan schrijft hij niets en faalt hij luid. Een
// vectorbestand dat zichzelf niet opent is erger dan geen vectorbestand, want iedereen
// die het gebruikt bouwt op een fout.
//
// Gebruik: node tools/bouw-afrekening-vectoren.mjs [--droog]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { berekenCommitment } from '../src/x402-offer-receipt.mjs'

const WORTEL = fileURLToPath(new URL('..', import.meta.url))
const UIT = path.join(WORTEL, 'vectors', 'settlement-link')

// De drie echte betalingen, met de afrekening die onze linker op de keten vond.
// De nonce staat hier NIET omdat wij hem kozen, maar omdat hij gevonden is; de
// controle hieronder bewijst dat hij bij dit bonnetje hoort.
const ECHT = [
  {
    bestand: 'receipt-live-base-sepolia.json',
    nonce: '0x1120412c78ea1b2e8bf9eacfc3264c71a23ecd9b1fa579eb16030693344d5dfe',
    tx: '0xed87b09bfb20a8c8b69908e163fcea6432d193d389640c0465afcb5561dfeb30',
    kandidaten: 2,
  },
  {
    bestand: 'receipt-live-base-sepolia-2.json',
    nonce: '0x515895dfac6f148a4cfdf5c4f8266b7859dbd6534cdf77104b1be9f484eb5005',
    tx: '0x2898d0ceb97ddf60af98e19c94fc0adddbdf1e64f9032e62454085e37acfe36b',
    kandidaten: 3,
  },
  {
    bestand: 'receipt-live-base-sepolia-3.json',
    nonce: '0x4b133bbec3ce0d8177a9010784faedb459f04384b45316bb526a5f96c90a70de',
    tx: '0x2a9e95d63a5af8210767baa69143b364dad51caffc29a152c77e03bc508d7199',
    kandidaten: 2,
  },
]

const lees = (b) => JSON.parse(fs.readFileSync(path.join(WORTEL, 'examples', b), 'utf8'))

function basis(id, beschrijving, encodes) {
  return {
    id,
    schema_version: '3.0.0',
    protocol: 'x402',
    scheme: 'exact',
    network: 'eip155:84532',
    asset_transfer_method: 'eip3009',
    encodes,
    provenance: [
      'x402 offer-receipt extension section 5.6.4, as proposed in pull request 3827 at commit 0e492d6 and not on main',
      'EIP-3009',
    ],
    description: beschrijving,
  }
}

const vectoren = []
const fouten = []

for (const e of ECHT) {
  const bron = lees(e.bestand)
  const p = bron.receipt.payload
  const betaler = p.payer

  // DE CONTROLE DIE DEZE GENERATOR EERLIJK HOUDT. Herbereken het commitment uit de
  // losse velden. Opent het niet op de nonce die wij hier opschrijven, dan is onze
  // toewijzing fout en mag er niets geschreven worden.
  const herberekend = berekenCommitment({
    method: 'eip3009',
    asset: bron.asset,
    authorizer: betaler,
    identifier: e.nonce,
    salt: bron.authorizationSalt,
  })
  if (String(herberekend).toLowerCase() !== String(p.authorizationCommitment).toLowerCase()) {
    fouten.push(`${e.bestand}: het commitment opent NIET op de opgegeven nonce. ` +
      `berekend ${herberekend}, in het bonnetje ${p.authorizationCommitment}`)
    continue
  }

  const kort = e.bestand.replace('receipt-live-base-sepolia', 'live').replace('.json', '')

  // 1. De offline positieve: de kandidaten zijn MEEGEGEVEN, dus geen keten nodig.
  vectoren.push({
    ...basis(
      `x402-evm-settlement-link-opens-${kort}`,
      'A version 2 receipt whose authorizationCommitment opens on exactly one of the candidate nonces supplied with it. No chain access is needed because the candidates are given; this is the arithmetic half of section 5.6.4.',
      'Receipt-to-settlement binding verified offline against a supplied candidate set.',
    ),
    requires_chain_read: false,
    input: {
      receipt: bron.receipt,
      authorizationSalt: bron.authorizationSalt,
      asset: bron.asset,
      candidates: [{ authorizer: betaler, nonce: e.nonce }],
    },
    context: {
      note: 'Real payment on Base Sepolia to https://api.tokenizen.nl/api/paid/verify-ownership. Buyer and seller are the same party, which proves the chain closes end to end and nothing about adoption.',
      settlement_transaction: e.tx,
    },
    expected: { linked: true, outcome: 'LINKED', identifier: e.nonce },
  })

  // 2. De offline negatieve die het meest zegt: het zout van een ANDER bonnetje.
  //    Dit is waar de hele constructie op rust, want zonder het zout zouden twee
  //    identieke betalingen niet uit elkaar te houden zijn.
  const ander = ECHT.find((x) => x.bestand !== e.bestand)
  const anderBron = lees(ander.bestand)
  vectoren.push({
    ...basis(
      `x402-evm-settlement-link-wrong-salt-${kort}`,
      'The same receipt and the same candidate, but the salt of a different payment. The commitment must not open. This is the case the whole construction rests on: without the salt, two payments with identical terms could not be told apart.',
      'A salt that belongs to another payment must not open this commitment.',
    ),
    requires_chain_read: false,
    input: {
      receipt: bron.receipt,
      authorizationSalt: anderBron.authorizationSalt,
      asset: bron.asset,
      candidates: [{ authorizer: betaler, nonce: e.nonce }],
    },
    context: { note: 'Both salts are real and come from two separate payments with identical terms.' },
    expected: { linked: false, outcome: 'NOT_LINKED' },
  })

  // 3. De offline negatieve met de nonce van een andere betaling.
  vectoren.push({
    ...basis(
      `x402-evm-settlement-link-wrong-nonce-${kort}`,
      'The correct receipt and salt, but a candidate nonce that belongs to a different settlement by the same payer. The commitment must not open on it.',
      'A candidate that is not this payment must not satisfy the commitment.',
    ),
    requires_chain_read: false,
    input: {
      receipt: bron.receipt,
      authorizationSalt: bron.authorizationSalt,
      asset: bron.asset,
      candidates: [{ authorizer: betaler, nonce: ander.nonce }],
    },
    context: { note: 'Both nonces were really consumed by this payer; only one belongs to this receipt.' },
    expected: { linked: false, outcome: 'NOT_LINKED' },
  })
}

// 4. De vector die de twee identieke betalingen naast elkaar zet. Dit is het geval dat
//    een lezer overtuigt, want hier zijn de voorwaarden letterlijk gelijk.
if (ECHT.length >= 2 && fouten.length === 0) {
  const a = lees(ECHT[0].bestand)
  const b = lees(ECHT[1].bestand)
  vectoren.push({
    ...basis(
      'x402-evm-settlement-link-two-identical-payments',
      'Two payments with identical terms (same payer, same asset, same amount, same resource) each open on their own settlement and on no other. Given both candidate sets together, each receipt selects exactly one.',
      'Disambiguation of two otherwise indistinguishable payments.',
    ),
    requires_chain_read: false,
    input: {
      receipts: [
        { receipt: a.receipt, authorizationSalt: a.authorizationSalt, asset: a.asset },
        { receipt: b.receipt, authorizationSalt: b.authorizationSalt, asset: b.asset },
      ],
      candidates: [
        { authorizer: a.receipt.payload.payer, nonce: ECHT[0].nonce },
        { authorizer: b.receipt.payload.payer, nonce: ECHT[1].nonce },
      ],
    },
    context: {
      note: 'Both are real payments on Base Sepolia with the same terms. Without the salt these two could not be told apart by any later reader.',
      settlements: [ECHT[0].tx, ECHT[1].tx],
    },
    expected: {
      linked: true,
      outcome: 'LINKED',
      mapping: [
        { receipt_index: 0, identifier: ECHT[0].nonce },
        { receipt_index: 1, identifier: ECHT[1].nonce },
      ],
    },
  })
}

// 5. De uitkomst die kanon nog niet kent, en die wij juist wel nodig hebben: een
//    controle die NIET KON DRAAIEN is geen afkeuring. Dit vector beschrijft dat geval
//    zonder een keten nodig te hebben: er zijn geen kandidaten verkregen.
vectoren.push({
  ...basis(
    'x402-evm-settlement-link-no-candidates-not-measured',
    'No candidate set could be obtained, for example because no chain access was available or the lookup window produced nothing. The correct answer is NOT_MEASURED and explicitly not NOT_LINKED: a check that could not run is not a receipt that fails. This is the third outcome a two-valued vocabulary cannot express.',
    'An incomplete check must be distinguishable from a failed one.',
  ),
  requires_chain_read: false,
  input: {
    receipt: lees(ECHT[0].bestand).receipt,
    authorizationSalt: lees(ECHT[0].bestand).authorizationSalt,
    asset: lees(ECHT[0].bestand).asset,
    candidates: null,
  },
  context: { note: 'candidates is null rather than an empty list, and the two mean different things: null is "we did not obtain a list", empty is "we obtained a list and it was empty".' },
  expected: { linked: null, outcome: 'NOT_MEASURED' },
})

// 6. En het geval dat wel een keten nodig heeft, expliciet als zodanig gemarkeerd.
vectoren.push({
  ...basis(
    'x402-evm-settlement-link-find-candidates-onchain',
    'The full section 5.6.4 walk, starting from only the receipt, the salt and the asset: find the nonces this payer consumed in a window, then open the commitment on exactly one. Requires an archive-capable RPC for Base Sepolia. Included so the chain-dependent half is named rather than hidden, but a runner without RPC access should skip it and report that, not fail it.',
    'The chain-reading half of the walk, marked as such.',
  ),
  requires_chain_read: true,
  input: {
    receipt: lees(ECHT[0].bestand).receipt,
    authorizationSalt: lees(ECHT[0].bestand).authorizationSalt,
    asset: lees(ECHT[0].bestand).asset,
  },
  context: {
    rpc: 'any Base Sepolia endpoint that serves eth_getLogs over the window around the receipt issuedAt',
    expected_candidate_count: ECHT[0].kandidaten,
    note: 'The candidate count is what the window actually produced on 2026-10-18 and will grow as this payer makes more payments; a runner should assert "exactly one opens", not the count.',
  },
  expected: { linked: true, outcome: 'LINKED', identifier: ECHT[0].nonce, settlement_transaction: ECHT[0].tx },
})

if (fouten.length) {
  console.error('GEEN ENKELE VECTOR GESCHREVEN. De controle faalde:')
  for (const f of fouten) console.error('  ' + f)
  process.exitCode = 1
} else {
  const droog = process.argv.includes('--droog')
  if (!droog) {
    fs.mkdirSync(UIT, { recursive: true })
    for (const v of vectoren) {
      fs.writeFileSync(path.join(UIT, v.id.replace('x402-evm-settlement-link-', '') + '.json'), JSON.stringify(v, null, 2) + '\n')
    }
  }
  const offline = vectoren.filter((v) => !v.requires_chain_read).length
  console.log(`${vectoren.length} vectoren${droog ? ' (droog, niets geschreven)' : ' geschreven naar vectors/settlement-link/'}`)
  console.log(`  offline, zonder keten te lezen : ${offline}`)
  console.log(`  met ketenlezing, gemarkeerd    : ${vectoren.length - offline}`)
  console.log(`  elk commitment opnieuw berekend en gelijk bevonden aan het ondertekende bonnetje`)
}
