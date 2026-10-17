// Test voor de commando-ingang.
//
// Waarom een losse test op een paar regels dispatch: dit is het bestand dat een
// VREEMDE als eerste aanraakt. Een stille fout hier betekent dat iemand die onze
// meetlat wil proberen een stacktrace ziet en wegklikt, en dan is al het werk
// eronder nutteloos. Getest met echte processen, want een dispatcher die alleen in
// theorie klopt is precies wat hier mis kan gaan.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url))

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const draai = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000 })

{
  const r = draai('--help')
  t('help werkt en eindigt op 0', r.status === 0, 'status ' + r.status)
  t('help noemt het npx-commando', r.stdout.includes('npx github:holistis/agent-receipt-verify'))
  t('help noemt ook wat het NIET doet', /niet gemeten|NIET doet/.test(r.stdout))
  t('help noemt de kruiscontrole, want een ingang die niemand kent bestaat niet',
    r.stdout.includes('kanon'))
}
{
  const r = draai()
  t('zonder argument komt de uitleg en een foutcode', r.status === 2 && r.stdout.includes('agent-receipt-verify'), 'status ' + r.status)
}
{
  const r = draai('onzin')
  t('een onbekend subcommando faalt zichtbaar', r.status === 2 && r.stdout.includes('onbekend'), 'status ' + r.status)
}
{
  // Geen netwerk: een adres dat nergens naartoe gaat hoort ONGEMETEN te geven en
  // niet te klappen. Een meetlat die crasht op een dood adres is onbruikbaar op
  // precies de lijst waar dode adressen op staan.
  const r = draai('https://localhost:1/doet-niets')
  t('een dood adres laat de cli niet klappen', r.status === 0 || r.status === undefined, 'status ' + r.status)
  t('en meldt dat trede 0 niet gemeten kon worden', /not reachable|L-/.test(r.stdout), r.stdout.slice(0, 80))
}
{
  const r = draai('census', '--help-bestaat-niet')
  // census negeert onbekende vlaggen en gaat gewoon de index ophalen; dat kost
  // netwerk, dus hier toetsen we alleen dat de dispatch de juiste module kiest en
  // niet stil op de conformance-tak belandt.
  t('census gaat naar de census-module', !/asks for payment/.test(r.stdout + r.stderr))
}

console.log('')
console.log('')
console.log('de kruiscontrole als los onderdeel')
{
  const r = draai('kanon')
  t('kanon draait en eindigt op 0, want wij zijn het met alle tien eens', r.status === 0, 'status ' + r.status)
  t('en meldt de uitslag in woorden die een vreemde kan lezen', /agree on 10 of 10/.test(r.stdout))
  t('en noemt de gepinde commit van de bron', /0d5a7461e996/.test(r.stdout))
  t('en zegt expliciet dat wij niet tegen hun broncode schreven', /never against/.test(r.stdout))
}

console.log('cli: ' + goed + ' pass, ' + fout + ' fail')
if (fout > 0) process.exitCode = 1
