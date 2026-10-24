// Neemt een controle op tegen de echte keten en bewaart elk antwoord van het knooppunt, zodat de test
// dezelfde uitslag zonder netwerk kan nadraaien. Draait met het netwerk en dus NIET in de testsuite.
//
//   node bench/ground-record.mjs <naam> <netwerk> <feedback-tx> [betaling-tx] --verwacht='{"raterIsPayer":"true",...}' --bron=<url>
//
// WAAROM EEN OPNAME EN GEEN NEPANTWOORD. Een zelfgebouwd nepantwoord test of de code consistent is met wat
// wij dachten dat de keten zegt. Een opname is wat het knooppunt werkelijk antwoordde op de aanvragen die de
// code werkelijk deed. De test vergelijkt de uitslag dan met een oordeel van een ANDER, in een openbare
// draad opgeschreven, en niet met ons eigen oordeel.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { maakRpc } from '../src/x402-link-onchain.mjs'
import { NETWERKEN, beoordeelGrounding } from '../src/x402-grounding.mjs'

const [, , naam, network, feedbackTx, betalingTx] = process.argv.filter((a) => !a.startsWith('--'))
const vlag = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
if (!naam || !network || !feedbackTx) {
  console.log('usage: node bench/ground-record.mjs <name> <network> <feedback tx> [payment tx] --verwacht=<json> --bron=<url>')
  process.exit(2)
}
const echt = maakRpc(vlag('rpc') ?? NETWERKEN[network].rpc)
const opname = []
const rpc = async (method, params) => {
  const sleutel = JSON.stringify([method, params])
  try {
    const resultaat = await echt(method, params)
    opname.push([sleutel, { resultaat }])
    return resultaat
  } catch (e) {
    opname.push([sleutel, { fout: String(e.message) }])
    throw e
  }
}
const uitslag = await beoordeelGrounding({ rpc, network, feedbackTx, paymentTx: betalingTx ?? null })
const map = fileURLToPath(new URL('../vectors/grounding/', import.meta.url))
mkdirSync(map, { recursive: true })
const bestand = {
  naam, network, feedbackTx, paymentTx: betalingTx ?? null,
  opgenomen: new Date().toISOString().slice(0, 10),
  oordeelVanEenAnder: { bron: vlag('bron') ?? null, verwacht: JSON.parse(vlag('verwacht') ?? '{}') },
  onzeUitslag: Object.fromEntries(Object.entries(uitslag.feiten).map(([k, v]) => [k, v.status])),
  grounded: uitslag.grounded,
  opname,
}
writeFileSync(map + naam + '.json', JSON.stringify(bestand, null, 1))
console.log(`opgenomen: ${opname.length} aanroepen, uitslag ${uitslag.grounded}, naar vectors/grounding/${naam}.json`)
