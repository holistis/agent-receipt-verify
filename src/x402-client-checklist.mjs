// Checklist tegen x402-BETAAL-CLIENTS (SDK's, wallets, agent-betaalcode) -- niet
// tegen verkopers/facilitators, dat doen x402-conformance-check.mjs en
// x402-poortwachters.mjs al. Scant broncode op een vaste, kleine lijst patronen
// die we zelf al twee keer met de hand bevestigd hebben in echte, publieke
// projecten (google-agentic-commerce/a2a-x402, BlockRunAI/ClawRouter), zodat die
// handmatige lezing een herhaalbaar stuk gereedschap wordt.
//
// WAT HIER MET OPZET NIET GEBEURT. Dit is GEEN volledige statische analyse en
// GEEN vervanging van het zelf lezen en testen van code. Elke treffer is een
// KANDIDAAT om met de hand te verifieren, nooit een vastgesteld oordeel. Een
// lege uitslag betekent "geen van deze twee bekende patronen gezien", niet "dit
// bestand is veilig". De lijst patronen groeit alleen met een echt, bevestigd
// geval erbij (zie knowledge/denktank/to-do-doelwitten.jsonl voor kandidaten die
// nog geen bevestigd geval hebben, zoals Solana-instructie-discriminator-
// verwarring en SIWx-domain-binding: expres nog NIET in deze lijst).
//
// PATROON 1 -- ongebruikte-limietparameter. Een functie/methode accepteert een
// parameter die eruitziet als een uitgavelimiet (max_value, maxValue, spend_limit,
// budget, cap, ...) maar leest die identifier nergens in haar eigen lichaam.
// Bevestigd: google-agentic-commerce/a2a-x402, process_payment() in de
// betaal-signing-module (PyPI x402-a2a 0.1.0) -- accepteert max_value, tekent
// requirements.max_amount_required zonder ooit max_value te lezen.
//
// PATROON 2 -- opstart/herlaad-structurele-asymmetrie. Dezelfde eigen foutklasse
// wordt gevangen in zowel een initialisatie-vormige methode (constructor, load,
// init*) als een herlaad-vormige methode (reload*, refresh*, reinit*) van
// dezelfde klasse. Dat is geen bewijs van een fout -- de twee catch-blokken
// kunnen identiek goed zijn -- maar in het enige bevestigde geval verschilde het
// PRE-BESTAANDE STATUS op het moment van de fout (leeg bij opstart, al gevuld bij
// een herlaadbeurt), iets dat alleen een mens kan beoordelen door de klasse te
// lezen. Bevestigd: BlockRunAI/ClawRouter, SpendControl.load() (door de
// constructor aangeroepen) vs SpendControl.reloadLimits(), beide vangen
// UnreadableSpendPolicyError.

const LIMIET_PARAMETER_PATROON = /^(max[_-]?value|max[_-]?amount|spend[_-]?limit|spendlimit|budget|cap|ceiling|allowance)$/i

const INIT_VORMIGE_METHODE = /^(constructor|load|init\w*)$/i
const HERLAAD_VORMIGE_METHODE = /(reload|refresh|reinit|re_init)/i

/** Haalt de taal uit een bestandsnaam; alleen py/ts/js/mjs worden ondersteund. */
export function taalVanBestand(pad) {
  if (/\.py$/i.test(pad)) return 'py'
  if (/\.(ts|tsx|mts)$/i.test(pad)) return 'ts'
  if (/\.(js|jsx|mjs|cjs)$/i.test(pad)) return 'js'
  return null
}

/** Telt regelnummer (1-based) voor een index in een string. */
function regelVan(bron, index) {
  let regel = 1
  for (let i = 0; i < index && i < bron.length; i++) {
    if (bron[i] === '\n') regel++
  }
  return regel
}

/** Zoekt de index van de sluit-haak die bij de open-haak op `open` hoort. */
function vindMatchendeHaak(bron, open, openTeken, dichtTeken) {
  let diepte = 0
  for (let i = open; i < bron.length; i++) {
    if (bron[i] === openTeken) diepte++
    else if (bron[i] === dichtTeken) {
      diepte--
      if (diepte === 0) return i
    }
  }
  return -1
}

/**
 * Vindt functie/methode-blokken in brace-stijl code (TS/JS). Naief: geen
 * string/commentaar-bewuste haak-telling, geen pijl-functies, geen generics met
 * `<>` in de parameterlijst. Genoeg voor deze checklist, geen volledige parser.
 */
function vindFunctieBlokkenBraceStijl(bron) {
  const resultaten = []
  const sigPatroon =
    /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+)*(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(/g
  let m
  while ((m = sigPatroon.exec(bron))) {
    const naam = m[1]
    if (naam === 'if' || naam === 'for' || naam === 'while' || naam === 'switch' || naam === 'catch') continue
    const parenOpen = m.index + m[0].length - 1
    const parenDicht = vindMatchendeHaak(bron, parenOpen, '(', ')')
    if (parenDicht === -1) continue
    const paramsTekst = bron.slice(parenOpen + 1, parenDicht)
    // Na de sluit-paren mag een return-type-annotatie staan, dan moet een { volgen.
    const naParens = bron.slice(parenDicht + 1, parenDicht + 300)
    const accoladeMatch = naParens.match(/^\s*(?::\s*[^{;=]+)?\s*\{/)
    if (!accoladeMatch) continue
    const accoladeOpen = parenDicht + 1 + accoladeMatch[0].length - 1
    const accoladeDicht = vindMatchendeHaak(bron, accoladeOpen, '{', '}')
    if (accoladeDicht === -1) continue
    resultaten.push({
      naam,
      paramsTekst,
      lichaam: bron.slice(accoladeOpen + 1, accoladeDicht),
      beginRegel: regelVan(bron, m.index),
    })
  }
  return resultaten
}

/**
 * Vindt functie-blokken in Python (indentatie-gebaseerd). Ondersteunt een
 * parameterlijst die over meerdere regels loopt. Geneste `def` binnen een
 * functie wordt niet apart herkend als eigen blok met een kortere body (het
 * valt binnen de buitenste body, wat voor deze checklist geen probleem is: de
 * identifier-aanwezigheidscheck kijkt toch over de hele buitenste body).
 */
function vindFunctieBlokkenPython(bron) {
  const resultaten = []
  const regels = bron.split('\n')
  let regelIndex = 0
  let lopendeIndex = 0 // index in `bron` waar regels[regelIndex] begint
  const regelStartIndices = []
  {
    let idx = 0
    for (const r of regels) {
      regelStartIndices.push(idx)
      idx += r.length + 1
    }
  }
  const defPatroon = /^([ \t]*)def\s+([A-Za-z_]\w*)\s*\(/
  for (let i = 0; i < regels.length; i++) {
    const kop = regels[i].match(defPatroon)
    if (!kop) continue
    const inspringing = kop[1].length
    // Verzamel de (mogelijk meerregelige) parameterlijst door haakjes te tellen.
    let diepte = 0
    let paramsTekst = ''
    let j = i
    let gezienOpenHaak = false
    let kolomInRegel = kop[0].length
    outer: while (j < regels.length) {
      const regel = j === i ? regels[j].slice(kolomInRegel - 1) : regels[j]
      for (const ch of regel) {
        if (ch === '(') {
          diepte++
          gezienOpenHaak = true
          if (diepte === 1) continue
        } else if (ch === ')') {
          diepte--
          if (diepte === 0) break outer
        }
        if (gezienOpenHaak) paramsTekst += ch
      }
      paramsTekst += '\n'
      j++
    }
    // Vanaf regel j moet (na eventueel een return-type-annotatie) een `:` het
    // begin van de body markeren op dezelfde of een volgende regel.
    let kopEindeRegel = j
    const naSluitHaak = regels[j].slice(regels[j].indexOf(')') + 1)
    if (!/:\s*$/.test(naSluitHaak) && !/->/.test(naSluitHaak)) {
      // -> ReturnType: kan nog op dezelfde regel staan zonder dat die al met : eindigt
      // als dat zo is zoeken we verder naar de regel met alleen de sluitende ':'.
      while (kopEindeRegel < regels.length && !/:\s*$/.test(regels[kopEindeRegel])) kopEindeRegel++
    }
    const bodyStart = kopEindeRegel + 1
    let bodyEind = bodyStart
    while (bodyEind < regels.length) {
      const r = regels[bodyEind]
      if (r.trim() === '') {
        bodyEind++
        continue
      }
      const eigenInspringing = r.match(/^[ \t]*/)[0].length
      if (eigenInspringing <= inspringing) break
      bodyEind++
    }
    resultaten.push({
      naam: kop[2],
      paramsTekst,
      lichaam: regels.slice(bodyStart, bodyEind).join('\n'),
      beginRegel: i + 1,
    })
  }
  return resultaten
}

function vindFunctieBlokken(bron, taal) {
  if (taal === 'py') return vindFunctieBlokkenPython(bron)
  if (taal === 'ts' || taal === 'js') return vindFunctieBlokkenBraceStijl(bron)
  return []
}

/** Haalt kandidaat-parameternamen uit een parameterlijst-tekst (ruw, komma-gesplitst op topniveau). */
function parameterNamen(paramsTekst) {
  const namen = []
  let diepte = 0
  let huidig = ''
  const stukken = []
  for (const ch of paramsTekst) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') diepte++
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') diepte--
    if (ch === ',' && diepte === 0) {
      stukken.push(huidig)
      huidig = ''
    } else {
      huidig += ch
    }
  }
  if (huidig.trim()) stukken.push(huidig)
  for (const stuk of stukken) {
    const schoon = stuk.trim()
    if (!schoon) continue
    const naamMatch = schoon.match(/^\*{0,2}([A-Za-z_$][\w$]*)/)
    if (naamMatch) namen.push(naamMatch[1])
  }
  return namen
}

/**
 * PATROON 1. Geeft per gevonden functie-blok met een limiet-vormige parameter
 * die nergens in het lichaam voorkomt, een kandidaat-treffer terug.
 */
export function vindOngebruikteLimietParameter(bron, taal) {
  const treffers = []
  for (const blok of vindFunctieBlokken(bron, taal)) {
    const namen = parameterNamen(blok.paramsTekst)
    for (const naam of namen) {
      if (!LIMIET_PARAMETER_PATROON.test(naam)) continue
      const inLichaam = new RegExp(`\\b${naam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      if (!inLichaam.test(blok.lichaam)) {
        treffers.push({
          patroon: 'ongebruikte-limietparameter',
          functie: blok.naam,
          parameter: naam,
          regel: blok.beginRegel,
          toelichting: `${blok.naam}() accepteert \`${naam}\`, maar leest die identifier nergens in haar eigen lichaam. Mogelijk een geaccepteerde uitgavelimiet die nooit gecontroleerd wordt voor het tekenen/versturen.`,
        })
      }
    }
  }
  return treffers
}

/** Vindt alle `class X { ... }`-blokken (TS/JS, naief, geen string/commentaar-bewustzijn). */
function vindKlasseBlokken(bron) {
  const resultaten = []
  const patroon = /(?:^|\n)[ \t]*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/g
  let m
  while ((m = patroon.exec(bron))) {
    const open = m.index + m[0].length - 1
    const dicht = vindMatchendeHaak(bron, open, '{', '}')
    if (dicht === -1) continue
    resultaten.push({ naam: m[1], lichaam: bron.slice(open + 1, dicht), beginRegel: regelVan(bron, m.index) })
  }
  return resultaten
}

/**
 * PATROON 2. Binnen elke klasse: voor elke eigen foutklasse-achtige identifier
 * die in 2+ methoden gevangen wordt, kijkt of minstens een vangende methode
 * initialisatie-vormig heet en minstens een andere herlaad-vormig.
 */
export function vindOpstartHerlaadStructurAsymmetrie(bron, taal) {
  if (taal !== 'ts' && taal !== 'js') return []
  const treffers = []
  for (const klasse of vindKlasseBlokken(bron)) {
    const methoden = vindFunctieBlokkenBraceStijl(klasse.lichaam)
    const catchPerFout = new Map() // foutnaam -> Set(methodenaam)
    const catchPatroon = /\binstanceof\s+([A-Za-z_$][\w$]*)/g
    for (const methode of methoden) {
      let m
      const geziene = new Set()
      while ((m = catchPatroon.exec(methode.lichaam))) {
        const foutNaam = m[1]
        if (!/Error$/.test(foutNaam)) continue
        if (geziene.has(foutNaam)) continue
        geziene.add(foutNaam)
        if (!catchPerFout.has(foutNaam)) catchPerFout.set(foutNaam, new Set())
        catchPerFout.get(foutNaam).add(methode.naam)
      }
    }
    for (const [foutNaam, methodeNamen] of catchPerFout) {
      const lijst = [...methodeNamen]
      const heeftInit = lijst.some((n) => INIT_VORMIGE_METHODE.test(n))
      const herlaadNamen = lijst.filter((n) => HERLAAD_VORMIGE_METHODE.test(n))
      if (heeftInit && herlaadNamen.length > 0 && lijst.length >= 2) {
        treffers.push({
          patroon: 'opstart-herlaad-structurele-asymmetrie',
          klasse: klasse.naam,
          fout: foutNaam,
          methoden: lijst,
          regel: klasse.beginRegel,
          toelichting: `${foutNaam} wordt gevangen in zowel een initialisatie-vormige methode (${lijst
            .filter((n) => INIT_VORMIGE_METHODE.test(n))
            .join(', ')}) als een herlaad-vormige methode (${herlaadNamen.join(
            ', '
          )}) van ${klasse.naam}. Geen bewijs van een fout op zichzelf -- lees beide catch-blokken en vraag: kan de herlaad-methode draaien als er al echte status geladen is die de init-methode nooit had?`,
        })
      }
    }
  }
  return treffers
}

/** Scant een enkele bronbestand-tekst met beide patronen. */
export function scanBron(bron, pad) {
  const taal = taalVanBestand(pad)
  if (!taal) return []
  return [...vindOngebruikteLimietParameter(bron, taal), ...vindOpstartHerlaadStructurAsymmetrie(bron, taal)].map((t) => ({
    ...t,
    bestand: pad,
  }))
}

async function hoofd() {
  const { readFileSync } = await import('node:fs')
  const padArg = process.argv[2]
  if (!padArg) {
    console.error('Gebruik: node src/x402-client-checklist.mjs <bestand.py|.ts|.js>')
    process.exit(1)
  }
  const bron = readFileSync(padArg, 'utf8')
  const treffers = scanBron(bron, padArg)
  if (treffers.length === 0) {
    console.log(`Geen van de ${2} bekende patronen gezien in ${padArg}. Geen vastgesteld oordeel, alleen: deze twee niet gezien.`)
    return
  }
  for (const t of treffers) {
    console.log(`[${t.patroon}] ${t.bestand}:${t.regel} -- ${t.toelichting}`)
  }
}

const { pathToFileURL } = await import('node:url')
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  hoofd()
}
