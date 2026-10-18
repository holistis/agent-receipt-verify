// De afrekening-vectoren, en de controles die ze eerlijk houden.
//
// WAAROM DEZE TEST MEER DOET DAN DE LOPER. De loper zegt of elke vector zijn eigen
// verwachting haalt. Dat is te makkelijk: een corpus waarin alles LINKED verwacht en
// alles LINKED teruggeeft, bewijst niets over de meter. Deze test toetst daarom ook de
// SAMENSTELLING van het corpus en de randen van de beoordelaar.
//
// DE DRIE DINGEN DIE HIER ECHT GETOETST WORDEN:
// 1. Het corpus heeft positieve EN negatieve gevallen, want een corpus zonder
//    tegenvoorbeelden meet alleen of de code iets teruggeeft.
// 2. Het onderscheid tussen NIET GELINKT en NIET GEMETEN, want dat is precies de
//    uitkomst die een woordenlijst met twee waarden niet kan uitdrukken en waardoor
//    een haperende RPC een geldig bonnetje zou weggooien.
// 3. Elk positief geval wordt opnieuw AFGELEID uit het ondertekende bonnetje, niet
//    overgeschreven. Een vector die zichzelf niet opent, is erger dan geen vector.

import { beoordeelVector, laadVectoren } from '../src/settlement-link-vectors.mjs'
import { berekenCommitment, opentCommitment, kentMethode } from '../src/x402-offer-receipt.mjs'

let goed = 0, fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const vectoren = laadVectoren()

console.log('het corpus zelf')
t('er zijn vectoren', vectoren.length >= 10, 'gevonden: ' + vectoren.length)
t('elke vector draagt requires_chain_read, want dat is wat gevraagd werd',
  vectoren.every((v) => typeof v.requires_chain_read === 'boolean'))
t('elke vector noemt zijn herkomst, inclusief dat 5.6 nog een voorstel is',
  vectoren.every((v) => Array.isArray(v.provenance) && v.provenance.some((p) => /3827|proposal|pull request/i.test(p))))
t('de meeste vectoren draaien zonder keten, anders kan niemand ze narekenen',
  vectoren.filter((v) => !v.requires_chain_read).length >= vectoren.length - 2)

const uitkomsten = new Set(vectoren.map((v) => v.expected.outcome))
t('het corpus bevat positieve EN negatieve gevallen', uitkomsten.has('LINKED') && uitkomsten.has('NOT_LINKED'),
  [...uitkomsten].join(', '))
t('en het geval dat niet gemeten kon worden, want dat is de derde uitkomst',
  uitkomsten.has('NOT_MEASURED'))

console.log('')
console.log('de loper tegen het corpus')
for (const v of vectoren) {
  const u = beoordeelVector(v)
  if (u.outcome === 'SKIPPED') {
    t(v.id + ' wordt overgeslagen en NIET afgekeurd, want hij vraagt een keten', v.requires_chain_read === true)
    continue
  }
  t(v.id + ' geeft ' + v.expected.outcome, u.outcome === v.expected.outcome, 'kreeg ' + u.outcome + ' ' + (u.reden ?? ''))
}

console.log('')
console.log('de randen van de beoordelaar, want daar gaat het mis')

{
  // Het verschil dat een haperende RPC gevaarlijk maakt.
  const basis = vectoren.find((v) => v.expected.outcome === 'LINKED' && v.input?.receipt && !v.requires_chain_read && Array.isArray(v.input.candidates))
  const geenLijst = { ...basis, input: { ...basis.input, candidates: null } }
  const legeLijst = { ...basis, input: { ...basis.input, candidates: [] } }
  t('geen kandidatenlijst VERKREGEN geeft NOT_MEASURED', beoordeelVector(geenLijst).outcome === 'NOT_MEASURED')
  t('een LEGE kandidatenlijst geeft NOT_LINKED, en dat is een ander ding',
    beoordeelVector(legeLijst).outcome === 'NOT_LINKED')
}

{
  // Een bonnetje van versie 1 draagt geen commitment. Dat is geen afkeuring.
  const basis = vectoren.find((v) => v.input?.receipt && !v.requires_chain_read && Array.isArray(v.input.candidates))
  const v1 = JSON.parse(JSON.stringify(basis))
  delete v1.input.receipt.payload.authorizationCommitment
  t('een bonnetje zonder commitment geeft NOT_MEASURED, niet NOT_LINKED',
    beoordeelVector(v1).outcome === 'NOT_MEASURED')
}

{
  // De uitkomst die praktisch onmogelijk hoort te zijn, maar wel benoembaar moet zijn.
  const basis = JSON.parse(JSON.stringify(vectoren.find((v) => v.expected.outcome === 'LINKED' && v.input?.receipt && !v.requires_chain_read && Array.isArray(v.input.candidates))))
  const k = basis.input.candidates[0]
  basis.input.candidates = [k, { ...k }]
  t('twee identieke kandidaten geeft AMBIGUOUS in plaats van stil de eerste pakken',
    beoordeelVector(basis).outcome === 'AMBIGUOUS')
}

console.log('')
console.log('elk positief geval is OPNIEUW AFGELEID uit het ondertekende bonnetje')
{
  let afgeleid = 0
  for (const v of vectoren) {
    if (v.expected.outcome !== 'LINKED' || !v.input?.receipt || v.requires_chain_read) continue
    const p = v.input.receipt.payload
    const k = (v.input.candidates ?? [])[0]
    if (!k) continue
    const her = berekenCommitment({
      method: p.authorizationMethod ?? 'eip3009',
      asset: v.input.asset,
      authorizer: k.authorizer,
      identifier: k.nonce,
      salt: v.input.authorizationSalt,
    })
    t(v.id + ': het commitment in het bonnetje is herberekenbaar uit de losse velden',
      String(her).toLowerCase() === String(p.authorizationCommitment).toLowerCase())
    afgeleid++
  }
  t('en dat gold voor minstens drie echte betalingen', afgeleid >= 3, 'afgeleid: ' + afgeleid)
}


console.log('')
console.log('de poorten op onze eigen code, na de keuring van 18 oktober')

// Elk geval hieronder is een gat dat op de GEPUBLICEERDE versie 0.2.3 open stond en in
// een eigen adversariele keuring is gemeten, niet beredeneerd.

{
  // De opzoeking van de methode raakte de prototypeketen. Vijf namen kwamen erdoor en
  // zetten daarmee elke lengtecontrole uit.
  for (const naam of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    let gegooid = false
    try {
      berekenCommitment({
        method: naam, asset: '0xaabb', authorizer: '0xcc',
        identifier: '0x' + '11'.repeat(32), salt: '0x' + '22'.repeat(32),
      })
    } catch { gegooid = true }
    t('"' + naam + '" uit de prototypeketen is geen methode', gegooid)
  }
  t('en eip3009 is dat nog steeds wel', kentMethode('eip3009'))
  t('en een onbekende naam niet', !kentMethode('telepathie'))
  t('en een niet-tekst niet', !kentMethode(42) && !kentMethode(null))
}
{
  // De botsing die daardoor mogelijk was, letterlijk uit de keuring. Twee verschillende
  // paren moeten nu allebei geweigerd worden in plaats van hetzelfde getal te geven.
  const id = '0x' + '11'.repeat(32)
  const salt = '0x' + '22'.repeat(32)
  const paren = [
    { asset: '0xaabb', authorizer: '0xcc' },
    { asset: '0xaa', authorizer: '0xbbcc' },
  ]
  let beideGeweigerd = true
  for (const pr of paren) {
    try { berekenCommitment({ method: 'eip3009', ...pr, identifier: id, salt }); beideGeweigerd = false } catch {}
  }
  t('de velden van de gemeten botsing worden nu op lengte geweigerd', beideGeweigerd)
}
{
  // En een lengte-eis die ontbreekt mag nooit stil "geen controle" betekenen.
  let gegooid = false
  try {
    berekenCommitment({
      method: 'eip3009', asset: '0x' + 'aa'.repeat(20), authorizer: '0x' + 'bb'.repeat(20),
      identifier: '0x11', salt: '0x' + '22'.repeat(32),
    })
  } catch { gegooid = true }
  t('een identifier van de verkeerde lengte wordt geweigerd', gegooid)
}
{
  // De opener moet het verschil tussen "niets te berekenen" en "geen treffer" tonen.
  const r = opentCommitment({
    receipt: { payload: { authorizationMethod: 'telepathie', authorizationCommitment: '0xdead', payer: '0xcc' } },
    salt: '0x' + '22'.repeat(32), asset: '0xaabb', kandidaatIdentifiers: ['0x' + '11'.repeat(32)],
  })
  t('een onbekende methode geeft NIET MEETBAAR, niet "geen kandidaat opent dit"',
    r.linked === false && r.meetbaar === false, JSON.stringify(r))
  t('en de reden noemt de methode', /unknown authorizationMethod/.test(r.reden ?? ''), r.reden ?? '')
}
{
  const r = opentCommitment({
    receipt: { payload: { authorizationMethod: 'eip3009', authorizationCommitment: '0xdead', payer: '0xcc' } },
    salt: '0x' + '22'.repeat(32), asset: '0xaabb', kandidaatIdentifiers: ['0x' + '11'.repeat(32)],
  })
  t('een onbruikbare payer geeft ook NIET MEETBAAR', r.meetbaar === false, JSON.stringify(r))
}

console.log('')
console.log('de loper valt niet om, en haalt LEEG niet door met AFWEZIG')

{
  // Dit is de ergste fout die deze loper kan maken, en hij stond open in de tak met
  // twee bonnetjes: een ONTBREKENDE kandidatenlijst werd een LEGE lijst.
  const v = {
    id: 'proef-afwezig',
    input: {
      receipts: [{
        asset: '0x' + 'aa'.repeat(20),
        authorizationSalt: '0x' + '22'.repeat(32),
        receipt: { payload: { authorizationMethod: 'eip3009', authorizationCommitment: '0xdead' } },
      }],
      candidates: null,
    },
  }
  const u = beoordeelVector(v)
  t('twee-bonnetjes met een afwezige lijst is NIET GEMETEN, geen afkeuring',
    u.outcome === 'NOT_MEASURED', u.outcome + ' ' + (u.reden ?? ''))
}
{
  const basis = {
    id: 'proef-leeg',
    input: {
      receipts: [{
        asset: '0x' + 'aa'.repeat(20),
        authorizationSalt: '0x' + '22'.repeat(32),
        receipt: { payload: { authorizationMethod: 'eip3009', authorizationCommitment: '0xdead' } },
      }],
      candidates: [],
    },
  }
  t('en met een LEGE lijst is het wel NIET GELINKT', beoordeelVector(basis).outcome === 'NOT_LINKED')
}
{
  for (const rommel of [42, 'lijst', {}, true]) {
    const u = beoordeelVector({
      id: 'proef-rommel',
      input: {
        receipt: { payload: { authorizationMethod: 'eip3009', authorizationCommitment: '0xdead' } },
        candidates: rommel,
      },
    })
    t('een kandidatenlijst van het type ' + typeof rommel + ' laat de loper niet klappen',
      u.outcome === 'NOT_MEASURED', u.outcome)
  }
}
{
  // Een veld van de verkeerde lengte mag EEN vector raken, nooit de hele ronde.
  let gegooid = false
  let u = null
  try {
    u = beoordeelVector({
      id: 'proef-kapotte-lengte',
      input: {
        receipt: { payload: { authorizationMethod: 'eip3009', authorizationCommitment: '0xdead' } },
        asset: '0xaa',
        authorizationSalt: '0x22',
        candidates: [{ authorizer: '0xcc', nonce: '0x11' }],
      },
    })
  } catch { gegooid = true }
  t('een vector met kapotte veldlengtes gooit niet', !gegooid)
  // BIJGESTELD, en de oude verwachting was fout. Deze vector heeft een kapot EIGEN asset
  // en zout, niet een kapotte kandidaat. Toen deze test werd geschreven gaf dat
  // NOT_LINKED, en dat is precies de fout die de tweede keuring aanwees: een stellige
  // afkeuring van de verkoper terwijl de onberekenbaarheid aan onze kant zat. NOT_MEASURED
  // is de juiste uitkomst, en deze regel legt dat nu vast in plaats van het omgekeerde.
  t('en levert NIET GEMETEN op, want de kapotte velden zijn de ONZE',
    u && u.outcome === 'NOT_MEASURED', u ? u.outcome : 'gegooid')
}
{
  // Een kandidaat die geen object is mag ook niets breken.
  const u = beoordeelVector({
    id: 'proef-kandidaat-null',
    input: {
      receipt: { payload: { authorizationMethod: 'eip3009', authorizationCommitment: '0xdead' } },
      asset: '0x' + 'aa'.repeat(20),
      authorizationSalt: '0x' + '22'.repeat(32),
      candidates: [null, 42, { authorizer: '0x' + 'bb'.repeat(20), nonce: '0x' + '11'.repeat(32) }],
    },
  })
  t('rommel tussen de kandidaten breekt niets', u.outcome === 'NOT_LINKED', u.outcome)
}
{
  const u = beoordeelVector({
    id: 'proef-bonnetje-zonder-payload',
    input: { receipts: [{ asset: '0x' + 'aa'.repeat(20) }], candidates: [] },
  })
  t('een bonnetje zonder payload is NIET GEMETEN', u.outcome === 'NOT_MEASURED', u.outcome)
}
console.log('')

console.log('')
console.log('de foutwaarde leeft NIET in de waarde-ruimte, want dat was mijn eigen gat')

// GEMETEN DOOR ONZE EIGEN TWEEDE KEURING, op de reparatie van diezelfde dag. De eerste
// versie gaf bij een onberekenbaar veld de TEKENREEKS 0x-niet-te-berekenen terug, en die
// werd daarna vergeleken met het commitment uit het bonnetje. Een bonnetje dat precies
// die tekst droeg kwam er als GELINKT uit, zonder dat er een byte cryptografie aan te pas
// kwam, op beide takken, met en zonder hoofdletters. Dit is exact het primitief dat
// diezelfde dag in onze eigen registry werd vastgelegd, en ik trapte er binnen een uur
// zelf in. Daarom staat de aanval hier als eerste testgeval.
{
  const vroegereSentinels = [
    '0x-niet-te-berekenen',
    '0X-NIET-TE-BEREKENEN',
    'null',
    'undefined',
    'NaN',
    '[object Object]',
    'false',
    '0',
  ]
  for (const kwaad of vroegereSentinels) {
    const enkel = beoordeelVector({
      id: 'proef-sentinel-enkel',
      input: {
        asset: '0x' + 'aa'.repeat(20),
        authorizationSalt: '0x' + 'bb'.repeat(32),
        receipt: { payload: { payer: '0x' + 'cc'.repeat(20), authorizationMethod: 'eip3009', authorizationCommitment: kwaad } },
        candidates: [{ authorizer: 'KAPOT', nonce: 'OOK-KAPOT' }],
      },
    })
    t('"' + kwaad + '" als commitment opent niets (enkel bonnetje)', enkel.outcome === 'NOT_LINKED', enkel.outcome)

    const twee = beoordeelVector({
      id: 'proef-sentinel-twee',
      input: {
        receipts: [{
          asset: '0x' + 'aa'.repeat(20),
          authorizationSalt: '0x' + 'bb'.repeat(32),
          receipt: { payload: { payer: '0x' + 'cc'.repeat(20), authorizationMethod: 'eip3009', authorizationCommitment: kwaad } },
        }],
        candidates: [{ authorizer: 'KAPOT', nonce: 'OOK-KAPOT' }],
      },
    })
    t('"' + kwaad + '" opent ook niets op de twee-bonnetjes-tak', twee.outcome === 'NOT_LINKED', twee.outcome)
  }
}
{
  // Een niet-tekstueel commitment mag ook nooit per ongeluk gelijk worden aan iets.
  for (const kwaad of [null, undefined, 0, false, {}, []]) {
    const u = beoordeelVector({
      id: 'proef-commitment-geen-tekst',
      input: {
        asset: '0x' + 'aa'.repeat(20),
        authorizationSalt: '0x' + 'bb'.repeat(32),
        receipt: { payload: { payer: '0x' + 'cc'.repeat(20), authorizationMethod: 'eip3009', authorizationCommitment: kwaad } },
        candidates: [{ authorizer: 'KAPOT', nonce: 'OOK-KAPOT' }],
      },
    })
    t('een commitment van het type ' + typeof kwaad + ' opent niets', u.outcome !== 'LINKED', u.outcome)
  }
}

console.log('')
console.log('een kapotte kandidaat laat de loper niet gooien, ook niet als hij matcht')

{
  // GEMETEN: de optionele toegang op authorizer liet een null-kandidaat de filter
  // overleven, en als die dan matchte knalde passend[0].nonce met een TypeError. De
  // koptekst van dit bestand belooft letterlijk dat deze loper niet gooit voor een
  // gewone uitkomst.
  let gegooid = false
  let u = null
  try {
    u = beoordeelVector({
      id: 'proef-kandidaat-null-matcht',
      input: {
        asset: '0x' + 'aa'.repeat(20),
        authorizationSalt: '0x' + 'bb'.repeat(32),
        receipt: { payload: { payer: '0x' + 'cc'.repeat(20), authorizationMethod: 'eip3009', authorizationCommitment: '0x-niet-te-berekenen' } },
        candidates: [null],
      },
    })
  } catch { gegooid = true }
  t('een null-kandidaat die de oude sentinel zou matchen gooit niet', !gegooid)
  t('en levert gewoon NIET GELINKT op', u && u.outcome === 'NOT_LINKED', u ? u.outcome : 'gegooid')
}
{
  const rommels = [null, undefined, 42, 'tekst', {}, { authorizer: 123, nonce: 456 }, { nonce: 'x' }]
  for (const rommel of rommels) {
    let gegooid = false
    try {
      beoordeelVector({
        id: 'proef-kandidaatzeef',
        input: {
          asset: '0x' + 'aa'.repeat(20),
          authorizationSalt: '0x' + 'bb'.repeat(32),
          receipt: { payload: { payer: '0x' + 'cc'.repeat(20), authorizationMethod: 'eip3009', authorizationCommitment: '0x' + 'dd'.repeat(32) } },
          candidates: [rommel],
        },
      })
    } catch { gegooid = true }
    t('een kandidaat van de vorm ' + JSON.stringify(rommel) + ' gooit niet', !gegooid)
  }
}

console.log('')
console.log('ONZE eigen kapotte velden geven NIET GEMETEN, geen stellige afkeuring')

{
  // GEMETEN: deze voorcontrole zat wel in opentCommitment en niet in beoordeelVector.
  // Dezelfde commit repareerde de ene functie en liet de andere staan. Gevolg: een zout
  // dat onze RPC verkeerd teruggaf leverde "geen enkele kandidaat opende dit commitment"
  // op, wat een uitspraak over de VERKOPER is terwijl de fout bij ons lag.
  const basis = (over) => ({
    id: 'proef-eigen-velden',
    input: {
      asset: '0x' + 'aa'.repeat(20),
      authorizationSalt: '0x' + 'bb'.repeat(32),
      receipt: { payload: { payer: '0x' + 'cc'.repeat(20), authorizationMethod: 'eip3009', authorizationCommitment: '0x' + 'dd'.repeat(32) } },
      candidates: [{ authorizer: '0x' + 'cc'.repeat(20), nonce: '0x' + 'ee'.repeat(32) }],
      ...over,
    },
  })
  const zoutKapot = beoordeelVector(basis({ authorizationSalt: 'rommel' }))
  t('een kapot eigen zout is NIET GEMETEN', zoutKapot.outcome === 'NOT_MEASURED', zoutKapot.outcome)
  t('en de reden zegt dat er niets te berekenen viel', /cannot compute/.test(zoutKapot.reden ?? ''), zoutKapot.reden ?? '')

  const assetKapot = beoordeelVector(basis({ asset: '0xaa' }))
  t('een kapot eigen asset is NIET GEMETEN', assetKapot.outcome === 'NOT_MEASURED', assetKapot.outcome)

  const zoutWeg = beoordeelVector(basis({ authorizationSalt: undefined }))
  t('een ontbrekend eigen zout is NIET GEMETEN', zoutWeg.outcome === 'NOT_MEASURED', zoutWeg.outcome)

  const twee = beoordeelVector({
    id: 'proef-eigen-velden-twee',
    input: {
      receipts: [{
        asset: '0x' + 'aa'.repeat(20),
        authorizationSalt: 'rommel',
        receipt: { payload: { payer: '0x' + 'cc'.repeat(20), authorizationMethod: 'eip3009', authorizationCommitment: '0x' + 'dd'.repeat(32) } },
      }],
      candidates: [{ authorizer: '0x' + 'cc'.repeat(20), nonce: '0x' + 'ee'.repeat(32) }],
    },
  })
  t('ook op de twee-bonnetjes-tak is dat NIET GEMETEN', twee.outcome === 'NOT_MEASURED', twee.outcome)

  // De controle die bewijst dat het werkende pad heel is gebleven.
  const echt = beoordeelVector(basis({}))
  t('en met goede eigen velden wordt er gewoon gerekend', echt.outcome === 'NOT_LINKED', echt.outcome)
}

console.log('settlement-link vectoren: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
