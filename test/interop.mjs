// Draait beide formaten tegen de vectoren van hun eigen auteurs.
// Eén uitslag, één exitcode. Rood = wij en zij zijn het ergens oneens.
import { execFileSync } from 'node:child_process'
import { berekenCommitment, opentCommitment, SPEC_VOORBEELD } from '../src/x402-offer-receipt.mjs'

let goed = 0, fout = 0
const toets = (n, ok, extra = '') => { if (ok) { goed++; console.log('  groen  ' + n) } else { fout++; console.log('  ROOD   ' + n + (extra ? '  <- ' + extra : '')) } }

console.log('x402 offer-receipt, autorisatie-commitment')
{
  const ons = berekenCommitment(SPEC_VOORBEELD.invoer)
  toets('hun gepubliceerde voorbeeld komt er byte-identiek uit', ons === SPEC_VOORBEELD.verwacht, ons)
}
toets('een verkeerde authorizer geeft een ander commitment',
  berekenCommitment({ ...SPEC_VOORBEELD.invoer, authorizer: '0x0000000000000000000000000000000000000001' }) !== SPEC_VOORBEELD.verwacht)
toets('een zout van 31 bytes wordt geweigerd, niet stil geaccepteerd', (() => {
  try { berekenCommitment({ ...SPEC_VOORBEELD.invoer, salt: '0x' + 'ab'.repeat(31) }); return false } catch { return true }
})())
toets('een onbekende method wordt geweigerd', (() => {
  try { berekenCommitment({ ...SPEC_VOORBEELD.invoer, method: 'verzonnen' }); return false } catch { return true }
})())

console.log('x402 offer-receipt, openen tegen kandidaten (§5.6.4)')
{
  const receipt = { payload: { payer: SPEC_VOORBEELD.invoer.authorizer, authorizationMethod: 'eip3009', authorizationCommitment: SPEC_VOORBEELD.verwacht } }
  const andere = '0x' + '11'.repeat(32)
  const a = opentCommitment({ receipt, salt: SPEC_VOORBEELD.invoer.salt, asset: SPEC_VOORBEELD.invoer.asset, kandidaatIdentifiers: [andere, SPEC_VOORBEELD.invoer.identifier] })
  toets('opent op precies een kandidaat', a.linked === true && a.identifier === SPEC_VOORBEELD.invoer.identifier, JSON.stringify(a))
  const b = opentCommitment({ receipt, salt: SPEC_VOORBEELD.invoer.salt, asset: SPEC_VOORBEELD.invoer.asset, kandidaatIdentifiers: [andere] })
  toets('zonder de juiste kandidaat: niet gelinkt', b.linked === false)
  const c = opentCommitment({ receipt: { payload: { ...receipt.payload, payer: '0x0000000000000000000000000000000000000002' } }, salt: SPEC_VOORBEELD.invoer.salt, asset: SPEC_VOORBEELD.invoer.asset, kandidaatIdentifiers: [SPEC_VOORBEELD.invoer.identifier] })
  toets('een andere payer opent nergens op (geen valse link)', c.linked === false)
}

console.log('INAM countersigned, hun vier vectoren')
{
  let uit = ''
  try {
    uit = execFileSync('node', [new URL('../src/inam-countersigned.mjs', import.meta.url).pathname.replace(/^\//, ''), new URL('../vectors/inam/vectors.json', import.meta.url).pathname.replace(/^\//, '')], { encoding: 'utf8' })
  } catch (e) { uit = (e.stdout ?? '') + (e.stderr ?? '') }
  toets('alle vier dezelfde uitspraak als hun eigen verifier', /4 van 4 volledig gelijk, 0 afwijkend/.test(uit), uit.trim().split('\n').pop())
}

console.log(`\n${goed} groen, ${fout} rood`)
process.exit(fout === 0 ? 0 : 1)
