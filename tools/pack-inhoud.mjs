#!/usr/bin/env node
// Wat zit er ECHT in de tarball die een vreemde binnenhaalt?
//
// WAAROM DIT EEN APART BESTAND IS, en niet twee keer dezelfde regel. De vorm van
// `npm pack --dry-run --json` is tussen npm-versies VERANDERD, en wij hadden dezelfde
// aanname op twee plekken staan: in test/bundel.mjs en in de publicatie-workflow. Toen
// de workflow npm naar de nieuwste versie ging optillen, brak de ene en zou de andere
// kort erna op precies hetzelfde gebroken zijn. Een aanname die twee keer in de
// codebase staat, breekt twee keer.
//
// DE DRIE VORMEN DIE WIJ GEMETEN HEBBEN, op 2026-10-18:
//   npm 11.11.0       -> een ARRAY van een element, met `files`
//   npm@latest erna   -> een OBJECT met de PAKKETNAAM als sleutel, daarin `files`
//   en voor de hand liggend derde geval: een object dat zelf al `files` draagt
// Alle drie worden hier geaccepteerd. Een vierde, onbekende vorm levert geen lege lijst
// op maar een harde fout, want dat is het hele punt van dit bestand.
//
// WAAROM NIET-KUNNEN-METEN HIER HARD FAALT. Deze lijst bewaakt een licentieplicht: wij
// verspreiden testvectoren van drie andere projecten onder Apache-2.0, en die licentie
// eist dat het NOTICE-bestand meereist. Een stille "geen bestanden gevonden" zou de
// controle laten slagen terwijl de verplichting wordt geschonden. Een eerdere versie
// deed precies dat: twaalf controles verdwenen en de suite bleef groen, van 42 geslaagd
// naar 30, zonder dat iemand het zag.
//
// GEBRUIK:
//   node tools/pack-inhoud.mjs            een pad per regel op stdout
//   node tools/pack-inhoud.mjs --json     de kale lijst als json
// Exitcode 0 als er een lijst is, 1 als de inhoud niet te meten was.

import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORTEL = fileURLToPath(new URL('..', import.meta.url))

/**
 * Haal de bestandslijst uit wat npm pack teruggaf, ongeacht in welke van de bekende
 * vormen. Gooit een fout met de waargenomen vorm erin als geen enkele past, zodat de
 * volgende npm-wijziging een leesbare melding geeft in plaats van
 * "cannot read properties of undefined".
 */
export function lijstUitPackUitvoer(ruw) {
  let j
  try {
    j = typeof ruw === 'string' ? JSON.parse(ruw) : ruw
  } catch (e) {
    throw new Error('npm pack gaf geen json terug: ' + String(e.message).slice(0, 80))
  }

  const uitEntry = (e) => (e && Array.isArray(e.files) ? e.files.map((f) => f.path) : null)

  // Vorm 1: een array van entries (npm 11.11.0 en ouder).
  if (Array.isArray(j)) {
    const l = uitEntry(j[0])
    if (l) return l
    throw new Error('npm pack gaf een array van ' + j.length + ' zonder bruikbare files')
  }

  if (j && typeof j === 'object') {
    // Vorm 3: het object draagt zelf de lijst.
    const direct = uitEntry(j)
    if (direct) return direct

    // Vorm 2: een object met de pakketnaam als sleutel (nieuwere npm).
    for (const waarde of Object.values(j)) {
      const l = uitEntry(waarde)
      if (l) return l
    }
    throw new Error('npm pack gaf een object met sleutels [' + Object.keys(j).join(', ').slice(0, 80) + '] en nergens een files-lijst')
  }

  throw new Error('npm pack gaf een ' + typeof j + ', en dat is geen bekende vorm')
}

/** Draai npm pack in deze repo en geef de bestandslijst terug. */
export function pakInhoud({ cwd = WORTEL, draai = null } = {}) {
  // execSync en niet execFileSync: op Windows is npm een .cmd, wat execFileSync zonder
  // shell met EINVAL afwijst en kaal "npm" met ENOENT. execSync neemt een commandoregel
  // en is hiervoor bedoeld. Gevonden door alle drie te proberen.
  const uit = draai
    ? draai()
    : execSync('npm pack --dry-run --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd })
  return lijstUitPackUitvoer(uit)
}

const ditBestand = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ditBestand)) {
  try {
    const lijst = pakInhoud()
    if (process.argv.includes('--json')) console.log(JSON.stringify(lijst))
    else for (const p of lijst) console.log(p)
  } catch (e) {
    console.error('de pakketinhoud is ONGEMETEN: ' + e.message)
    process.exitCode = 1
  }
}
