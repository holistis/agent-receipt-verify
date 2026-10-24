// Een suite voor de hele keten: draai alle vectorcontroles achter elkaar en krijg een tabel.
//
// WAAROM DIT BESTAAT. In erc-8004/erc-8004-contracts#99 vroeg ruiruii of de vectoren van deze repo in
// een enkel conformance-kader konden, zodat een lezer een suite draait en alle zekerheden tegelijk
// krijgt. Dit is dat kader, en het is dun met opzet: het schrijft geen tweede implementatie van iets,
// het roept de bestaande commando's aan en zet hun uitslagen naast elkaar. Twee plekken die hetzelfde
// doen lopen altijd uit elkaar.
//
// WAT HET NIET IS. Het is geen keurmerk en het zegt niets over een eindpunt of een bonnetje van een
// ander: het controleert dat DEZE implementatie zich gedraagt zoals de gepubliceerde vectoren en de
// opgenomen verdicten van derden. Een controle die zonder netwerk niet kan draaien, staat er als niet
// gemeten, niet als geslaagd.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url))

/** De controles, in de volgorde van de keten: aanvraag, autorisatie, afrekening, feedback. */
export const CONTROLES = [
  { sleutel: 'attempt-identity', commando: ['attempt-identity'], zekerheid: 'one attempt gets one identity, derived once (x402 spec section 5.5)' },
  { sleutel: 'kanon', commando: ['kanon'], zekerheid: 'the payment authorization is judged like the published EIP-3009 vectors' },
  { sleutel: 'link-vectors', commando: ['link-vectors'], zekerheid: 'a receipt opens on exactly one settlement (x402#3827, section 5.6.4)' },
  { sleutel: 'ground', commando: ['ground', '--vectors'], zekerheid: 'a feedback is grounded in a payment, judged like AgenticFinanceGraph judged two (ERC-8004 #99)' },
]

const samenvatting = (tekst) => {
  const regels = String(tekst).split('\n').map((r) => r.trim()).filter(Boolean)
  return regels.reverse().find((r) => /\d+ of \d+|agree on|\d+ agree|\d+ pass/i.test(r)) ?? regels[0] ?? ''
}

/** De standaard uitvoerder: het eigen CLI als kindproces. Injecteerbaar zodat een test een mislukking kan namaken. */
export function draaiKind(commando) {
  const r = spawnSync(process.execPath, [CLI, ...commando], { encoding: 'utf8', timeout: 300_000 })
  return { status: r.status, stdout: (r.stdout ?? '') + (r.stderr ?? '') }
}

export function draaiSuite({ run = draaiKind, controles = CONTROLES } = {}) {
  const rijen = controles.map((c) => {
    const r = run(c.commando)
    return { ...c, geslaagd: r.status === 0, status: r.status, regel: samenvatting(r.stdout) }
  })
  return { rijen, geslaagd: rijen.every((r) => r.geslaagd) }
}

if (process.argv[1]?.endsWith('conformance-suite.mjs')) {
  const u = draaiSuite()
  console.log('One suite, four assurances, one command. Offline unless a line says otherwise.')
  console.log('')
  for (const r of u.rijen) {
    console.log(`${r.geslaagd ? 'pass' : 'FAIL'}  ${r.sleutel}`)
    console.log(`      ${r.zekerheid}`)
    console.log(`      ${r.regel}`)
  }
  console.log('')
  console.log(u.geslaagd ? `All ${u.rijen.length} checks behave as recorded.` : `${u.rijen.filter((r) => !r.geslaagd).length} of ${u.rijen.length} checks do NOT behave as recorded.`)
  console.log('This checks that this implementation behaves like the published vectors and the recorded verdicts of others.')
  console.log('It is not a certification of anyone else\'s endpoint, receipt or feedback.')
  process.exitCode = u.geslaagd ? 0 : 1
}
