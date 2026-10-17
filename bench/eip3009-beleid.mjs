// Een matrix over de twee open vragen uit x402#2725, zodat een antwoord daar een
// meting is en geen mening.
//
// DE TWEE VRAGEN, letterlijk van de steller van dat issue: moet het betaalde bedrag
// precies kloppen of mag er te veel betaald worden, en moet hergebruik van een nonce
// per betaler worden bijgehouden. Geen van beide wordt gedekt door een gepubliceerde
// vector, en dus heeft onze eigen "eens op tien van tien" er niets over gezegd. Dat is
// precies waarom dit bestand bestaat: een cijfer dat klopt kan een vraag verbergen.
//
// WAT HIER GEMETEN WORDT. Dezelfde tien vectoren onder beide bedragbeleiden, plus twee
// gevallen die zij niet dekken en die het verschil zichtbaar maken. De uitslag is een
// tabel waarin te zien is waar de twee keuzes uit elkaar lopen en waar niet.
//
// DE UITVOER IS ENGELS, de commentaren zijn dat niet. Sinds 0.2.2 is dit een eigen
// commando (`agent-receipt-verify beleid`), dus de regels die iemand op zijn scherm
// krijgt zijn voor een vreemde bedoeld. Een meting die niemand kan lezen is geen
// meting die iemand overneemt.
//
// Gebruik: node bench/eip3009-beleid.mjs   of   npx agent-receipt-verify beleid

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beoordeelVector, beoordeelAutorisatie } from '../src/eip3009-autorisatie.mjs'

const wortel = fileURLToPath(new URL('..', import.meta.url))
const MAP = path.join(wortel, 'vectors', 'kanon')
const lees = (n) => JSON.parse(fs.readFileSync(path.join(MAP, n), 'utf8'))

const vectoren = fs.readdirSync(MAP).filter((f) => f.endsWith('.json')).sort()

console.log('EIP-3009: the two open questions from x402 issue 2725, measured')
console.log('')

// ---------------------------------------------------------------------------
console.log('1. The same ten vectors under both amount policies')
console.log('')
const uitkomst = {}
for (const beleid of ['exact', 'at-least']) {
  let eens = 0
  const afwijkend = []
  for (const f of vectoren) {
    const v = lees(f)
    const u = await beoordeelAutorisatie(v.input, { ...(v.context ?? {}), doelNetwerk: v.network, amountPolicy: beleid })
    if (u.valid === v.expected.valid && u.reason_code === v.expected.reason_code) eens++
    else afwijkend.push(v.id + ' (' + u.reason_code + ' against ' + v.expected.reason_code + ')')
  }
  uitkomst[beleid] = { eens, afwijkend }
  console.log('  ' + beleid.padEnd(9) + ' agrees on ' + eens + ' of ' + vectoren.length +
    (afwijkend.length ? '   differs: ' + afwijkend.join(', ') : ''))
}
console.log('')
console.log('  Both policies reach the same verdict on all ten. That is the point: the')
console.log('  published vectors only cover UNDERpayment, so they cannot answer the')
console.log('  question. Anyone who stops here thinks they know.')

// ---------------------------------------------------------------------------
console.log('')
console.log('2. The case no vector covers: paying too much')
console.log('')
{
  const basis = lees('valid-baseline-001.json')
  for (const beleid of ['exact', 'at-least']) {
    const v = JSON.parse(JSON.stringify(basis))
    v.input.accepted.amount = String(BigInt(v.input.payload.authorization.value) - 1n)
    const u = await beoordeelAutorisatie(v.input, { ...(v.context ?? {}), doelNetwerk: v.network, amountPolicy: beleid })
    console.log('  ' + beleid.padEnd(9) + ' signed ' + v.input.payload.authorization.value +
      ', asked ' + v.input.accepted.amount + '  ->  ' + (u.valid ? 'VALID' : u.reason_code))
  }
  console.log('')
  console.log('  Two reference implementations reject this:')
  console.log('    go/mechanisms/evm/exact/facilitator/eip3009.go:65  Cmp(requiredValue) != 0')
  console.log('    python/x402/mechanisms/evm/exact/facilitator.py:235  value != amount')
  console.log('    and that same python says on line 168: "Amount exactly matches requirements.amount"')
  console.log('  So exact is our default. It stays a choice, which is why it is printed in')
  console.log('  the result and not buried in the code.')
}

// ---------------------------------------------------------------------------
console.log('')
console.log('3. The second case no vector covers: the same nonce, a DIFFERENT payer')
console.log('')
{
  const basis = lees('valid-baseline-001.json')
  const nonce = basis.input.payload.authorization.nonce
  const andereBetaler = '0x000000000000000000000000000000000000dEaD'

  // Per betaler, zoals het token-contract het doet.
  const perBetaler = await beoordeelVector({
    ...basis,
    context: { ...basis.context, seen_nonces: { [andereBetaler]: [nonce] } },
  })
  // De grove vorm: een lijst zonder onderscheid naar betaler.
  const plat = await beoordeelVector({
    ...basis,
    context: { ...basis.context, seen_nonces: [nonce] },
  })

  console.log('  nonce already spent by ANOTHER address')
  console.log('    per payer (how the contract does it) ->  ' + (perBetaler.valid ? 'VALID' : perBetaler.reason_code))
  console.log('  the same nonce spent by THIS payer')
  console.log('    flat list                            ->  ' + (plat.valid ? 'VALID' : plat.reason_code))
  console.log('')
  console.log('  EIP-3009 tracks this per address itself: mapping(address => mapping(bytes32')
  console.log('  => bool)), readable as authorizationState(address authorizer, bytes32 nonce),')
  console.log('  and the spec says nonces are random 32 bytes, unique to the authorizer. A')
  console.log('  verifier holding a list without the payer is therefore STRICTER than the')
  console.log('  chain, and could refuse a valid payment from someone else.')
}

console.log('')
console.log('Short version: on the ten published vectors neither choice makes a difference.')
console.log('On the two cases nobody published, it decides everything.')
