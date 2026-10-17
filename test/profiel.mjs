// Het profiel en zijn toetsing, in twee richtingen.
//
// Elke controle wordt zowel op een geldig als op een kapot profiel losgelaten. Een
// toetsing die alleen groen kan worden, staat stil groen en vangt nooit iets; dat is
// erger dan geen toetsing, want ze wekt zekerheid.

import { laadProfiel, toetsProfiel, tredenUitProfiel, PROFIEL_PAD } from '../src/profiel.mjs'
import fs from 'node:fs'

let groen = 0, rood = 0
const t = (naam, voorwaarde) => {
  if (voorwaarde) { groen++; console.log('  pass  ' + naam) } else { rood++; console.log('  FAIL  ' + naam) }
}
/** Een diepe kopie van het echte profiel, zodat elke kapot-test bij het echte bestand begint. */
const kopie = () => JSON.parse(fs.readFileSync(PROFIEL_PAD, 'utf8'))
/** Bevat de klachtenlijst iets over dit onderwerp. */
const klaagt = (p, stuk) => toetsProfiel(p).some((k) => k.includes(stuk))

console.log('profiel: het echte bestand')
{
  const p = laadProfiel()
  t('het bestand dat wij publiceren is zelf in orde', toetsProfiel(p).length === 0)
  t('het heeft een versie en een datum, anders is een gepubliceerd cijfer niet te herleiden',
    /^\d+\.\d+\.\d+$/.test(p.version) && /^\d{4}-\d{2}-\d{2}$/.test(p.published))
  t('het zegt ook wat het NIET meet', String(p.notMeasured || '').length > 40)
  t('zes checks, oplopend van 0', p.checks.length === 6 && p.checks.every((c, i) => c.level === i))
  t('elke check noemt minstens een clausule met sectie',
    p.checks.every((c) => c.clause.length > 0 && c.clause.every((cl) => cl.section.length >= 3)))
  t('elke clausule verwijst naar een spec die in het bestand gepind staat',
    p.checks.every((c) => c.clause.every((cl) => p.specs[cl.spec] && p.specs[cl.spec].commit)))
  t('de spec die nog een voorstel is, waarschuwt dat de nummers kunnen schuiven',
    String(p.specs['offer-receipt-commitment'].warning || '').length > 40)
  t('en noemt het pull-requestnummer, zodat een vreemde het kan terugvinden',
    p.specs['offer-receipt-commitment'].pullRequest === 3827)
}

console.log('\nde afgeleide treden houden de oude vorm')
{
  const p = laadProfiel()
  const treden = tredenUitProfiel(p)
  t('zes treden', treden.length === 6)
  t('de vijf velden die de rest van de code al gebruikte zijn er alle vijf',
    treden.every((x) => typeof x.sleutel === 'string' && typeof x.nummer === 'number' &&
      typeof x.naam === 'string' && typeof x.eis === 'string' && typeof x.meetbaarZonderTeBetalen === 'boolean'))
  t('drie zijn zonder betalen te zien en drie niet, net als voor de omzetting',
    treden.filter((x) => x.meetbaarZonderTeBetalen).length === 3)
  t('de sleutels zijn nog t0 tot t5, dus geen enkele aanroeper hoeft te veranderen',
    treden.map((x) => x.sleutel).join(',') === 't0,t1,t2,t3,t4,t5')
  t('alleen de treden die tegen het voorstel meten zijn als voorstel gemarkeerd',
    treden.filter((x) => x.citeertVoorstel).map((x) => x.sleutel).join(',') === 't4,t5')
  t('een trede die betalen nodig heeft valt terug op skip',
    treden.filter((x) => !x.meetbaarZonderTeBetalen).every((x) => x.terugvalAlsNietTeZien === 'skip'))
  t('een trede die zonder betalen te zien is valt terug op inconclusive',
    treden.filter((x) => x.meetbaarZonderTeBetalen).every((x) => x.terugvalAlsNietTeZien === 'inconclusive'))
}

console.log('\nde toetsing kan ook rood worden')
{
  let p = kopie(); delete p.outcomes.skip
  t('drie uitkomsten in plaats van vier is een klacht', klaagt(p, 'outcomes moet exact'))

  p = kopie(); p.outcomes.verzonnen = 'iets'
  t('een vijfde, verzonnen uitkomst is ook een klacht', klaagt(p, 'outcomes moet exact'))

  p = kopie(); p.checks[0].clause[0].spec = 'bestaat-niet'
  t('een clausule naar een onbekende spec wordt gevangen', klaagt(p, 'onbekende spec'))

  p = kopie(); p.checks[0].relatedVectors = [{ set: 'onbekende-set', id: 'X4-001' }]
  t('een verwijzing naar een onbekende vectorset wordt gevangen', klaagt(p, 'onbekende vectorset'))

  // De invariant die het meest uitmaakt: een passief profiel mag een check die een
  // echte afrekening nodig heeft nooit kunnen afkeuren.
  p = kopie(); p.checks[5].whenNotObservable = 'inconclusive'
  t('een betaal-check die niet op skip terugvalt is een klacht', klaagt(p, 'zou hem kunnen afkeuren'))

  p = kopie(); p.checks[0].whenNotObservable = 'skip'
  t('en omgekeerd: skip op een check die niets hoeft te betalen is ook fout', klaagt(p, 'verkeerde terugval'))

  p = kopie(); p.checks[2].level = 7
  t('een gat in de niveaus wordt gevangen, want de hoogste-trede-lus zou stil stoppen',
    klaagt(p, 'niveaus lopen niet van 0 op'))

  p = kopie(); p.checks[1].key = 't0'
  t('een dubbele sleutel wordt gevangen', klaagt(p, 'dubbele check-key'))

  p = kopie(); p.checks[1].id = 'ARV-L0'
  t('een dubbele id wordt gevangen', klaagt(p, 'dubbele check-id'))

  p = kopie(); delete p.specs['offer-receipt-commitment'].pullRequest
  t('een voorstel zonder pull-requestnummer is niet terug te vinden en dus een klacht',
    klaagt(p, 'noemt geen pullRequest'))

  p = kopie(); delete p.specs['x402-http-v2'].commit
  t('een spec zonder gepinde commit is een klacht', klaagt(p, 'mist commit'))

  p = kopie(); p.specs['x402-http-v2'].state = 'ongeveer wel goed'
  t('een onbekende spec-staat is een klacht', klaagt(p, 'onbekende state'))

  p = kopie(); p.checks[0].clause = []
  t('een check zonder clausule is een klacht', klaagt(p, 'geen clausuleverwijzing'))

  p = kopie(); p.checks[0].normative = 'MISSCHIEN'
  t('een onbekende normatieve sterkte is een klacht', klaagt(p, 'onbekende normative'))

  p = kopie(); delete p.checks[0].assertion.evaluator
  t('een check zonder evaluator is een klacht', klaagt(p, 'mist evaluator'))

  p = kopie(); delete p.checks[0].input.pays
  t('een check die niet zegt of hij betaalt is een klacht', klaagt(p, 'zegt niet of hij betaalt'))

  t('een leeg object geeft klachten en crasht niet', toetsProfiel({}).length > 0)
  t('null geeft een klacht en crasht niet', toetsProfiel(null).length === 1)
  t('laadProfiel GOOIT bij een kapot profiel, want stil doorgaan geeft verkeerde metingen', (() => {
    const tmp = PROFIEL_PAD + '.kapot-test.json'
    const p2 = kopie(); delete p2.outcomes.skip
    fs.writeFileSync(tmp, JSON.stringify(p2))
    try { laadProfiel(tmp); return false } catch { return true } finally { fs.unlinkSync(tmp) }
  })())
}

console.log('\nhet schema naast het profiel')
{
  const schema = JSON.parse(fs.readFileSync(new URL('../profiles/profile.schema.json', import.meta.url), 'utf8'))
  t('het schema is geldige json en noemt zich draft-07', schema.$schema.includes('draft-07'))
  t('het schema eist dezelfde vier uitkomsten als de toetsing',
    JSON.stringify(schema.properties.outcomes.required.slice().sort()) === JSON.stringify(['fail', 'inconclusive', 'pass', 'skip']))
  t('het schema eist een clausule per check',
    schema.properties.checks.items.required.includes('clause'))
}

console.log(`\nprofiel: ${groen} pass, ${rood} fail`)
process.exitCode = rood === 0 ? 0 : 1
