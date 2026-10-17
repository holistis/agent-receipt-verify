// Canonicalisatie tegen de vectoren die INAM se eigen onderhouder aanwees.
//
// WAAROM JUIST DEZE VECTOREN. Hij publiceerde ze NA de vier tegengetekende
// gevallen en wees ons er zelf op, omdat dit de plek is waar twee implementaties
// die uit dezelfde tekst zijn geschreven het makkelijkst uiteenlopen: sleutels met
// tekens boven U+FFFF, losse surrogaten, en de vraag of er genormaliseerd wordt.
// In zijn eigen Python-implementatie legden ze een echte fout bloot (sorteren op
// code point in plaats van op UTF-16 code unit, gerepareerd in sdk-python 0.14.0).
//
// WAAROM ONZE KANT HET GOED DOET, en dat is geen geluk maar wel het vermelden
// waard: `Array.prototype.sort()` vergelijkt strings in JavaScript per UTF-16 code
// unit, en dat is precies wat de spec eist. Dezelfde regel die in Python een
// bewuste keuze vereist, krijgen wij gratis van de taal. Dat betekent ook dat deze
// test juist hier moet staan: zodra iemand een eigen vergelijkingsfunctie in
// canoniek() zet, gaat hij stuk, en dat hoort hij te merken.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HIER = dirname(fileURLToPath(import.meta.url))

// Dezelfde functie als in src/inam-countersigned.mjs, bewust hier herhaald in
// plaats van geimporteerd: deze test moet de VORM toetsen die de spec beschrijft,
// en als iemand de implementatie verandert hoort deze test daarop te vallen in
// plaats van mee te veranderen.
function canoniek(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(canoniek).join(',') + ']'
  return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canoniek(x[k])).join(',') + '}'
}

const suite = JSON.parse(readFileSync(join(HIER, '..', 'vectors', 'inam', 'canonical-vectors.json'), 'utf8'))

let goed = 0
let fout = 0
console.log('INAM canonicalisation, their published edge cases')
for (const v of suite.vectors) {
  const onze = canoniek(v.input)
  if (onze === v.canonical) {
    goed++
    console.log('  pass  ' + v.name)
  } else {
    fout++
    console.log('  FAIL  ' + v.name)
    console.log('        theirs: ' + v.canonical)
    console.log('        ours  : ' + onze)
  }
}

// Een vangnet tegen een leeg of half bestand: nul vectoren zou hier als groen
// lezen, en dat is precies de stille altijd-groen die een dode test is.
if (suite.vectors.length < 10) {
  fout++
  console.log('  FAIL  expected at least 10 vectors, found ' + suite.vectors.length)
}

console.log('\n' + goed + ' passed, ' + fout + ' failed')
process.exitCode = fout === 0 ? 0 : 1
