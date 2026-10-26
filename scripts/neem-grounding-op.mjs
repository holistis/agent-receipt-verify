// Neemt de chainvragen van een grounding-controle op in het bestandsformaat van vectors/grounding/, zodat de controle
// daarna zonder netwerk is na te spelen met: npx -y agent-receipt-verify ground --vectors
//
// Gebruik: node scripts/neem-grounding-op.mjs --naam=<naam> --feedback=<tx> [--payment=<tx>] [--network=eip155:84532]
//              --bron=<url van het oordeel> --wie="<tekst>" --verwacht=<feit=status,feit=status,...> [--eindoordeel=yes|no]
//              [--uit=vectors/grounding/<naam>.json] [--rpc=<url>]
//
// Het oordeel van een ander (bron, wie, verwacht) wordt hier alleen overgenomen en niet afgeleid van onze uitslag.
import { readFileSync, writeFileSync } from 'node:fs'
import { beoordeelGrounding, NETWERKEN } from '../src/x402-grounding.mjs'
import { maakRpc } from '../src/x402-link-onchain.mjs'

function vlag(naam, standaard = null) {
  const v = process.argv.find((a) => a.startsWith(`--${naam}=`))
  return v ? v.slice(naam.length + 3) : standaard
}

const naam = vlag('naam')
const feedbackTx = vlag('feedback')
const network = vlag('network', 'eip155:84532')
const bron = vlag('bron')
const wie = vlag('wie')
const verwachtTekst = vlag('verwacht')
if (!naam || !feedbackTx || !bron || !wie || !verwachtTekst) {
  console.error('naam, feedback, bron, wie en verwacht zijn verplicht')
  process.exit(2)
}
const cfg = NETWERKEN[network]
if (!cfg) { console.error('onbekend netwerk ' + network); process.exit(2) }
const verwacht = Object.fromEntries(verwachtTekst.split(',').map((p) => p.split('=')))
const echt = maakRpc(vlag('rpc', cfg.rpc))
const opname = new Map()
const rpc = async (method, params) => {
  const sleutel = JSON.stringify([method, params])
  try {
    const resultaat = await echt(method, params)
    opname.set(sleutel, { resultaat })
    return resultaat
  } catch (e) {
    opname.set(sleutel, { fout: e.message })
    throw e
  }
}
const u = await beoordeelGrounding({ rpc, network, feedbackTx, paymentTx: vlag('payment') })
const vector = {
  naam,
  network,
  feedbackTx,
  paymentTx: vlag('payment'),
  opgenomen: new Date().toISOString().slice(0, 10),
  oordeelVanEenAnder: { bron, verwacht, wie, ...(vlag('eindoordeel') ? { eindoordeel: vlag('eindoordeel') } : {}) },
  onzeUitslag: Object.fromEntries(Object.entries(u.feiten).map(([n, f]) => [n, f.status])),
  grounded: u.grounded,
  opname: [...opname.entries()],
}
const uit = vlag('uit', `vectors/grounding/${naam}.json`)
writeFileSync(uit, JSON.stringify(vector) + '\n')
console.log(`opgenomen: ${uit}, ${opname.size} chainvragen, onze uitslag ${u.grounded}`)
