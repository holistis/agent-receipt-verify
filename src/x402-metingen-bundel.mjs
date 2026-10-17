// Vouwt alle edities samen tot EEN platte lijst: welk eindpunt haalde welke trede,
// op welke datum, in welke editie.
//
// WAAROM DIT BESTAAT. Een badge die een operator op zijn eigen voordeur plakt, moet
// uit een VASTGELEGDE meting komen en nooit uit een live meting op het moment dat
// iemand de badge opvraagt. Twee redenen, en de tweede is de belangrijkste:
//  - live meten betekent dat iedereen onze server kan gebruiken om willekeurige
//    hosts af te tasten, op ons IP en in ons logboek. Dat is andermans rate limit
//    en niet de onze om weg te geven.
//  - een badge die bij elke pagina-weergave opnieuw meet, geeft bij elke storing
//    een andere uitslag. Een cijfer dat per minuut verandert is geen meting.
//
// De prijs daarvan is dat een badge kan VEROUDEREN, en daar is maar een eerlijk
// antwoord op: de datum staat IN de badge. Dan is een oude badge zichtbaar oud in
// plaats van stil verkeerd, en dat is precies het patroon dat ons eerder een
// publieke tekst heeft gekost die weken iets onwaars beweerde.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const WORTEL = resolve(import.meta.dirname, '..')

/** Alle editie-mappen, nieuwste eerst. Een map is een editie als hij een datum heet. */
export function editieMappen(basis = join(WORTEL, 'editions')) {
  if (!existsSync(basis)) return []
  return readdirSync(basis)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()
}

/**
 * Leest de live-metingen uit een editie.
 *
 * Een editie kan meerdere metingbestanden hebben, waarvan latere eerdere CORRIGEREN
 * (zoals de hermeting na een ladderwijziging). De later gelezen waarde wint daarom,
 * en de bestandsnaam waaruit een uitslag komt gaat mee in de bundel zodat niemand
 * hoeft te raden welke van de twee hij ziet.
 */
export function leesEditie(map) {
  const uit = new Map()
  const bestanden = ['liveness-payai.json', 'liveness-payai-na-ladderwijziging.json', 'liveness-payai-na-invoerfix.json']
  for (const naam of bestanden) {
    const pad = join(map, naam)
    if (!existsSync(pad)) continue
    let j
    try { j = JSON.parse(readFileSync(pad, 'utf8')) } catch { continue }
    for (const m of j.metingen ?? []) {
      const trede = m.hoogsteTrede
      if (typeof trede !== 'number') continue
      uit.set(m.url, { url: m.url, host: m.host, trede, uitBestand: naam })
    }
    // De CONTROLES zijn ook echte metingen, en ze ontbraken hier.
    //
    // Gevonden door de badge live na te kijken: ons EIGEN eindpunt kwam terug als
    // "niet gemeten", omdat het in die ronde de positieve controle was en controles
    // niet in de metinglijst stonden. Een meetlat die zijn eigen ijkpunt niet kan
    // tonen, is precies zo kapot als hij klinkt. Een controle krijgt wel een eigen
    // rol mee, zodat niemand later denkt dat hij uit de steekproef kwam.
    for (const c of j.controles ?? []) {
      if (typeof c.gemeten !== 'number' || !c.url) continue
      let host = null
      try { host = new URL(c.url).host } catch { host = null }
      uit.set(c.url, { url: c.url, host, trede: c.gemeten, uitBestand: naam, rol: 'controle' })
    }
  }
  return uit
}

export function bundel(basis = join(WORTEL, 'editions')) {
  const metingen = []
  const gezien = new Set()
  // Nieuwste editie eerst, en een eindpunt dat daar al in staat wordt niet door een
  // oudere editie overschreven: een badge hoort de MEEST RECENTE meting te tonen.
  for (const map of editieMappen(basis)) {
    for (const m of leesEditie(join(basis, map)).values()) {
      if (gezien.has(m.url)) continue
      gezien.add(m.url)
      metingen.push({ ...m, editie: map })
    }
  }
  return { gegenereerd: new Date().toISOString().slice(0, 10), aantal: metingen.length, metingen }
}

if (process.argv[1]?.endsWith('x402-metingen-bundel.mjs')) {
  const b = bundel()
  const uit = process.argv[2] ?? join(WORTEL, 'editions', 'metingen.json')
  writeFileSync(uit, JSON.stringify(b, null, 2))
  const perTrede = new Map()
  for (const m of b.metingen) perTrede.set(m.trede, (perTrede.get(m.trede) ?? 0) + 1)
  console.log('endpoints in the bundle: ' + b.aantal)
  for (const [t, n] of [...perTrede].sort((a, b2) => b2[0] - a[0])) {
    console.log('  ' + (t >= 0 ? 'L' + t : 'L-') + '  ' + n)
  }
  console.log('written: ' + uit)
}
