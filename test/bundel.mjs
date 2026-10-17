// De bundel en de registratiegegevens, in twee richtingen.
//
// De scherpste test hieronder is de laatste: hij leest de ECHTE import-regels van de
// server en eist dat elk bestand waar die naar wijst ook in de bundel zit. Een
// handmatige inhoudslijst veroudert stil zodra iemand een nieuw bestand importeert,
// en dat zou pas opvallen bij de vreemde die de bundel installeert.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INHOUD, stageer, versiesKloppen, bewijsDatDeBundelWerkt } from '../tools/bundel-bouw.mjs'

const wortel = fileURLToPath(new URL('..', import.meta.url))
let groen = 0, rood = 0
const t = (naam, voorwaarde) => {
  if (voorwaarde) { groen++; console.log('  pass  ' + naam) } else { rood++; console.log('  FAIL  ' + naam) }
}

console.log('registratiegegevens')
{
  const srv = JSON.parse(fs.readFileSync(path.join(wortel, 'server.json'), 'utf8'))
  const man = JSON.parse(fs.readFileSync(path.join(wortel, 'manifest.json'), 'utf8'))

  t('de naam zit in onze eigen naamruimte, want daar vertrouwt het register onze repo op',
    /^io\.github\.holistis\//.test(srv.name))
  t('de beschrijving blijft onder de 100 tekens die het register toestaat',
    srv.description.length > 0 && srv.description.length <= 100)
  t('de drie verplichte velden staan erin', !!(srv.name && srv.description && srv.version))

  // GEMETEN LES, 2026-10-17. De eerste publicatie stond in het register en was
  // tegelijk onvindbaar op de enige zoekterm die ons iets oplevert: de categorie
  // conformance telde vier regels onder twee namen, en ons woord stond niet in onze
  // eigen beschrijving. Het register zoekt op naam en beschrijving, dus een
  // positionering die alleen in onze README staat, bestaat voor een zoeker niet.
  for (const woord of ['x402', 'conformance', 'receipt', 'settlement']) {
    t('de beschrijving bevat "' + woord + '", anders zijn wij op die zoekterm onvindbaar',
      srv.description.toLowerCase().includes(woord))
  }
  t('de repository wijst naar ons, anders levert een vermelding ons niets op',
    srv.repository?.url === 'https://github.com/holistis/agent-receipt-verify')
  t('er staat GEEN packages-blok in het bestand zelf, want de hash is pas bij een release bekend',
    srv.packages === undefined)

  t('het bundelmanifest noemt de versie van het manifestformaat', man.manifest_version === '0.3')
  t('en een auteur, wat het formaat vereist', !!man.author?.name)
  t('het manifest wijst naar een entry_point die echt bestaat',
    fs.existsSync(path.join(wortel, man.server.entry_point)))
  t('het commando start node op precies dat bestand',
    man.server.mcp_config.command === 'node' && man.server.mcp_config.args[0].includes(man.server.entry_point))
  t('beide tools staan in het manifest met dezelfde namen als de server teruggeeft',
    man.tools.map((x) => x.name).sort().join(',') === 'check_x402_endpoint,link_receipt_to_settlement')
}

console.log('\nde versies moeten gelijk lopen')
{
  t('in de echte repo lopen package.json, manifest.json en server.json gelijk',
    versiesKloppen().klachten.length === 0)

  const nep = (versies) => (f) => ({ version: versies[f] })
  t('een manifest dat achterloopt is een klacht', versiesKloppen(
    nep({ 'package.json': '0.3.0', 'manifest.json': '0.2.0', 'server.json': '0.3.0' })).klachten.length === 1)
  t('een server.json die achterloopt is een klacht', versiesKloppen(
    nep({ 'package.json': '0.3.0', 'manifest.json': '0.3.0', 'server.json': '0.2.0' })).klachten.length === 1)
  t('twee die uiteenlopen geeft twee klachten', versiesKloppen(
    nep({ 'package.json': '0.3.0', 'manifest.json': '0.1.0', 'server.json': '0.2.0' })).klachten.length === 2)
}

console.log('\nde gestageerde bundel')
const doel = path.join(wortel, 'build', 'bundel-test')
{
  stageer(doel)
  t('alles uit de inhoudslijst staat erin',
    INHOUD.bestanden.every((f) => fs.existsSync(path.join(doel, f))) &&
    INHOUD.mappen.every((m) => fs.existsSync(path.join(doel, m))))
  t('de licentie gaat mee, want een bundel zonder licentie mag niemand hergebruiken',
    fs.existsSync(path.join(doel, 'LICENSE')))
  t('het profiel gaat mee, anders valt de hele ladder weg bij een vreemde',
    fs.existsSync(path.join(doel, 'profiles', 'x402-deployed-ladder-v1.json')))
  t('onze eigen tests gaan NIET mee, die horen bij onze bewijslast en niet bij het draaien',
    !fs.existsSync(path.join(doel, 'test')))
  t('de bundel blijft klein', (() => {
    let bytes = 0
    const loop = (d) => { for (const i of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, i.name); if (i.isDirectory()) loop(p); else bytes += fs.statSync(p).size } }
    loop(doel)
    return bytes < 2 * 1024 * 1024
  })())

  // DE TEST DIE EEN VERGETEN BESTAND VANGT. Lees de echte relatieve imports van elk
  // .mjs in de bundel en eis dat het doel er ook in zit.
  const ontbreekt = []
  const scan = (map) => {
    for (const i of fs.readdirSync(map, { withFileTypes: true })) {
      const p = path.join(map, i.name)
      if (i.isDirectory()) { scan(p); continue }
      if (!i.name.endsWith('.mjs')) continue
      const bron = fs.readFileSync(p, 'utf8')
      for (const m of bron.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
        const doelBestand = path.resolve(path.dirname(p), m[1])
        if (!fs.existsSync(doelBestand)) ontbreekt.push(path.relative(doel, p) + ' -> ' + m[1])
      }
    }
  }
  scan(path.join(doel, 'src'))
  t('elk bestand waar de server naar verwijst zit ook in de bundel' + (ontbreekt.length ? ': ' + ontbreekt.join(', ') : ''),
    ontbreekt.length === 0)

  const uitslag = await bewijsDatDeBundelWerkt(doel, { wachtMs: 2000 })
  t('de bundel antwoordt op een echte initialize', uitslag.naam === 'agent-receipt-verify')
  t('en noemt het protocol dat wij beweren te spreken', uitslag.protocol === '2025-11-25')
  t('en geeft beide tools terug', uitslag.tools.sort().join(',') === 'check_x402_endpoint,link_receipt_to_settlement')

  fs.rmSync(path.join(wortel, 'build'), { recursive: true, force: true })
}

console.log(`\nbundel: ${groen} pass, ${rood} fail`)
process.exitCode = rood === 0 ? 0 : 1
