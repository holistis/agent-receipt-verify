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
// Gebruik: node bench/eip3009-beleid.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beoordeelVector, beoordeelAutorisatie } from '../src/eip3009-autorisatie.mjs'

const wortel = fileURLToPath(new URL('..', import.meta.url))
const MAP = path.join(wortel, 'vectors', 'kanon')
const lees = (n) => JSON.parse(fs.readFileSync(path.join(MAP, n), 'utf8'))

const vectoren = fs.readdirSync(MAP).filter((f) => f.endsWith('.json')).sort()

console.log('EIP-3009, de twee open vragen uit x402#2725, gemeten')
console.log('')

// ---------------------------------------------------------------------------
console.log('1. Dezelfde tien vectoren onder beide bedragbeleiden')
console.log('')
const uitkomst = {}
for (const beleid of ['exact', 'at-least']) {
  let eens = 0
  const afwijkend = []
  for (const f of vectoren) {
    const v = lees(f)
    const u = await beoordeelAutorisatie(v.input, { ...(v.context ?? {}), doelNetwerk: v.network, amountPolicy: beleid })
    if (u.valid === v.expected.valid && u.reason_code === v.expected.reason_code) eens++
    else afwijkend.push(v.id + ' (' + u.reason_code + ' tegen ' + v.expected.reason_code + ')')
  }
  uitkomst[beleid] = { eens, afwijkend }
  console.log('  ' + beleid.padEnd(9) + ' eens op ' + eens + ' van ' + vectoren.length +
    (afwijkend.length ? '   afwijkend: ' + afwijkend.join(', ') : ''))
}
console.log('')
console.log('  Beide beleiden halen dezelfde uitslag op alle tien. Dat is het punt: de')
console.log('  gepubliceerde vectoren dekken alleen ONDERbetaling, dus zij kunnen de vraag')
console.log('  niet beantwoorden. Wie hier stopt, denkt dat hij het weet.')

// ---------------------------------------------------------------------------
console.log('')
console.log('2. Het geval dat geen enkele vector dekt: te veel betalen')
console.log('')
{
  const basis = lees('valid-baseline-001.json')
  for (const beleid of ['exact', 'at-least']) {
    const v = JSON.parse(JSON.stringify(basis))
    v.input.accepted.amount = String(BigInt(v.input.payload.authorization.value) - 1n)
    const u = await beoordeelAutorisatie(v.input, { ...(v.context ?? {}), doelNetwerk: v.network, amountPolicy: beleid })
    console.log('  ' + beleid.padEnd(9) + ' ondertekend ' + v.input.payload.authorization.value +
      ', gevraagd ' + v.input.accepted.amount + '  ->  ' + (u.valid ? 'GELDIG' : u.reason_code))
  }
  console.log('')
  console.log('  Twee referentie-implementaties wijzen dit af:')
  console.log('    go/mechanisms/evm/exact/facilitator/eip3009.go:65  Cmp(requiredValue) != 0')
  console.log('    python/x402/mechanisms/evm/exact/facilitator.py:235  value != amount')
  console.log('    en diezelfde python zegt op regel 168: "Amount exactly matches requirements.amount"')
  console.log('  Daarom staat exact bij ons als standaard. Het blijft een keuze, dus hij staat')
  console.log('  in de uitslag en niet alleen in de code.')
}

// ---------------------------------------------------------------------------
console.log('')
console.log('3. Het tweede geval dat geen vector dekt: dezelfde nonce, een ANDERE betaler')
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

  console.log('  nonce al verbruikt door een ANDER adres')
  console.log('    per betaler (contractvorm) ->  ' + (perBetaler.valid ? 'GELDIG' : perBetaler.reason_code))
  console.log('  dezelfde nonce verbruikt door DEZE betaler')
  console.log('    platte lijst               ->  ' + (plat.valid ? 'GELDIG' : plat.reason_code))
  console.log('')
  console.log('  EIP-3009 houdt dit zelf per adres bij: mapping(address => mapping(bytes32')
  console.log('  => bool)), uitleesbaar als authorizationState(address authorizer, bytes32')
  console.log('  nonce), en de spec zegt dat nonces willekeurige 32 bytes zijn, uniek per')
  console.log('  adres. Een verifieerder met een lijst zonder betaler is dus STRENGER dan de')
  console.log('  keten en zou een geldige betaling van een ander kunnen weigeren.')
}

console.log('')
console.log('Kort: op de tien gepubliceerde vectoren maakt geen van beide keuzes verschil.')
console.log('Op de twee gevallen die niemand gepubliceerd heeft, maakt het alles uit.')
