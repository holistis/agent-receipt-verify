// Draait beide formaten tegen de vectoren van hun eigen auteurs.
// Eén uitslag, één exitcode. Rood = wij en zij zijn het ergens oneens.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// WAAROM EEN HELPER EN GEEN .pathname: op Windows geeft URL.pathname '/C:/...' en dan
// is de leidende slash eraf halen toevallig nog een geldig absoluut pad. Op Linux geeft
// het '/home/...' en levert diezelfde truc een RELATIEF pad, dat vervolgens achter de
// werkmap wordt geplakt. Deze suite paste daardoor alleen op onze eigen machine, en dat
// bleef onzichtbaar tot de eerste CI-run het dubbele pad liet zien.
const pad = (rel) => fileURLToPath(new URL(rel, import.meta.url))
import { berekenCommitment, opentCommitment, SPEC_VOORBEELD } from '../src/x402-offer-receipt.mjs'

let goed = 0, fout = 0
const toets = (n, ok, extra = '') => { if (ok) { goed++; console.log('  pass  ' + n) } else { fout++; console.log('  FAIL  ' + n + (extra ? '  <- ' + extra : '')) } }

console.log('x402 offer-receipt, authorization commitment')
{
  const ons = berekenCommitment(SPEC_VOORBEELD.invoer)
  toets('their published example comes out byte identical', ons === SPEC_VOORBEELD.verwacht, ons)
}
toets('a wrong authorizer yields a different commitment',
  berekenCommitment({ ...SPEC_VOORBEELD.invoer, authorizer: '0x0000000000000000000000000000000000000001' }) !== SPEC_VOORBEELD.verwacht)
toets('a 31 byte salt is refused, not silently accepted', (() => {
  try { berekenCommitment({ ...SPEC_VOORBEELD.invoer, salt: '0x' + 'ab'.repeat(31) }); return false } catch { return true }
})())
toets('an unknown method is refused', (() => {
  try { berekenCommitment({ ...SPEC_VOORBEELD.invoer, method: 'verzonnen' }); return false } catch { return true }
})())

console.log('x402 offer-receipt, opening against candidates (section 5.6.4)')
{
  const receipt = { payload: { payer: SPEC_VOORBEELD.invoer.authorizer, authorizationMethod: 'eip3009', authorizationCommitment: SPEC_VOORBEELD.verwacht } }
  const andere = '0x' + '11'.repeat(32)
  const a = opentCommitment({ receipt, salt: SPEC_VOORBEELD.invoer.salt, asset: SPEC_VOORBEELD.invoer.asset, kandidaatIdentifiers: [andere, SPEC_VOORBEELD.invoer.identifier] })
  toets('opens on exactly one candidate', a.linked === true && a.identifier === SPEC_VOORBEELD.invoer.identifier, JSON.stringify(a))
  const b = opentCommitment({ receipt, salt: SPEC_VOORBEELD.invoer.salt, asset: SPEC_VOORBEELD.invoer.asset, kandidaatIdentifiers: [andere] })
  toets('without the right candidate, not linked', b.linked === false)
  const c = opentCommitment({ receipt: { payload: { ...receipt.payload, payer: '0x0000000000000000000000000000000000000002' } }, salt: SPEC_VOORBEELD.invoer.salt, asset: SPEC_VOORBEELD.invoer.asset, kandidaatIdentifiers: [SPEC_VOORBEELD.invoer.identifier] })
  toets('a different payer opens on nothing, so no false link', c.linked === false)
}

console.log('INAM countersigned, their four vectors')
{
  let uit = ''
  try {
    uit = execFileSync('node', [pad('../src/inam-countersigned.mjs'), pad('../vectors/inam/vectors.json')], { encoding: 'utf8' })
  } catch (e) { uit = (e.stdout ?? '') + (e.stderr ?? '') }
  toets('all four reach the same verdict as their own verifier', /4 van 4 volledig gelijk, 0 afwijkend/.test(uit), uit.trim().split('\n').pop())
}

console.log(`\n${goed} passed, ${fout} failed`)
process.exit(fout === 0 ? 0 : 1)
