// Toets dat de serialisatie van de checker gelijk is aan RFC 8785, gemeten tegen een aparte implementatie.
//
// De checker schrijft wat hij hasht met een eigen, simpele functie (sleutels gesorteerd, geen witruimte: sorteerStabiel gevolgd
// door JSON.stringify) en schrijft bodies met een eigen canonicalizer (jcs). De README van de vectoren zegt dat de hashes in
// deze vectoren over de RFC 8785-vorm gaan. Deze toets maakt dat blijvend waar in plaats van eenmalig gemeten: hij vergelijkt
// elk opgeslagen object, en een lijst randgevallen, met het pakket canonicalize (een aparte RFC 8785-implementatie, devDependency).
//
// Een verschil is bekend en wordt hier vastgelegd in plaats van weggestopt: JavaScript somt eigenschapsnamen die op een geheel
// getal lijken ("9", "10") in getalvolgorde op, RFC 8785 sorteert ze als tekst. sorteerStabiel + JSON.stringify volgt daardoor
// de volgorde van JavaScript, jcs de volgorde van de RFC. Geen opgeslagen object heeft zulke namen; de toets zakt als dat
// verandert. De tripwire onderaan zakt zodra sorteerStabiel gerepareerd wordt, zodat de README dan ook wordt bijgewerkt.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import canonicalize from 'canonicalize'
import { sorteerStabiel } from '../src/attempt-identity.mjs'
import { jcs } from '../src/canonical-request.mjs'

const hier = path.dirname(fileURLToPath(import.meta.url))
const vectorMap = path.join(hier, '..', 'vectors', 'attempt-identity')

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) {
    goed++
  } else {
    fout++
    console.log('  ROOD   ' + naam + (extra ? '  <- ' + extra : ''))
  }
}

const eigen = (w) => JSON.stringify(sorteerStabiel(w))
const geheleSleutel = (k) => /^(0|[1-9][0-9]*)$/.test(k)

// 1. Elk opgeslagen object in de vectoren.
let bestanden = 0
let objecten = 0
let getallen = 0
const afwijkend = []
const geheleSleutels = []
const loop = (w, bestand) => {
  if (Array.isArray(w)) {
    for (const x of w) loop(x, bestand)
    return
  }
  if (w && typeof w === 'object') {
    objecten++
    const referentie = canonicalize(w)
    if (eigen(w) !== referentie) afwijkend.push(bestand + ' (sorteerStabiel)')
    if (jcs(w) !== referentie) afwijkend.push(bestand + ' (jcs)')
    if (Object.keys(w).some(geheleSleutel)) geheleSleutels.push(bestand)
    for (const v of Object.values(w)) loop(v, bestand)
  } else if (typeof w === 'number') {
    getallen++
  }
}
for (const f of fs.readdirSync(vectorMap).filter((x) => x.endsWith('.json'))) {
  bestanden++
  loop(JSON.parse(fs.readFileSync(path.join(vectorMap, f), 'utf8')), f)
}
t('er zijn vectoren om te vergelijken', bestanden > 0 && objecten > 0, `${bestanden} bestanden, ${objecten} objecten`)
t('elk opgeslagen object geeft dezelfde tekst als het aparte RFC 8785-pakket, in beide functies', afwijkend.length === 0, afwijkend.slice(0, 3).join(', '))
t('geen opgeslagen object heeft eigenschapsnamen die op een geheel getal lijken', geheleSleutels.length === 0, geheleSleutels.slice(0, 3).join(', '))

// 2. Randgevallen: getallen, tekst en sleutelvolgorde.
const randGetallen = [0, -0, 1, -1, 0.5, 0.1, 0.1 + 0.2, 1e21, 1e-7, 1e-6, 123456789012345680000, 5e-324, 1.7976931348623157e308, 2 ** 53, 2 ** 53 + 2, 4.35, 333333333.33333329, 1e300, 0.000001, 1e22, 1e23, -1e-7, 100, 1.5e-10, 9007199254740993]
const randTekst = ['', 'a', 'a\u0000b', '  ', '😀', 'é', 'tab\there', 'quote"back\\slash', '\u007f', '\u0080', '￿', 'caf%C3%A9&q=a', '</script>']
const randSleutels = [['b', 'a'], ['😀', '￿'], ['é', 'e'], ['', 'a'], ['A', 'a', 'B']]
const randWaarden = [
  ...randGetallen.flatMap((g) => [{ v: g }, [g, { z: g, a: [g] }]]),
  ...randTekst.map((s) => ({ s })),
  ...randSleutels.map((k) => Object.fromEntries(k.map((x, i) => [x, i]))),
]
const randAfwijkend = randWaarden.filter((w) => canonicalize(w) !== eigen(w) || canonicalize(w) !== jcs(w))
t(`${randWaarden.length} randgevallen (${randGetallen.length} getallen, tekst, sleutelvolgorde) geven dezelfde tekst in beide functies`, randAfwijkend.length === 0, randAfwijkend.slice(0, 2).map((w) => JSON.stringify(w)).join(' | '))

// 3. Het bekende verschil, vastgelegd.
const gehele = Object.fromEntries([['10', 0], ['9', 1], ['1', 2]])
t('jcs sorteert eigenschapsnamen als tekst, zoals RFC 8785', jcs(gehele) === canonicalize(gehele) && canonicalize(gehele) === '{"1":2,"10":0,"9":1}')
t('TRIPWIRE: sorteerStabiel volgt voor namen als "9" en "10" nog de getalvolgorde van JavaScript (zakt als dit gerepareerd wordt; werk dan de README bij)', eigen(gehele) === '{"1":2,"9":1,"10":0}', eigen(gehele))

console.log(`rfc8785-gelijk: ${objecten} objecten in ${bestanden} vectoren, ${getallen} getallen, ${randWaarden.length} randgevallen`)
console.log(`${goed} pass, ${fout} fail`)
process.exitCode = fout === 0 ? 0 : 1
