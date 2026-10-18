// De controleproef die NSPG13 vraagt op x402#3776, uitgevoerd in plaats van beschreven.
//
// ZIJN CORRECTIE, kort. De §5.5-tekst behandelt het hele verzonden artefact als de invoer
// van de handtekening. Dat klopt niet voor elk formaat: EIP-712 ondertekent getypeerde
// velden plus het domein, dus een andere sleutelvolgorde of andere witruimte laat het
// ondertekende bericht ONGEWIJZIGD terwijl een hash over de verzonden bytes wel verandert.
// Hij vraagt om drie namen uit elkaar te trekken: operatie-identiteit, de digest van het
// exact vastgelegde artefact, en de door het formaat ondertekende inhoud.
//
// Wij hebben die drie al als aparte bouwstenen, en deze toets bewijst dat ze op een ECHT
// EIP-712-record uit elkaar lopen zoals hij zegt. De negatieve controle hoort erbij: zonder
// een geval dat MOET falen, zou een controleur die alles goedkeurt hier ook groen scoren.

import fs from 'node:fs'
import { velddigest, bytedigest } from '../src/attempt-identity.mjs'
import { beoordeelAutorisatie } from '../src/eip3009-autorisatie.mjs'

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  [' + extra + ']' : '')) }
}

const basis = JSON.parse(fs.readFileSync(new URL('../vectors/kanon/valid-baseline-001.json', import.meta.url), 'utf8'))

// Dezelfde getypeerde velden, anders op de lijn gezet: sleutels omgekeerd en ingesprongen.
const omgekeerd = (o) => {
  if (Array.isArray(o)) return o.map(omgekeerd)
  if (o && typeof o === 'object') {
    const n = {}
    for (const k of Object.keys(o).reverse()) n[k] = omgekeerd(o[k])
    return n
  }
  return o
}

const A = JSON.stringify(basis.input)
const B = JSON.stringify(omgekeerd(basis.input), null, 4)
const ctx = { ...(basis.context ?? {}), doelNetwerk: basis.network }

const uA = await beoordeelAutorisatie(JSON.parse(A), ctx)
const uB = await beoordeelAutorisatie(JSON.parse(B), ctx)

// 1. De door het formaat ondertekende inhoud: gelijk, dus beide verifieren.
t('de verzonden vorm verifieert', uA.valid === true, uA.reason_code)
t('dezelfde velden anders geserialiseerd verifieren OOK', uB.valid === true, uB.reason_code)

// 2. De digest van het exact vastgelegde artefact: MOET verschillen.
t('de bytedigest van de twee vormen verschilt', bytedigest(A) !== bytedigest(B))

// 3. De operatie-identiteit: MOET gelijk zijn.
const vA = velddigest(JSON.parse(A))
const vB = velddigest(JSON.parse(B))
t('de velddigest van de twee vormen is gelijk', vA === vB)

// De drie zijn dus aantoonbaar DRIE dingen en geen een.
t('de velddigest is niet dezelfde waarde als de bytedigest', vA !== bytedigest(A))

// NEGATIEVE CONTROLE. Zonder dit bewijst het bovenstaande niets: een controleur die alles
// goedkeurt en een digest die altijd dezelfde waarde teruggeeft, zouden hierboven ook slagen.
const gewijzigd = JSON.parse(A)
gewijzigd.payload.authorization.value = String(BigInt(gewijzigd.payload.authorization.value) + 1n)
const uC = await beoordeelAutorisatie(gewijzigd, ctx)
t('CONTROLE: een gewijzigd getypeerd veld verifieert NIET meer', uC.valid === false, uC.reason_code)
t('CONTROLE: en de velddigest verandert daar wel van', velddigest(gewijzigd) !== vA)

console.log('')
console.log('drie-identiteiten: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
