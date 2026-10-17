// Het profiel inlezen en toetsen, zodat de ladder één waarheid heeft.
//
// WAAROM DIT BESTAAT. Onze ladder stond als data in een JavaScript-bestand. Dat is
// prima voor ons en onbruikbaar voor iedereen anders: een tweede implementatie kan
// een .mjs niet inlezen, en dus bleef onze meetlat opgesloten in onze eigen code.
// Precies die opsluiting is wat x402#3396 als probleem benoemt: gereedschappen
// coderen de regels in code, dus ze lopen uiteen en zijn het oneens over wat een
// gebrek is. Vanaf nu staat de ladder in profiles/x402-deployed-ladder-v1.json en
// leest deze code dat bestand. Verandert de ladder, dan verandert het bestand, en
// dan ziet een vreemde dat aan de versie en de datum.
//
// WAAROM EIGEN TOETSING EN GEEN JSON-SCHEMA-BIBLIOTHEEK. Dit project heeft geen
// verplichte afhankelijkheden en dat is een eigenschap, niet een gemis: een
// verifieerder die zelf een halve boom aan pakketten binnentrekt, vraagt vertrouwen
// in plaats van het te geven. Het schema in profiles/profile.schema.json is er voor
// een buitenstaander die wél een validator heeft. De controles hieronder dekken
// bovendien iets wat geen JSON-schema kan uitdrukken: de verbanden TUSSEN velden.

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const pad = (rel) => fileURLToPath(new URL(rel, import.meta.url))

export const PROFIEL_PAD = pad('../profiles/x402-deployed-ladder-v1.json')

/**
 * De verbanden die een JSON-schema niet kan uitdrukken, en die allemaal een keer
 * een echte fout zouden zijn geweest als niemand ze had gecontroleerd.
 *
 * Geeft een lijst klachten terug. Leeg is goed. Gooit niet: de aanroeper beslist of
 * een kapot profiel een harde fout is (bij ons: ja, zie onderaan dit bestand).
 */
export function toetsProfiel(p) {
  const klachten = []
  const zeg = (m) => klachten.push(m)

  if (!p || typeof p !== 'object') return ['het profiel is geen object']
  for (const veld of ['profile', 'version', 'published', 'intent', 'outcomes', 'specs', 'checks']) {
    if (p[veld] === undefined) zeg(`verplicht veld ontbreekt: ${veld}`)
  }
  if (!Array.isArray(p.checks) || p.checks.length === 0) return klachten.concat('checks is leeg of geen lijst')

  // Vier uitkomsten, niet drie. Drie is de fout die wij zelf maakten: dan valt
  // "wij hebben het niet geprobeerd" samen met "wij konden niet beslissen", en een
  // lezer kan een gat in de meter niet onderscheiden van een gebrek in het eindpunt.
  const verwachteUitkomsten = ['pass', 'fail', 'skip', 'inconclusive']
  const gegeven = Object.keys(p.outcomes ?? {}).sort()
  if (gegeven.join(',') !== verwachteUitkomsten.slice().sort().join(',')) {
    zeg(`outcomes moet exact ${verwachteUitkomsten.join(', ')} zijn, gevonden: ${gegeven.join(', ') || 'niets'}`)
  }

  // Elke gepinde spec moet compleet zijn, anders is een clausuleverwijzing een
  // verwijzing naar wat er vandaag staat.
  for (const [naam, s] of Object.entries(p.specs ?? {})) {
    for (const veld of ['repo', 'path', 'commit', 'state']) {
      if (!s?.[veld]) zeg(`spec ${naam} mist ${veld}`)
    }
    if (s?.state && !['merged on main', 'proposed, not merged'].includes(s.state)) {
      zeg(`spec ${naam} heeft een onbekende state: ${s.state}`)
    }
    // Een voorstel zonder PR-nummer is niet terug te vinden door een vreemde.
    if (s?.state === 'proposed, not merged' && typeof s.pullRequest !== 'number') {
      zeg(`spec ${naam} is een voorstel maar noemt geen pullRequest`)
    }
  }

  const ids = new Set(), keys = new Set(), niveaus = []
  for (const c of p.checks) {
    if (ids.has(c.id)) zeg(`dubbele check-id: ${c.id}`)
    ids.add(c.id)
    if (keys.has(c.key)) zeg(`dubbele check-key: ${c.key}`)
    keys.add(c.key)
    niveaus.push(c.level)

    if (!Array.isArray(c.clause) || c.clause.length === 0) zeg(`${c.id} heeft geen clausuleverwijzing`)
    for (const cl of c.clause ?? []) {
      if (!p.specs?.[cl.spec]) zeg(`${c.id} verwijst naar een onbekende spec: ${cl.spec}`)
      if (!cl.section || String(cl.section).length < 3) zeg(`${c.id} heeft een clausule zonder sectie`)
    }
    for (const rv of c.relatedVectors ?? []) {
      if (!p.relatedWork?.[rv.set]) zeg(`${c.id} verwijst naar een onbekende vectorset: ${rv.set}`)
    }
    if (!['skip', 'inconclusive'].includes(c.whenNotObservable)) {
      zeg(`${c.id} heeft een onbekende whenNotObservable: ${c.whenNotObservable}`)
    }
    if (!c.assertion?.evaluator || !c.assertion?.describes) zeg(`${c.id} mist evaluator of describes`)
    if (!['MUST', 'SHOULD'].includes(c.normative)) zeg(`${c.id} heeft een onbekende normative: ${c.normative}`)
    if (!c.input || typeof c.input.pays !== 'boolean') zeg(`${c.id} zegt niet of hij betaalt`)

    // DE INVARIANT DIE HET MEEST UITMAAKT. Een passief profiel mag een check die
    // een echte afrekening nodig heeft nooit als fail rapporteren: dat zou een
    // eindpunt afstraffen voor iets dat wij bewust niet hebben geprobeerd. Precies
    // deze regel staat als zin in onze CONFORMANCE.md en was tot nu toe nergens
    // mechanisch afgedwongen.
    if (c.input?.pays === true && c.whenNotObservable !== 'skip') {
      zeg(`${c.id} heeft een afrekening nodig maar valt niet terug op skip, dus een passieve run zou hem kunnen afkeuren`)
    }
    if (c.input?.pays === false && c.whenNotObservable === 'skip') {
      zeg(`${c.id} heeft geen afrekening nodig, dus skip is hier de verkeerde terugval: dit hoort inconclusive te zijn`)
    }
  }

  // Niveaus moeten 0 tot n zijn zonder gat: de hoogste-trede-regel loopt van onder
  // naar boven en stopt bij de eerste die niet haalt. Een gat zou die lus stil laten
  // stoppen op een trede die niemand heeft gemeten.
  const gesorteerd = niveaus.slice().sort((a, b) => a - b)
  for (let i = 0; i < gesorteerd.length; i++) {
    if (gesorteerd[i] !== i) { zeg(`niveaus lopen niet van 0 op zonder gat: ${gesorteerd.join(', ')}`); break }
  }
  for (let i = 1; i < niveaus.length; i++) {
    if (niveaus[i] <= niveaus[i - 1]) { zeg('checks staan niet op oplopend niveau in het bestand'); break }
  }

  return klachten
}

/** Laadt en toetst het profiel. Gooit bij een klacht, want een kapot profiel levert stil verkeerde metingen. */
export function laadProfiel(bestand = PROFIEL_PAD) {
  const p = JSON.parse(fs.readFileSync(bestand, 'utf8'))
  const klachten = toetsProfiel(p)
  if (klachten.length) throw new Error('profiel niet in orde:\n  ' + klachten.join('\n  '))
  return p
}

/**
 * De treden zoals de rest van deze codebase ze al jaren verwacht, nu AFGELEID uit
 * het profiel in plaats van ernaast geschreven. Bewust dezelfde veldnamen, zodat
 * geen enkele aanroeper hoeft te veranderen en de omzetting dus aantoonbaar niets
 * aan het gedrag verandert.
 */
export function tredenUitProfiel(p) {
  return p.checks.map((c) => ({
    sleutel: c.key,
    nummer: c.level,
    naam: c.name,
    eis: c.requirement,
    meetbaarZonderTeBetalen: c.input.pays === false,
    // Nieuw en alleen toegevoegd: waar deze trede vandaan komt, en of dat een
    // voorstel is. Daarmee kan een uitslag eerlijk zeggen tegen wat hij meet.
    profielId: c.id,
    clausule: c.clause.map((cl) => `${p.specs[cl.spec].path} §${cl.section}`),
    citeertVoorstel: c.clause.some((cl) => p.specs[cl.spec].state === 'proposed, not merged'),
    terugvalAlsNietTeZien: c.whenNotObservable,
  }))
}
