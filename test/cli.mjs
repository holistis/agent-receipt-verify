// Test voor de commando-ingang.
//
// Waarom een losse test op een paar regels dispatch: dit is het bestand dat een
// VREEMDE als eerste aanraakt. Een stille fout hier betekent dat iemand die onze
// meetlat wil proberen een stacktrace ziet en wegklikt, en dan is al het werk
// eronder nutteloos. Getest met echte processen, want een dispatcher die alleen in
// theorie klopt is precies wat hier mis kan gaan.

import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

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
  // census neemt een optioneel uitvoerpad en anders niets. Een vlag is geen pad, en
  // zonder deze controle schreef het commando een bestand met de naam van de vlag in
  // de map waar de vreemde stond. Dat was echt gebeurd: onze eigen testronde liet een
  // bestand van 717 kB achter met een vlagnaam. Daarom toetst dit twee dingen die los
  // van elkaar fout kunnen gaan: de klacht komt, EN er blijft niets liggen.
  const r = draai('census', '--help-bestaat-niet')
  t('census weigert een vlag als uitvoerpad', r.status === 2, 'status ' + r.status)
  t('en zegt waarom, in de taal van de lezer', /looks like a flag/.test(r.stdout + r.stderr),
    (r.stdout + r.stderr).slice(0, 90))
  t('en laat geen bestand met de vlagnaam achter', !existsSync('--help-bestaat-niet'))
  t('census belandt niet stil op de conformance-tak', !/asks for payment/.test(r.stdout + r.stderr))
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


// De beleidsmatrix als eigen commando (sinds 0.2.2). Dit is de enige ingang waarmee
// een vreemde de twee vragen uit x402#2725 zelf kan NAREKENEN in plaats van ons op
// ons woord te geloven, dus een stille breuk hier kost precies dat.
{
  const r = draai('beleid')
  t('beleid draait en eindigt op 0', r.status === 0, 'status ' + r.status)
  t('en toont beide bedragbeleiden', /exact/.test(r.stdout) && /at-least/.test(r.stdout))
  t('en noemt de twee gevallen die geen vector dekt',
    /paying too much/.test(r.stdout) && /DIFFERENT payer/.test(r.stdout))
  t('en citeert de regelnummers van de twee referentie-implementaties',
    /eip3009.go:65/.test(r.stdout) && /facilitator.py:235/.test(r.stdout))
  t('de uitvoer is Engels, want dit commando is voor vreemden',
    !/gemeten|vectoren|betaler/.test(r.stdout), r.stdout.slice(0, 60))
}

console.log('')
console.log('elk woord in de verzendtabel bestaat ook voor een vreemde')

// WAAROM DIT UIT HET BESTAND ZELF WORDT GELEZEN EN NIET UIT EEN LIJST HIER. Een lijst
// hier is een tweede verklaring, en twee verklaringen lopen uit elkaar. Dit leest de
// echte verzendtabel en toetst per woord drie dingen die los van elkaar fout kunnen
// gaan. De aanleiding was gemeten: twee ingangen (liveness en verify-delivery) stonden
// wel in de tabel en in nul regels van de helptekst, en bestonden dus niet voor iemand
// die het pakket voor het eerst opent.
{
  const bron = readFileSync(CLI, 'utf8')
  const tabel = bron.match(/const onderdelen = {([^}]*)}/)
  t('de verzendtabel is te lezen uit bin/cli.mjs', Boolean(tabel))
  const woorden = tabel
    ? [...tabel[1].matchAll(/^\s*'?([a-z-]+)'?\s*:\s*'([^']+)'/gm)].map((m) => ({ woord: m[1], pad: m[2] }))
    : []
  t('en bevat meer dan een handvol ingangen', woorden.length >= 8, 'aantal ' + woorden.length)

  const help = draai('--help').stdout
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

  for (const { woord, pad } of woorden) {
    const echtPad = fileURLToPath(new URL(pad, pathToFileURL(CLI)))
    t(woord + ': het doelbestand bestaat echt', existsSync(echtPad), pad)
    t(woord + ': staat in --help, anders bestaat het niet voor een vreemde',
      help.includes(woord), 'niet in help')
    // Een script met DEZELFDE naam is een tweede, onafhankelijke verklaring. Wijst die
    // naar een ander bestand, dan is er ergens een stille verwisseling.
    const script = pkg.scripts?.[woord]
    if (script) {
      const kaal = pad.replace(/^\.\.\//, '')
      t(woord + ': het npm-script wijst naar hetzelfde bestand', script.includes(kaal),
        script + ' vs ' + kaal)
    }
  }
}

console.log('cli: ' + goed + ' pass, ' + fout + ' fail')
if (fout > 0) process.exitCode = 1
