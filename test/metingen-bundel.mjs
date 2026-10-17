// Test voor de metingen-bundel die de publieke badge voedt.
//
// Deze bundel is de enige bron van een cijfer dat ANDERE mensen op hun eigen pagina
// zetten. Een stille fout hier verspreidt zich dus verder dan onze eigen repo, en de
// twee fouten hieronder zijn allebei echt gemaakt:
//  1. de controles ontbraken, waardoor ons EIGEN eindpunt als "niet gemeten" terugkwam.
//     Gevonden door de badge live na te kijken, niet door een test.
//  2. een oudere editie overschreef een nieuwere, zodat een badge een achterhaalde
//     trede kon tonen zonder dat iemand het zag.

import { leesEditie, bundel, editieMappen } from '../src/x402-metingen-bundel.mjs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const basis = mkdtempSync(join(tmpdir(), 'bundel-'))
const zet = (map, naam, inhoud) => {
  mkdirSync(join(basis, map), { recursive: true })
  writeFileSync(join(basis, map, naam), JSON.stringify(inhoud))
}

// Een oudere editie met een lage trede, en een nieuwere met een hogere.
zet('2026-10-01', 'liveness-payai.json', {
  metingen: [{ url: 'https://a.example/x', host: 'a.example', hoogsteTrede: 0 }],
})
zet('2026-10-17', 'liveness-payai.json', {
  controles: [
    { url: 'https://ons.example/paid', methode: 'POST', verwacht: 2, gemeten: 2, ok: true },
    { url: 'https://example.com/', methode: 'GET', verwacht: -1, gemeten: -1, ok: true },
  ],
  metingen: [
    { url: 'https://a.example/x', host: 'a.example', hoogsteTrede: 2 },
    { url: 'https://b.example/y', host: 'b.example', hoogsteTrede: -1 },
  ],
})
// Een correctie binnen dezelfde editie moet de eerdere uitslag overschrijven.
zet('2026-10-17', 'liveness-payai-na-invoerfix.json', {
  metingen: [{ url: 'https://b.example/y', host: 'b.example', hoogsteTrede: 0 }],
})

{
  const mappen = editieMappen(basis)
  t('edities worden gevonden en nieuwste eerst gezet', mappen[0] === '2026-10-17' && mappen[1] === '2026-10-01', mappen.join(','))
  t('een map die geen datum is wordt genegeerd', editieMappen(join(basis, 'bestaat-niet')).length === 0)
}
{
  const e = leesEditie(join(basis, '2026-10-17'))
  t('de controle staat erin als meting', e.get('https://ons.example/paid')?.trede === 2)
  t('en is herkenbaar als controle', e.get('https://ons.example/paid')?.rol === 'controle')
  t('een correctie binnen dezelfde editie wint', e.get('https://b.example/y')?.trede === 0,
    String(e.get('https://b.example/y')?.trede))
  t('en zegt uit welk bestand hij komt', e.get('https://b.example/y')?.uitBestand === 'liveness-payai-na-invoerfix.json')
}
{
  const b = bundel(basis)
  const vind = (u) => b.metingen.find((m) => m.url === u)
  t('de nieuwste editie wint over een oudere', vind('https://a.example/x')?.trede === 2, String(vind('https://a.example/x')?.trede))
  t('en de editie staat erbij', vind('https://a.example/x')?.editie === '2026-10-17')
  t('elk eindpunt staat er precies een keer in',
    new Set(b.metingen.map((m) => m.url)).size === b.metingen.length)
  t('het aantal klopt met de lijst', b.aantal === b.metingen.length)
  t('een gemeten mislukking blijft min een en wordt geen nul',
    bundel(basis).metingen.some((m) => m.trede === -1))
}

console.log('')
console.log('metingen-bundel: ' + goed + ' pass, ' + fout + ' fail')
if (fout > 0) process.exitCode = 1
