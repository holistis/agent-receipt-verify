#!/usr/bin/env node
// Schrijft vectors/<suite>/SHA256SUMS voor alle vectorsuites die het pakket zelf controleert: een regel per vector, gesorteerd,
// hash over de bytes met CRLF naar LF. Draai dit na elke bewuste wijziging van een vectormap en commit het resultaat; de commando's
// attempt-identity, kanon, beleid, link-vectors en ground --vectors en de toets test/suite-integriteit.mjs vergelijken de mappen met deze lijsten.
// Het script zegt wat er veranderde (erbij, weg, gewijzigd) zodat een per ongeluk weggehaalde vector niet stilzwijgend wordt meeverzegeld.
// Gebruik: node scripts/seal-vectors.mjs [--check]     --check schrijft niets en faalt als een lijst niet klopt.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUITE_MAPPEN, maakHashlijst } from '../src/suite-integriteit.mjs'

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKSLASH = String.fromCharCode(92)
const CRLF = String.fromCharCode(13, 10)

const kaart = (tekst) => new Map(tekst.split(/\r?\n/).filter((r) => r.trim() && !r.startsWith('#')).map((r) => {
  const m = r.match(/^([0-9a-fA-F]{64}) [ *](.+)$/)
  return m ? [m[2], m[1].toLowerCase()] : [r, '']
}))

function verschil(oud, nieuw) {
  const o = kaart(oud)
  const n = kaart(nieuw)
  return {
    erbij: [...n.keys()].filter((k) => !o.has(k)),
    weg: [...o.keys()].filter((k) => !n.has(k)),
    gewijzigd: [...n.keys()].filter((k) => o.has(k) && o.get(k) !== n.get(k)),
  }
}

if (process.argv[1] && process.argv[1].split(BACKSLASH).join('/').endsWith('seal-vectors.mjs')) {
  const controle = process.argv.includes('--check')
  // Eerst alles berekenen, dan pas schrijven: een fout bij de derde map laat de eerste niet half herschreven achter.
  const werk = SUITE_MAPPEN.map((naam) => {
    const map = join(WORTEL, 'vectors', naam)
    const pad = join(map, 'SHA256SUMS')
    const lijst = maakHashlijst(map)
    const huidig = existsSync(pad) ? readFileSync(pad, 'utf8').split(CRLF).join('\n') : ''
    return { naam, pad, lijst, huidig, gelijk: huidig === lijst, v: verschil(huidig, lijst) }
  })
  let fout = 0
  for (const w of werk) {
    const aantal = w.lijst.split('\n').filter(Boolean).length
    const wijzigingen = ['erbij', 'weg', 'gewijzigd'].filter((k) => w.v[k].length).map((k) => k + ': ' + w.v[k].join(', ')).join('; ')
    if (controle) {
      if (!w.gelijk) fout++
      console.log((w.gelijk ? 'klopt     ' : 'KLOPT NIET ') + w.naam + (w.gelijk ? '' : ' (' + (wijzigingen || 'alleen opmaak') + ')'))
    } else if (w.gelijk) {
      console.log('ongewijzigd ' + w.naam + ' (' + aantal + ' vectoren)')
    } else {
      writeFileSync(w.pad + '.tmp', w.lijst)
      renameSync(w.pad + '.tmp', w.pad)
      console.log('geschreven  ' + w.naam + ' (' + aantal + ' vectoren)' + (wijzigingen ? ' | ' + wijzigingen : ''))
    }
  }
  if (controle) process.exit(fout === 0 ? 0 : 1)
}
