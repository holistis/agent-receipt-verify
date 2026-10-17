// Van de hosts die in een discovery-index STAAN, hoeveel antwoorden er vandaag
// werkelijk zoals x402 voorschrijft.
//
// WAAROM DEZE VRAAG, en niet de vraag waar de ladder voor gebouwd is. De census
// (x402-discovery-census.mjs) heeft op 2026-10-17 geteld dat nul van de 1127 hosts
// de offer-receipt-extensie declareert. Trede 1 tot 5 van de ladder hebben dus
// geen populatie. Een uitslag daarover zou een tabel met nullen zijn plus ons
// eigen eindpunt, en dat is geen meting maar een advertentie. Trede 0 heeft wel
// een populatie, en die vraag is nog door niemand gepubliceerd: een registratie
// in een index zegt niets over of het eindpunt nog leeft.
//
// DE STEEKPROEFREGEL STAAT HIER, zodat iemand anders exact dezelfde hosts kan
// natrekken en kan zien waar hij afwijkt:
//  1. Per host de resource met de LAAGSTE index-positie (de census bepaalt die).
//  2. Hosts gesorteerd op die positie, oplopend.
//  3. Daaruit elke n-de, met n zo gekozen dat de steekproef over de hele
//     registratievolgorde ligt. Niet de eerste N: die zijn van een handvol
//     partijen die vroeg massaal aanmeldden, en dat meet dan die partijen in
//     plaats van de index.
//  4. De methode die de partij ZELF declareert in de index. Blind POST sturen
//     laat een GET-route zakken op een 405 die niets over x402 zegt.
//
// TWEE CONTROLES, want een meting waarin alles faalt bewijst niet dat de
// werkelijkheid faalt, hij kan ook bewijzen dat het meetgereedschap kapot is:
//  - positief: een eindpunt waarvan wij weten dat het trede 2 haalt.
//  - negatief: een gewone pagina die niets met x402 doet.
// Gaan die twee niet zoals verwacht, dan is de uitslag ongeldig en zegt het
// script dat, in plaats van de cijfers alsnog op te leveren.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { meetEindpunt, hoogsteTrede } from './x402-conformance-check.mjs'

const POSITIEVE_CONTROLE = { url: 'https://api.tokenizen.nl/api/paid/verify-ownership', methode: 'POST', verwacht: 2 }
const NEGATIEVE_CONTROLE = { url: 'https://example.com/', methode: 'GET', verwacht: -1 }

const slaap = (ms) => new Promise((r) => setTimeout(r, ms))

/** Stap 1 tot 3 van de steekproefregel hierboven, puur rekenwerk, geen netwerk. */
export function kiesSteekproef(operators, aantal) {
  const opPositie = [...operators].sort((a, b) => a.eersteOffset - b.eersteOffset)
  if (aantal >= opPositie.length) return opPositie
  const stap = opPositie.length / aantal
  const uit = []
  for (let i = 0; i < aantal; i++) uit.push(opPositie[Math.floor(i * stap)])
  return uit
}

/**
 * Verdeelt een meting in emmers die NIET door elkaar lopen.
 *
 * Het verschil tussen "doet geen x402" en "wees mijn verzoek af voor het ooit bij
 * de betaalmuur kwam" is echt, en een meting die beide als mislukking telt is met
 * een enkele controle onderuit te halen. Een correcte implementatie geeft zijn
 * 402 voor hij een lichaam valideert; niet iedereen doet dat.
 */
export function emmer(meting) {
  const trede = hoogsteTrede(meting)
  if (trede >= 0) return 'x402_ok'
  const s = meting.bewijs?.status
  if (s == null) return 'onbereikbaar'
  if (s === 402) return 'status_402_onbruikbaar'
  if (s === 401 || s === 403) return 'afgeschermd'
  if (s === 404 || s === 410) return 'pad_weg'
  if (s === 405) return 'methode_geweigerd'
  if (s === 429) return 'tempo_geweigerd'
  if (s >= 400 && s < 500) return 'verzoek_geweigerd'
  if (s >= 500) return 'serverfout'
  return 'geen_betaalmuur'
}

export async function meetSteekproef(gekozen, { pauzeMs = 1200, fetchImpl = fetch } = {}) {
  const uit = []
  for (const o of gekozen) {
    const methode = o.eersteMethode ?? 'POST'
    const m = await meetEindpunt(o.eersteResource, { methode, fetchImpl })
    uit.push({
      host: o.host,
      url: o.eersteResource,
      indexPositie: o.eersteOffset,
      registratiesVanDezeHost: o.aantalRegistraties,
      gedeclareerdeMethode: o.eersteMethode,
      gebruikteMethode: methode,
      status: m.bewijs?.status ?? null,
      hoogsteTrede: hoogsteTrede(m),
      emmer: emmer(m),
      treden: m.treden,
      bewijs: m.bewijs,
    })
    if (pauzeMs) await slaap(pauzeMs)
  }
  return uit
}

if (process.argv[1]?.endsWith('x402-index-liveness.mjs')) {
  const censusPad = process.argv[2]
  const aantal = Number(process.argv[3] ?? 50)
  const uitPad = process.argv[4]
  if (!censusPad) {
    console.log('usage: node src/x402-index-liveness.mjs <census.json> [sample size] [out.json]')
    process.exitCode = 2
  } else {
    const census = JSON.parse(readFileSync(censusPad, 'utf8'))
    const gekozen = kiesSteekproef(census.operators, aantal)

    console.log('--- controls first, because a sweep where everything fails proves nothing ---')
    const controles = []
    for (const c of [POSITIEVE_CONTROLE, NEGATIEVE_CONTROLE]) {
      const m = await meetEindpunt(c.url, { methode: c.methode })
      const t = hoogsteTrede(m)
      const ok = t === c.verwacht
      controles.push({ ...c, gemeten: t, emmer: emmer(m), status: m.bewijs?.status ?? null, ok })
      console.log((ok ? '  ok   ' : '  FAIL ') + c.url + '  expected L' + c.verwacht + ', measured L' + t)
      await slaap(1200)
    }
    const controlesGoed = controles.every((c) => c.ok)
    if (!controlesGoed) {
      console.log('')
      console.log('The harness did not behave as expected on the controls. Treat the numbers below')
      console.log('as invalid until that is explained. A measurement you cannot trust on a known')
      console.log('case tells you nothing about the unknown ones.')
    }

    console.log('')
    console.log('--- sample: ' + gekozen.length + ' of ' + census.operators.length + ' hosts ---')
    const metingen = await meetSteekproef(gekozen)

    const tel = new Map()
    for (const m of metingen) tel.set(m.emmer, (tel.get(m.emmer) ?? 0) + 1)
    for (const m of metingen) {
      console.log(
        (m.hoogsteTrede >= 0 ? 'L' + m.hoogsteTrede : '--') +
        '  ' + String(m.status ?? '---').padStart(3) +
        '  ' + m.emmer.padEnd(22) +
        '  ' + m.host
      )
    }
    console.log('')
    for (const [k, v] of [...tel].sort((a, b) => b[1] - a[1])) {
      console.log('  ' + String(v).padStart(4) + '  ' + k + '  (' + ((v / metingen.length) * 100).toFixed(1) + '%)')
    }
    const ok = metingen.filter((m) => m.hoogsteTrede >= 0).length
    console.log('')
    console.log('  ' + ok + ' of ' + metingen.length + ' sampled hosts answer the way x402 says (level 0)')
    console.log('  levels 1 to 5 are not reported here: the census found 0 of ' + census.operators.length +
      ' hosts declaring the offer-receipt extension, so there is no population to measure')

    if (uitPad) {
      mkdirSync(dirname(uitPad), { recursive: true })
      writeFileSync(uitPad, JSON.stringify({
        bron: census.bron,
        steekproefregel: 'per host the resource with the lowest index position; hosts sorted by that position ascending; every nth taken so the sample spans the whole registration order; the method each party declares in the index',
        hostsInCensus: census.operators.length,
        steekproefGrootte: metingen.length,
        controles,
        controlesGoed,
        emmers: Object.fromEntries(tel),
        metingen,
      }, null, 2))
      console.log('')
      console.log('written: ' + uitPad)
    }
  }
}
