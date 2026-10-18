// De afrekening-vectoren, en de controles die ze eerlijk houden.
//
// WAAROM DEZE TEST MEER DOET DAN DE LOPER. De loper zegt of elke vector zijn eigen
// verwachting haalt. Dat is te makkelijk: een corpus waarin alles LINKED verwacht en
// alles LINKED teruggeeft, bewijst niets over de meter. Deze test toetst daarom ook de
// SAMENSTELLING van het corpus en de randen van de beoordelaar.
//
// DE DRIE DINGEN DIE HIER ECHT GETOETST WORDEN:
// 1. Het corpus heeft positieve EN negatieve gevallen, want een corpus zonder
//    tegenvoorbeelden meet alleen of de code iets teruggeeft.
// 2. Het onderscheid tussen NIET GELINKT en NIET GEMETEN, want dat is precies de
//    uitkomst die een woordenlijst met twee waarden niet kan uitdrukken en waardoor
//    een haperende RPC een geldig bonnetje zou weggooien.
// 3. Elk positief geval wordt opnieuw AFGELEID uit het ondertekende bonnetje, niet
//    overgeschreven. Een vector die zichzelf niet opent, is erger dan geen vector.

import { beoordeelVector, laadVectoren } from '../src/settlement-link-vectors.mjs'
import { berekenCommitment } from '../src/x402-offer-receipt.mjs'

let goed = 0, fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const vectoren = laadVectoren()

console.log('het corpus zelf')
t('er zijn vectoren', vectoren.length >= 10, 'gevonden: ' + vectoren.length)
t('elke vector draagt requires_chain_read, want dat is wat gevraagd werd',
  vectoren.every((v) => typeof v.requires_chain_read === 'boolean'))
t('elke vector noemt zijn herkomst, inclusief dat 5.6 nog een voorstel is',
  vectoren.every((v) => Array.isArray(v.provenance) && v.provenance.some((p) => /3827|proposal|pull request/i.test(p))))
t('de meeste vectoren draaien zonder keten, anders kan niemand ze narekenen',
  vectoren.filter((v) => !v.requires_chain_read).length >= vectoren.length - 2)

const uitkomsten = new Set(vectoren.map((v) => v.expected.outcome))
t('het corpus bevat positieve EN negatieve gevallen', uitkomsten.has('LINKED') && uitkomsten.has('NOT_LINKED'),
  [...uitkomsten].join(', '))
t('en het geval dat niet gemeten kon worden, want dat is de derde uitkomst',
  uitkomsten.has('NOT_MEASURED'))

console.log('')
console.log('de loper tegen het corpus')
for (const v of vectoren) {
  const u = beoordeelVector(v)
  if (u.outcome === 'SKIPPED') {
    t(v.id + ' wordt overgeslagen en NIET afgekeurd, want hij vraagt een keten', v.requires_chain_read === true)
    continue
  }
  t(v.id + ' geeft ' + v.expected.outcome, u.outcome === v.expected.outcome, 'kreeg ' + u.outcome + ' ' + (u.reden ?? ''))
}

console.log('')
console.log('de randen van de beoordelaar, want daar gaat het mis')

{
  // Het verschil dat een haperende RPC gevaarlijk maakt.
  const basis = vectoren.find((v) => v.expected.outcome === 'LINKED' && v.input?.receipt && !v.requires_chain_read && Array.isArray(v.input.candidates))
  const geenLijst = { ...basis, input: { ...basis.input, candidates: null } }
  const legeLijst = { ...basis, input: { ...basis.input, candidates: [] } }
  t('geen kandidatenlijst VERKREGEN geeft NOT_MEASURED', beoordeelVector(geenLijst).outcome === 'NOT_MEASURED')
  t('een LEGE kandidatenlijst geeft NOT_LINKED, en dat is een ander ding',
    beoordeelVector(legeLijst).outcome === 'NOT_LINKED')
}

{
  // Een bonnetje van versie 1 draagt geen commitment. Dat is geen afkeuring.
  const basis = vectoren.find((v) => v.input?.receipt && !v.requires_chain_read && Array.isArray(v.input.candidates))
  const v1 = JSON.parse(JSON.stringify(basis))
  delete v1.input.receipt.payload.authorizationCommitment
  t('een bonnetje zonder commitment geeft NOT_MEASURED, niet NOT_LINKED',
    beoordeelVector(v1).outcome === 'NOT_MEASURED')
}

{
  // De uitkomst die praktisch onmogelijk hoort te zijn, maar wel benoembaar moet zijn.
  const basis = JSON.parse(JSON.stringify(vectoren.find((v) => v.expected.outcome === 'LINKED' && v.input?.receipt && !v.requires_chain_read && Array.isArray(v.input.candidates))))
  const k = basis.input.candidates[0]
  basis.input.candidates = [k, { ...k }]
  t('twee identieke kandidaten geeft AMBIGUOUS in plaats van stil de eerste pakken',
    beoordeelVector(basis).outcome === 'AMBIGUOUS')
}

console.log('')
console.log('elk positief geval is OPNIEUW AFGELEID uit het ondertekende bonnetje')
{
  let afgeleid = 0
  for (const v of vectoren) {
    if (v.expected.outcome !== 'LINKED' || !v.input?.receipt || v.requires_chain_read) continue
    const p = v.input.receipt.payload
    const k = (v.input.candidates ?? [])[0]
    if (!k) continue
    const her = berekenCommitment({
      method: p.authorizationMethod ?? 'eip3009',
      asset: v.input.asset,
      authorizer: k.authorizer,
      identifier: k.nonce,
      salt: v.input.authorizationSalt,
    })
    t(v.id + ': het commitment in het bonnetje is herberekenbaar uit de losse velden',
      String(her).toLowerCase() === String(p.authorizationCommitment).toLowerCase())
    afgeleid++
  }
  t('en dat gold voor minstens drie echte betalingen', afgeleid >= 3, 'afgeleid: ' + afgeleid)
}

console.log('')
console.log('settlement-link vectoren: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
