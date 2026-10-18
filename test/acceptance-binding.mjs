// Test voor de binding tussen bonnetje en acceptatierecord.
//
// De gevallen gaan over de manieren waarop juist deze koppeling scheef gaat:
//  1. twee bewijsstukken die netjes ondertekend zijn maar over een ander bestand gaan.
//  2. een record waarvan de controleur ook de producent is, dus zelfbeoordeling.
//  3. een record waarvan de onafhankelijkheid alleen ZELFVERKLAARD is, en dus niet door
//     een derde na te rekenen. Dat is iets anders dan fout, en het verschil is de kern.
//  4. criteria die pas na de toets zijn vastgelegd, dus achteraf naar de uitslag geschreven.
//  5. een belofte die met een nonce wordt vergeleken, wat de reden is dat het formaat
//     twee aparte sleutels heeft.
//  6. een ontbrekend veld dat als afkeuring wordt gelezen in plaats van als niet gemeten.
//
// En de belangrijkste van allemaal staat als eerste: de POSITIEVE controle. Een set die
// alleen maar afkeuringen bevat bewijst niet dat het harnas werkt, alleen dat het nee zegt.
//
// Elke vector op schijf wordt ook echt gedraaid. Een vector die niet gedraaid wordt is
// documentatie, geen toets.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  koppelAcceptatie,
  recordTelt,
  bindingMeetbaar,
  onafhankelijkheid,
  leesRecord,
  ONAFHANKELIJKHEID,
  VERIFIEERBAAR_ONAFHANKELIJK_VEROUDERD,
  UITKOMSTEN,
} from '../src/acceptance-binding.mjs'

const hier = path.dirname(fileURLToPath(import.meta.url))
const vectorMap = path.join(hier, '..', 'vectors', 'acceptance-binding')

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) {
    goed++
    console.log('  groen  ' + naam)
  } else {
    fout++
    console.log('  ROOD   ' + naam + (extra ? '  <- ' + extra : ''))
  }
}

// Een kern-record in de ECHTE vorm, zodat elke losse toets hieronder op de vorm werkt die
// de uitgever daadwerkelijk uitgeeft en niet op een vorm die wij verzonnen hebben.
const LEVERING = '9c27eee03d50f4ff00fb60a1551a03d7311dbed257b7b943b3ff5d13eb30c083'
const BONHASH = '4c7273afcdb5333586b0a41c4238a968f3dedc23f66f71c5a1928ff3d279ab3d'
const NONCE = '0x43457c8e57b7c4ff92d716350c61c88c8f3b644d09d7c813d5a7ee6450a843da'
const COMMITMENT = '0xe04421456465df1012f416b72aece3401f9e3d5be5bd78280324a031efe1d40f'

const echteVorm = (aanpassen = (x) => x) =>
  aanpassen({
    record: {
      receipt: {
        schema: 'trilatic.acceptance-receipt/1.2',
        issued_utc: '2026-10-18T00:52:09Z',
        criteria: { committed_at: '2026-10-18T00:52:03Z' },
        files: { remediated: { sha256: LEVERING } },
        parties: {
          checker: { name: 'invinoveritas', key_id: 'invinoveritas-checker-a4cecab2' },
          producer: { name: 'Example Vendor', key_id: 'example-vendor-producer-7f31aa02' },
        },
        independence: 'independent',
      },
    },
    bindings_sidecar: { receipt_sha256: BONHASH, bindings: {} },
  })

console.log('elke vector op schijf wordt echt gedraaid')
{
  const bestanden = fs.readdirSync(vectorMap).filter((b) => b.endsWith('.json')).sort()
  t('er staan vectoren op schijf', bestanden.length >= 5, String(bestanden.length))
  let alleGoed = 0
  for (const b of bestanden) {
    const v = JSON.parse(fs.readFileSync(path.join(vectorMap, b), 'utf8'))
    const u = koppelAcceptatie(v.input)
    const e = v.expected
    const past =
      u.reason_code === e.reason_code &&
      (e.valid === undefined || u.valid === e.valid) &&
      (e.detail === undefined || u.detail === e.detail) &&
      (e.independence === undefined || u.independence === e.independence) &&
      (e.compared === undefined || JSON.stringify(u.compared) === JSON.stringify(e.compared))
    if (past) alleGoed++
    t('vector ' + b + ' geeft ' + e.reason_code, past, u.reason_code + ' ' + (u.detail || ''))
  }
  t('alle vectoren geven hun verwachte uitkomst', alleGoed === bestanden.length, alleGoed + ' van ' + bestanden.length)

  // Een vector zonder herkomst en zonder grenzen is een bewering, geen bewijsstuk.
  const zonderHerkomst = bestanden.filter((b) => {
    const v = JSON.parse(fs.readFileSync(path.join(vectorMap, b), 'utf8'))
    return !Array.isArray(v.provenance) || v.provenance.length === 0 || !Array.isArray(v.limits) || v.limits.length === 0
  })
  t('elke vector noemt zijn herkomst en zijn grenzen', zonderHerkomst.length === 0, zonderHerkomst.join(', '))

  // De positieve controle MOET erin zitten, anders bewijst de set niets.
  const positief = bestanden.filter((b) => JSON.parse(fs.readFileSync(path.join(vectorMap, b), 'utf8')).expected.reason_code === 'LINKED')
  t('er is minstens een positieve controle', positief.length >= 1, String(positief.length))
}

console.log('de echte vorm en de vlakke vorm komen op dezelfde velden uit')
{
  const r = leesRecord(echteVorm())
  t('de levering komt uit het ondertekende record', r.acceptatieLevering === LEVERING, String(r.acceptatieLevering))
  t('de bonhash komt bovenin de sidecar', r.sidecarBonHash === BONHASH)
  t('het toetstijdstip komt uit issued_utc', r.getoetstOp === '2026-10-18T00:52:09Z')
  t('de controleur wordt op key_id gelezen', r.controleur.naamruimte === 'key_id')

  const plat = leesRecord({
    acceptance: { deliverable_sha256: LEVERING, checker: 'a', producer: 'b', criteria_committed_at: '2026-01-01T00:00:00Z', checked_at: '2026-01-01T00:00:05Z' },
    bindings: { receipt_sha256: BONHASH, deliverable_sha256: LEVERING },
  })
  t('de vlakke vorm levert dezelfde levering', plat.acceptatieLevering === LEVERING)
  t('de vlakke vorm levert dezelfde bonhash', plat.sidecarBonHash === BONHASH)
  t('een onbekend document geeft overal null, geen gok', leesRecord(null).acceptatieLevering === null)
}

console.log('onafhankelijkheid is een drieweg, geen ja of nee')
{
  t('de vijf staten staan vast', ONAFHANKELIJKHEID.length === 5 && ONAFHANKELIJKHEID.includes('ZELFVERKLAARD_ONVERIFIEERBAAR'))

    // Deze test zei eerder "verifieerbaar" en dat was de overclaim zelf. Twee verschillende
  // key_ids bewijzen dat de LABELS verschillen; dat de producent zijn sleutel bezit, bewijst
  // niets in dit record, want 1.2 draagt geen producent-handtekening.
  t('twee verschillende key_ids: alleen de labels verschillen', onafhankelijkheid(echteVorm()).staat === 'LABELS_VERSCHILLEN')
  t('en het zegt wat ontbreekt', onafhankelijkheid(echteVorm()).ontbreekt === 'producent-handtekening')
  t('de sterkste toestand is vandaag onbereikbaar', ONAFHANKELIJKHEID[0] === 'BEWEZEN_ONAFHANKELIJK')
  t('vijf toestanden', ONAFHANKELIJKHEID.length === 5)
  t('de oude naam blijft bestaan voor wie hem importeert', VERIFIEERBAAR_ONAFHANKELIJK_VEROUDERD === 'LABELS_VERSCHILLEN')

  const zelf = echteVorm((d) => {
    d.record.receipt.parties.producer.key_id = 'invinoveritas-checker-a4cecab2'
    return d
  })
  t('hetzelfde key_id: niet onafhankelijk', onafhankelijkheid(zelf).staat === 'NIET_ONAFHANKELIJK')

  // Dit is het ECHTE geval uit het live record van 18 oktober 2026.
  const scheef = echteVorm((d) => {
    d.record.receipt.parties.producer.key_id = null
    return d
  })
  const o = onafhankelijkheid(scheef)
  t('een key_id tegen een weergavenaam is GEEN vergelijking', o.staat === 'ZELFVERKLAARD_ONVERIFIEERBAAR', o.staat)
  t('en de reden benoemt de twee soorten namen', /verschillende soorten namen/.test(o.reden), o.reden)

  const geenVerklaring = echteVorm((d) => {
    d.record.receipt.parties.producer.key_id = null
    d.record.receipt.independence = null
    return d
  })
  t('zonder zelfverklaring is het gewoon ONBEKEND', onafhankelijkheid(geenVerklaring).staat === 'ONBEKEND')

  t('niemand benoemd is ONBEKEND', onafhankelijkheid({}).staat === 'ONBEKEND')

  // Hoofdletters mogen het oordeel nooit bepalen.
  const hoofdletters = echteVorm((d) => {
    d.record.receipt.parties.producer.key_id = 'INVINOVERITAS-CHECKER-A4CECAB2'
    return d
  })
  t('hoofdletters maken van zelfbeoordeling geen onafhankelijkheid', onafhankelijkheid(hoofdletters).staat === 'NIET_ONAFHANKELIJK')
}

console.log('de twee voorwaarden van de uitgever, met het onderscheid tussen mis en ongemeten')
{
  t('een goed record telt', recordTelt(echteVorm()).telt === true)

  const zelf = echteVorm((d) => {
    d.record.receipt.parties.producer.key_id = 'invinoveritas-checker-a4cecab2'
    return d
  })
  const z = recordTelt(zelf)
  t('zelfbeoordeling is MIS en dus meetbaar', z.telt === false && z.meetbaar === true && z.reden === 'CHECKER_IS_PRODUCER')

  const scheef = echteVorm((d) => {
    d.record.receipt.parties.producer.key_id = null
    return d
  })
  const s = recordTelt(scheef)
  t('onverifieerbare onafhankelijkheid is ONGEMETEN, geen afkeuring', s.telt === false && s.meetbaar === false && s.reden === 'INDEPENDENCE_NOT_VERIFIABLE')

  const naAchteraf = echteVorm((d) => {
    d.record.receipt.criteria.committed_at = '2026-10-18T00:52:30Z'
    return d
  })
  const n = recordTelt(naAchteraf)
  t('criteria na de toets is MIS en meetbaar', n.telt === false && n.meetbaar === true && n.reden === 'CRITERIA_NOT_COMMITTED_FIRST')

  const gelijk = echteVorm((d) => {
    d.record.receipt.criteria.committed_at = d.record.receipt.issued_utc
    return d
  })
  t('precies hetzelfde tijdstip telt niet als eerst vastgelegd', recordTelt(gelijk).reden === 'CRITERIA_NOT_COMMITTED_FIRST')

  const geenTijd = echteVorm((d) => {
    d.record.receipt.criteria.committed_at = null
    return d
  })
  const g = recordTelt(geenTijd)
  t('een ontbrekend tijdstip is ongemeten, geen afkeuring', g.meetbaar === false && g.reden === 'CRITERIA_TIMING_UNKNOWN')
}

console.log('de meetbaarheid van de binding zelf')
{
  t('een volledig record is meetbaar', bindingMeetbaar(echteVorm()).meetbaar === true)
  const geenBonhash = echteVorm((d) => {
    d.bindings_sidecar.receipt_sha256 = null
    return d
  })
  const m = bindingMeetbaar(geenBonhash)
  t('zonder bonhash in de sidecar is het niet meetbaar', m.meetbaar === false && m.mist.includes('sidecar.receipt_sha256'))
  const geenLevering = echteVorm((d) => {
    d.record.receipt.files.remediated.sha256 = 'geen-hash'
    return d
  })
  t('een hash die geen hash is telt als ontbrekend', bindingMeetbaar(geenLevering).meetbaar === false)
}

console.log('de twee x402-sleutels worden ELK met hun eigen tegenhanger vergeleken')
{
  const metSleutels = (bindings) =>
    echteVorm((d) => {
      d.bindings_sidecar.bindings = bindings
      return d
    })
  const bon = { format: 'eip712', authorizationNonce: NONCE, authorizationCommitment: COMMITMENT }

  const goedPaar = koppelAcceptatie({
    doc: metSleutels({ x402_receipt_commitment: COMMITMENT, x402_authorization_nonce: NONCE }),
    receipt: bon,
    receiptSha256: BONHASH,
    deliverableSha256: LEVERING,
  })
  t('beide sleutels correct: LINKED', goedPaar.reason_code === 'LINKED', goedPaar.reason_code + ' ' + (goedPaar.detail || ''))
  t('en het antwoord zegt WELKE paren vergeleken zijn', JSON.stringify(goedPaar.compared) === JSON.stringify(['COMMITMENT', 'AUTHORIZATION']), JSON.stringify(goedPaar.compared))

  // De kern van de twee-sleutel-splitsing: gekruiste waarden mogen nooit koppelen.
  const gekruist = koppelAcceptatie({
    doc: metSleutels({ x402_receipt_commitment: NONCE, x402_authorization_nonce: COMMITMENT }),
    receipt: bon,
    receiptSha256: BONHASH,
    deliverableSha256: LEVERING,
  })
  t('gekruiste sleutels koppelen NIET', gekruist.reason_code === 'NOT_LINKED', gekruist.reason_code)
  t('en het is de belofte die als eerste afgaat', gekruist.detail === 'COMMITMENT_MISMATCH', gekruist.detail)

  const alleenNonceFout = koppelAcceptatie({
    doc: metSleutels({ x402_authorization_nonce: '0x' + '1'.repeat(64) }),
    receipt: bon,
    receiptSha256: BONHASH,
    deliverableSha256: LEVERING,
  })
  t('een afwijkende nonce geeft AUTHORIZATION_MISMATCH', alleenNonceFout.detail === 'AUTHORIZATION_MISMATCH', alleenNonceFout.detail)

  const geenSleutels = koppelAcceptatie({
    doc: metSleutels({}),
    receipt: bon,
    receiptSha256: BONHASH,
    deliverableSha256: LEVERING,
  })
  t('geen sleutels in de sidecar is geen afkeuring', geenSleutels.reason_code === 'LINKED')
  t('en dan is er ook niets vergeleken', JSON.stringify(geenSleutels.compared) === '[]', JSON.stringify(geenSleutels.compared))

  const sleutelMaarGeenBon = koppelAcceptatie({
    doc: metSleutels({ x402_authorization_nonce: NONCE }),
    receipt: { format: 'eip712' },
    receiptSha256: BONHASH,
    deliverableSha256: LEVERING,
  })
  t('een sleutel zonder tegenhanger in het bonnetje wordt niet vergeleken', sleutelMaarGeenBon.reason_code === 'LINKED')

  // Het generieke veld uit onze eerste versie is bewust geschrapt. Zou het nog gelezen
  // worden, dan kon een belofte alsnog met een nonce vergeleken worden.
  const oudGeneriek = koppelAcceptatie({
    doc: metSleutels({ authorization: COMMITMENT }),
    receipt: bon,
    receiptSha256: BONHASH,
    deliverableSha256: LEVERING,
  })
  t('het oude generieke authorization-veld wordt NIET meer gelezen', JSON.stringify(oudGeneriek.compared) === '[]', JSON.stringify(oudGeneriek.compared))

  const metPrefix = koppelAcceptatie({
    doc: metSleutels({ x402_authorization_nonce: NONCE.replace('0x', '').toUpperCase() }),
    receipt: bon,
    receiptSha256: BONHASH,
    deliverableSha256: LEVERING,
  })
  t('0x en hoofdletters maken geen verschil', metPrefix.reason_code === 'LINKED', metPrefix.detail || '')
}

console.log('de bonhash en de levering, en wanneer iets niet gemeten is')
{
  const basis = { doc: echteVorm(), receipt: { format: 'eip712' }, deliverableSha256: LEVERING }

  t('zonder meegegeven bonhash wordt die helft niet getoetst', koppelAcceptatie(basis).reason_code === 'LINKED')

  const andereBon = koppelAcceptatie({ ...basis, receiptSha256: '0'.repeat(64) })
  t('een andere bonhash koppelt niet', andereBon.detail === 'RECEIPT_HASH_MISMATCH', andereBon.detail)

  const rommelBon = koppelAcceptatie({ ...basis, receiptSha256: 'geen-hash' })
  t('een bonhash die geen hash is, is ongemeten en geen afkeuring', rommelBon.reason_code === 'NOT_MEASURED')

  const zonderOnzeLevering = koppelAcceptatie({ doc: echteVorm(), receipt: { format: 'eip712' }, receiptSha256: BONHASH })
  t('zonder eigen hash van het bestand is de kern ongemeten', zonderOnzeLevering.reason_code === 'NOT_MEASURED', zonderOnzeLevering.reason_code)
  t('en het zegt welk veld mist', (zonderOnzeLevering.missing || []).includes('deliverableSha256'))

  const anderBestand = koppelAcceptatie({ ...basis, receiptSha256: BONHASH, deliverableSha256: '1'.repeat(64) })
  t('een ander bestand koppelt niet', anderBestand.detail === 'DELIVERABLE_HASH_MISMATCH')

  t('de drie uitkomsten staan vast', UITKOMSTEN.length === 3 && UITKOMSTEN.includes('NOT_MEASURED'))
}

console.log(`\n${goed} groen, ${fout} rood`)
process.exitCode = fout === 0 ? 0 : 1
