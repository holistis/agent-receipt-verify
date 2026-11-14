// Voorkomt een bug die we vandaag drie keer zagen terugkomen (capacity-attest
// se entrypoint-check, een eigen nieuw wazir-al-ghanima-script, en de eerste
// versie van src/x402-client-checklist.mjs zelf): `file://${process.argv[1]}`
// als handgemaakte string werkt niet overal -- op Windows geeft een pad met
// backslashes of met niet-ascii-tekens een URL die niet gelijk is aan
// `import.meta.url`, waardoor een entrypoint-check (`import.meta.url === ...`)
// altijd false is en het script zwijgt in plaats van te draaien. De juiste
// vorm is `pathToFileURL(process.argv[1]).href`. Deze test grept de hele
// src/- en bin/-map op het verkeerde patroon, zodat het niet terug kan sluipen
// zonder dat de testsuite rood wordt.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HIER = dirname(fileURLToPath(import.meta.url))
const VERBODEN_PATROON = /file:\/\/\$\{/

function alleBestanden(map) {
  const resultaten = []
  for (const naam of readdirSync(map)) {
    const pad = join(map, naam)
    const info = statSync(pad)
    if (info.isDirectory()) resultaten.push(...alleBestanden(pad))
    else if (/\.(mjs|js|ts)$/.test(naam)) resultaten.push(pad)
  }
  return resultaten
}

let goed = 0
let fout = 0
const mappen = ['src', 'bin', 'tools', 'bench'].map((m) => join(HIER, '..', m))
const treffers = []
for (const map of mappen) {
  let bestanden
  try {
    bestanden = alleBestanden(map)
  } catch {
    continue
  }
  for (const pad of bestanden) {
    const inhoud = readFileSync(pad, 'utf8')
    if (VERBODEN_PATROON.test(inhoud)) treffers.push(pad)
  }
}

if (treffers.length === 0) {
  goed++
  console.log('  pass  geen handgemaakte file://${...} -URL in src/bin/tools/bench')
} else {
  fout++
  console.log('  FAIL  handgemaakte file://${...} gevonden in: ' + treffers.join(', '))
  console.log('        gebruik pathToFileURL(process.argv[1]).href in plaats daarvan')
}

console.log('\n' + goed + ' passed, ' + fout + ' failed')
process.exitCode = fout === 0 ? 0 : 1
