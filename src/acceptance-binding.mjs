// Koppelt laag 3 aan laag 4: hoort dit acceptatierecord bij dit bonnetje.
//
// WAAROM DIT EEN EIGEN BESTAND IS EN NIET BIJ DE SETTLEMENT-LINK HOORT. De
// settlement-link-vectoren beantwoorden een andere vraag: opent de gezouten belofte in
// een bonnetje op precies een afrekening op de keten. Dat is betaalbewijs. Een
// acceptatierecord beantwoordt iets anders: heeft een onafhankelijke partij het geleverde
// bestand getoetst aan criteria die al vastlagen. Een uitgever die beide door elkaar
// haalt levert een lezer een vlaggetje "onderbouwd" waarvan niemand meer kan zien welke
// van de twee vragen nu eigenlijk beantwoord is. Daarom twee sets, twee uitkomsten.
//
// WAT HIER WEL GEMETEN WORDT. Uitsluitend de BINDING. Noemen het bonnetje en het
// acceptatierecord hetzelfde opgeleverde bestand, dezelfde machtiging en dezelfde belofte,
// en lagen de criteria vast voordat er getoetst werd.
//
// WAT HIER MET OPZET NIET GEMETEN WORDT, en dat is geen tekortkoming maar de grens van
// deze laag. Wij toetsen de handtekening van het acceptatierecord NIET, en wij
// beoordelen zijn criteria NIET. Dat is het werk van de controleur die het record
// uitgaf, met zijn eigen sleutel en zijn eigen verifieerder. Wie hier een groen antwoord
// krijgt weet dus dat de twee bewijsstukken over hetzelfde gaan, en niet dat het
// acceptatierecord zelf klopt. Die twee door elkaar halen is precies de fout die deze
// module bestaat om te voorkomen.
//
// GEMETEN OP EEN ECHT RECORD, 18 oktober 2026, en dat veranderde deze module wezenlijk.
// De uitgever publiceerde een live record (invinoveritas, trilatic.acceptance-receipt/1.2).
// Daaruit bleek dat onze eerste aannames over de VORM niet klopten:
//
//  1. De hash van het bonnetje staat BOVENIN de sidecar, naast `bindings`, niet erin.
//  2. De hash van het opgeleverde bestand staat in het ONDERTEKENDE record, op
//     `record.receipt.files.remediated.sha256`, en helemaal niet in de sidecar.
//  3. De partijen staan genest in `record.receipt.parties`, met een `key_id` dat leeg
//     kan zijn, en niet als twee platte tekstvelden.
//  4. Het tijdstip van de toets heet `issued_utc`, niet `checked_at`.
//  5. De x402-velden zijn TWEE aparte sleutels, en dat is met opzet zo: een belofte mag
//     nooit met een nonce vergeleken worden. `x402_receipt_commitment` hoort bij
//     `authorizationCommitment`, `x402_authorization_nonce` bij `authorizationNonce`.
//
// Daarom leest deze module nu de ECHTE vorm, met de vlakke vorm uit onze eerste
// vectoren als tweede mogelijkheid. Een module die alleen zijn eigen verzonnen vorm
// aankan, toetst niets in de wereld.
//
// EEN AANNAME DIE WEG IS. Onze eerste versie nam aan dat een machtiging in de sidecar
// gelijk zou zijn aan de nonce in het bonnetje, en las daarvoor ook een generiek veld
// `authorization`. Dat generieke veld is nu bewust GESCHRAPT. De uitgever splitste de
// sleutels juist om te voorkomen dat een belofte met een nonce vergeleken wordt, en een
// generieke terugval zou die bescherming meteen weer weggooien.

const HEX32 = /^[0-9a-f]{64}$/

const genormaliseerdeHash = (w) => {
  if (typeof w !== 'string') return null
  const kaal = w.trim().toLowerCase().replace(/^0x/, '')
  return HEX32.test(kaal) ? kaal : null
}

const gelijkeHash = (a, b) => {
  const x = genormaliseerdeHash(a)
  const y = genormaliseerdeHash(b)
  return x !== null && y !== null && x === y
}

const tijdstip = (w) => {
  if (typeof w === 'number' && Number.isFinite(w)) return w
  if (typeof w !== 'string' || !w.trim()) return null
  const ms = Date.parse(w)
  return Number.isFinite(ms) ? ms / 1000 : null
}

const tekst = (w) => (typeof w === 'string' && w.trim() ? w.trim().toLowerCase() : null)

/**
 * Normaliseert zowel het ECHTE record als de vlakke vorm uit onze eerste vectoren naar
 * de velden die deze module vergelijkt. Een veld dat niet te vinden is wordt null, nooit
 * een gok, want een gegokt veld levert een oordeel op dat niemand kan narekenen.
 *
 * De `naamruimte` bij elke partij is er met opzet: een key_id en een weergavenaam zijn
 * twee verschillende soorten namen, en die mag je niet met elkaar vergelijken. Zie
 * onafhankelijkheid() voor waarom dat hier het verschil maakt tussen een hard oordeel en
 * een onmeetbaar geval.
 */
export function leesRecord(doc) {
  const d = doc && typeof doc === 'object' ? doc : {}
  const echt = d.record?.receipt ?? null
  const acceptance = d.acceptance ?? null
  const sidecar = d.bindings_sidecar ?? d.sidecar ?? null

  const partij = (knoop, plat) => {
    if (knoop && typeof knoop === 'object') {
      if (tekst(knoop.key_id)) return { id: tekst(knoop.key_id), naamruimte: 'key_id' }
      if (tekst(knoop.name)) return { id: tekst(knoop.name), naamruimte: 'name' }
      return { id: null, naamruimte: null }
    }
    return { id: tekst(plat), naamruimte: tekst(plat) ? 'plat' : null }
  }

  return {
    // De hash van het opgeleverde bestand, zoals het ONDERTEKENDE record hem noemt.
    acceptatieLevering:
      echt?.files?.remediated?.sha256 ?? acceptance?.deliverable_sha256 ?? d.deliverable_sha256 ?? null,
    // De hash van het bonnetje, bovenin de sidecar.
    sidecarBonHash: sidecar?.receipt_sha256 ?? d.bindings?.receipt_sha256 ?? null,
    // De x402-sleutels, in het subobject dat daarvoor bedoeld is.
    sidecarBindings: sidecar?.bindings ?? d.bindings ?? {},
    // De vlakke vorm uit onze eerste vectoren noemde de levering ook in de sidecar. Die
    // staat in een echt record NIET in de sidecar, dus dit is puur terugwaartse steun.
    sidecarLevering: d.bindings?.deliverable_sha256 ?? sidecar?.deliverable_sha256 ?? null,
    controleur: partij(echt?.parties?.checker, acceptance?.checker ?? d.checker),
    producent: partij(echt?.parties?.producer, acceptance?.producer ?? d.producer),
    onafhankelijkheidVerklaard: tekst(echt?.independence ?? acceptance?.independence ?? null),
    criteriaVastgelegd:
      echt?.criteria?.committed_at ?? acceptance?.criteria_committed_at ?? d.criteria_committed_at ?? null,
    getoetstOp: echt?.issued_utc ?? acceptance?.checked_at ?? d.checked_at ?? null,
    schema: echt?.schema ?? acceptance?.format ?? null,
  }
}

export const ONAFHANKELIJKHEID = [
  'VERIFIEERBAAR_ONAFHANKELIJK',
  'NIET_ONAFHANKELIJK',
  'ZELFVERKLAARD_ONVERIFIEERBAAR',
  'ONBEKEND',
]

/**
 * Kan een DERDE narekenen dat de controleur niet de producent is?
 *
 * Dit is bewust een drieweg en geen ja of nee, en daar zit de hele waarde. Het live
 * record van 18 oktober 2026 zegt `independence: "independent"` terwijl
 * `parties.producer.key_id` LEEG is. Er is dus niets om de controleur tegen af te zetten:
 * de onafhankelijkheid is door de uitgever zelf verklaard en door niemand anders na te
 * rekenen. Dat is geen afkeuring en geen goedkeuring, het is onmeetbaar, en precies dat
 * onderscheid gaat verloren in een boolean.
 *
 * Even belangrijk: een key_id vergelijken met een weergavenaam is GEEN vergelijking. Dat
 * zijn twee verschillende soorten namen, en "ze zijn verschillend dus onafhankelijk" zou
 * dan een conclusie zijn die uit het formaat komt en niet uit de werkelijkheid.
 */
export function onafhankelijkheid(doc) {
  const r = leesRecord(doc)
  const c = r.controleur
  const p = r.producent
  if (c.id === null && p.id === null) {
    return { staat: 'ONBEKEND', reden: 'geen van beide partijen is benoemd', vergelekenOp: null }
  }
  if (c.id === null || p.id === null) {
    return {
      staat: r.onafhankelijkheidVerklaard === 'independent' ? 'ZELFVERKLAARD_ONVERIFIEERBAAR' : 'ONBEKEND',
      reden:
        'een van beide partijen heeft geen identiteit in het record, dus een derde kan niet narekenen ' +
        'of de controleur en de producent dezelfde partij zijn',
      vergelekenOp: null,
    }
  }
  if (c.naamruimte !== p.naamruimte) {
    return {
      staat: r.onafhankelijkheidVerklaard === 'independent' ? 'ZELFVERKLAARD_ONVERIFIEERBAAR' : 'ONBEKEND',
      reden:
        `de partijen zijn in verschillende soorten namen vastgelegd (${c.naamruimte} tegen ${p.naamruimte}), ` +
        'en die mag je niet met elkaar vergelijken',
      vergelekenOp: null,
    }
  }
  if (c.id === p.id) {
    return { staat: 'NIET_ONAFHANKELIJK', reden: 'de controleur en de producent zijn dezelfde partij', vergelekenOp: c.naamruimte }
  }
  return { staat: 'VERIFIEERBAAR_ONAFHANKELIJK', reden: null, vergelekenOp: c.naamruimte }
}

// Is er genoeg om uberhaupt een oordeel te vellen? Ontbreekt er iets aan ONZE kant van de
// vergelijking, dan is het antwoord NOT_MEASURED en nooit NOT_LINKED. Een ontbrekend veld
// als "niet gekoppeld" lezen zou een ongemeten geval als een afkeuring laten tellen.
export function bindingMeetbaar(doc) {
  const r = leesRecord(doc)
  const mist = []
  if (genormaliseerdeHash(r.sidecarBonHash) === null) mist.push('sidecar.receipt_sha256')
  if (genormaliseerdeHash(r.acceptatieLevering) === null) mist.push('record.receipt.files.remediated.sha256')
  return mist.length ? { meetbaar: false, mist } : { meetbaar: true, mist: [] }
}

// De twee voorwaarden van de uitgever zelf (trilatic.acceptance-receipt/1.2): een record
// telt alleen als de controleur niet de producent is, en als de criteria vastlagen
// voordat er getoetst werd. Ze staan hier in code omdat een voorwaarde die alleen in
// proza staat bij de eerste drukke dag wordt overgeslagen.
//
// De uitkomst is drieledig, want "ik kan het niet nagaan" is iets anders dan "het is
// mis". Dat onderscheid is dezelfde correctie die de Kanon-auteur op 17 oktober 2026
// overnam voor zijn eigen controleur.
export function recordTelt(doc) {
  const r = leesRecord(doc)
  const o = onafhankelijkheid(doc)
  if (o.staat === 'NIET_ONAFHANKELIJK') return { telt: false, meetbaar: true, reden: 'CHECKER_IS_PRODUCER' }
  if (o.staat !== 'VERIFIEERBAAR_ONAFHANKELIJK') {
    return { telt: false, meetbaar: false, reden: 'INDEPENDENCE_NOT_VERIFIABLE', toelichting: o.reden }
  }
  const vastgelegd = tijdstip(r.criteriaVastgelegd)
  const getoetst = tijdstip(r.getoetstOp)
  if (vastgelegd === null || getoetst === null) {
    return { telt: false, meetbaar: false, reden: 'CRITERIA_TIMING_UNKNOWN' }
  }
  if (!(vastgelegd < getoetst)) {
    return { telt: false, meetbaar: true, reden: 'CRITERIA_NOT_COMMITTED_FIRST' }
  }
  return { telt: true, meetbaar: true, reden: null }
}

/**
 * Het eigenlijke oordeel. Drie uitkomsten, nooit twee: gekoppeld, niet gekoppeld, of
 * niet te meten.
 *
 * `receiptSha256` en het bonnetje zelf komen van de AANROEPER, want dat is de kant die
 * hij in handen heeft. Alles aan de record-kant wordt uit het document gelezen.
 */
export function koppelAcceptatie({ receipt, acceptance, bindings, sidecar, doc, receiptSha256, deliverableSha256 }) {
  // Een aanroeper mag het hele document meegeven, of de losse stukken zoals onze eerste
  // vectoren dat deden. Beide komen hier op dezelfde genormaliseerde vorm uit.
  const document = doc ?? {
    record: acceptance?.record ? acceptance.record : undefined,
    acceptance,
    bindings,
    bindings_sidecar: sidecar,
  }
  const r = leesRecord(document)

  const m = bindingMeetbaar(document)
  if (!m.meetbaar) {
    return { valid: false, measurable: false, reason_code: 'NOT_MEASURED', missing: m.mist, independence: onafhankelijkheid(document).staat }
  }

  const telt = recordTelt(document)
  if (!telt.telt) {
    return telt.meetbaar
      ? { valid: false, measurable: true, reason_code: 'NOT_LINKED', detail: telt.reden, independence: onafhankelijkheid(document).staat }
      : {
          valid: false,
          measurable: false,
          reason_code: 'NOT_MEASURED',
          missing: [telt.reden],
          detail: telt.toelichting ?? null,
          independence: onafhankelijkheid(document).staat,
        }
  }

  // Noemt de sidecar het bonnetje dat wij in handen hebben? Zonder een meegegeven hash van
  // ons eigen bonnetje kan die helft niet getoetst worden, en dan is het niet gemeten.
  if (receiptSha256 !== undefined) {
    if (genormaliseerdeHash(receiptSha256) === null) {
      return { valid: false, measurable: false, reason_code: 'NOT_MEASURED', missing: ['receiptSha256'] }
    }
    if (!gelijkeHash(receiptSha256, r.sidecarBonHash)) {
      return { valid: false, measurable: true, reason_code: 'NOT_LINKED', detail: 'RECEIPT_HASH_MISMATCH' }
    }
  }

  // De kern: wijzen het record en wat wij in handen hebben naar hetzelfde opgeleverde
  // bestand. De aanroeper mag de hash van het bestand dat hij ECHT ontving meegeven; dat
  // is sterker dan een hash die ook uit de sidecar komt, want dan vergelijk je twee
  // velden van dezelfde uitgever met elkaar.
  const onzeKant = deliverableSha256 ?? r.sidecarLevering
  if (onzeKant === null || onzeKant === undefined) {
    return {
      valid: false,
      measurable: false,
      reason_code: 'NOT_MEASURED',
      missing: ['deliverableSha256'],
      detail: 'het record noemt een opgeleverd bestand, maar er is geen eigen hash om het tegen af te zetten',
      independence: onafhankelijkheid(document).staat,
    }
  }
  if (!gelijkeHash(r.acceptatieLevering, onzeKant)) {
    return { valid: false, measurable: true, reason_code: 'NOT_LINKED', detail: 'DELIVERABLE_HASH_MISMATCH' }
  }

  // De twee x402-sleutels, ELK met zijn eigen tegenhanger. Een belofte wordt nooit met
  // een nonce vergeleken: daarvoor zijn het twee sleutels. Staat een van de twee kanten
  // niet in het stuk, dan wordt er niet vergeleken, en dat is geen afkeuring.
  const b = r.sidecarBindings ?? {}
  const paren = [
    {
      naam: 'COMMITMENT_MISMATCH',
      sidecar: b.x402_receipt_commitment,
      bon: receipt?.authorizationCommitment ?? receipt?.payload?.authorizationCommitment,
    },
    {
      naam: 'AUTHORIZATION_MISMATCH',
      sidecar: b.x402_authorization_nonce,
      bon: receipt?.authorizationNonce ?? receipt?.payload?.authorizationNonce,
    },
  ]
  const vergeleken = []
  for (const p of paren) {
    if (p.sidecar === undefined || p.sidecar === null) continue
    if (p.bon === undefined || p.bon === null) continue
    if (!gelijkeHash(p.sidecar, p.bon)) {
      return { valid: false, measurable: true, reason_code: 'NOT_LINKED', detail: p.naam }
    }
    vergeleken.push(p.naam.replace('_MISMATCH', ''))
  }

  return {
    valid: true,
    measurable: true,
    reason_code: 'LINKED',
    independence: onafhankelijkheid(document).staat,
    // Het ketenanker hoort BIJ het groene antwoord, niet in een aparte aanroep die een
    // lezer kan overslaan. Een LINKED-record zonder anker is nog steeds gekoppeld, maar
    // een uitdager kan er later geen reorg van een fout onderscheiden, en dat hoort hij
    // te zien zonder erom te vragen.
    chain_anchor: ketenanker(document).staat,
    // Wat er WEL en NIET vergeleken is, want een groen antwoord zonder dat lijstje laat
    // een lezer denken dat alles getoetst is.
    compared: vergeleken,
  }
}

export const UITKOMSTEN = ['LINKED', 'NOT_LINKED', 'NOT_MEASURED']

// ─── HET KETENANKER ──────────────────────────────────────────────────────────────────
//
// Waarom dit erbij hoort, en de aanleiding staat in een publieke draad. Een bonded
// verifieerder merkte op dat een record ook het BLOK hoort te noemen waarop de
// verifieerder `AuthorizationUsed` las, met nummer EN hash, omdat een uitdager dan een
// reorg kan onderscheiden van een verkeerd antwoord. Dat is een reel verschil: zonder
// anker zijn die twee gevallen van buitenaf identiek, en ze vragen een tegengestelde
// reactie (bij een reorg had de verifieerder gelijk op dat moment, bij een fout niet).
//
// EN DE SCHERPE VERSIE ERVAN, want hier zit de eigenlijke eis. Een bloknummer alleen is
// GEEN anker. Bij een reorg blijft dat nummer bestaan en verandert de inhoud eronder, dus
// een nummer zonder hash pint niets vast. Alleen de blokhash maakt de uitspraak
// controleerbaar, en daarom is nummer-zonder-hash hieronder een EIGEN uitkomst en niet
// een half-goed geval.
//
// De classificatie is OFFLINE en blijft dat, want offline werken is de belofte van dit
// pakket. Wil een lezer het anker ook echt bij de keten natrekken, dan is dat een aparte,
// expliciete stap (`bevestigKetenanker`), nooit iets dat stil op de achtergrond gebeurt.

export const KETENANKER = [
  // Het record doet geen uitspraak over de keten, dus er is niets om te ankeren. Dit is
  // geen gebrek: een acceptatierecord zonder afrekening hoort hier.
  'GEEN_KETENLEZING',
  // Nummer en hash staan er beide. Daarmee is de uitspraak navraagbaar.
  'ANKER_VOLLEDIG',
  // Een nummer zonder hash. Leest als zorgvuldig en is het niet, zie de uitleg hierboven.
  'ANKER_ZONDER_HASH',
  // Het record leunt op een ketenlezing maar noemt geen blok. Dan is een reorg later niet
  // van een fout te onderscheiden.
  'ANKER_ONTBREEKT',
  // Nagetrokken bij de keten en gelijk.
  'ANKER_BEVESTIGD',
  // Nagetrokken bij de keten en NIET gelijk. Dit is het geval waar de suggestie voor
  // bestaat: op dit nummer staat vandaag een ander blok dan het record noemt.
  'ANKER_WIJKT_AF',
]

// De velden die we accepteren. Onze eigen voorkeursvorm staat vooraan; de rest is er
// omdat een conventie die alleen de eigen spelling leest geen conventie is maar een
// eigen formaat. Zelfde keuze als bij de rest van `leesRecord`.
export function leesKetenanker(doc) {
  const d = doc && typeof doc === 'object' ? (doc.record ?? doc) : {}
  const sidecar = d.bindings_sidecar ?? d.sidecar ?? null
  const b = sidecar?.bindings ?? d.bindings ?? {}
  const lezing = d.onchain_read ?? d.onchain ?? d.verification?.onchain ?? d.settlement?.onchain ?? null

  const getal = (v) => {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
    if (typeof v === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(v.trim())) {
      return Number(v.trim().startsWith('0x') ? BigInt(v.trim()) : BigInt(v.trim()))
    }
    return null
  }
  const hash = (v) => (typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v.trim()) ? v.trim().toLowerCase() : null)

  return {
    nummer:
      getal(lezing?.block_number) ??
      getal(lezing?.blockNumber) ??
      getal(b.x402_settlement_block_number) ??
      getal(d.block_number) ??
      null,
    blokhash:
      hash(lezing?.block_hash) ??
      hash(lezing?.blockHash) ??
      hash(b.x402_settlement_block_hash) ??
      hash(d.block_hash) ??
      null,
    keten: lezing?.chain ?? lezing?.chain_id ?? lezing?.network ?? b.x402_network ?? d.network ?? null,
    gebeurtenis: lezing?.event ?? lezing?.log ?? null,
    // Waarop we vaststellen DAT er een ketenlezing achter dit record zit. De twee
    // x402-sleutels zijn precies de velden die uit een afrekening op de keten komen, dus
    // hun aanwezigheid is de claim.
    leuntOpKeten: Boolean(
      lezing ||
        b.x402_authorization_nonce ||
        b.x402_receipt_commitment ||
        d.tx_hash ||
        d.transaction_hash ||
        lezing?.tx_hash,
    ),
  }
}

// De offline uitspraak. Geen netwerk, geen sleutel, geen klok.
export function ketenanker(doc) {
  const a = leesKetenanker(doc)
  if (!a.leuntOpKeten) {
    return { staat: 'GEEN_KETENLEZING', nummer: null, blokhash: null, waarom: 'het record doet geen uitspraak over een afrekening op een keten' }
  }
  if (a.nummer !== null && a.blokhash !== null) {
    return { staat: 'ANKER_VOLLEDIG', nummer: a.nummer, blokhash: a.blokhash, keten: a.keten, waarom: 'nummer en blokhash staan er beide, dus de lezing is navraagbaar' }
  }
  if (a.nummer !== null) {
    return {
      staat: 'ANKER_ZONDER_HASH',
      nummer: a.nummer,
      blokhash: null,
      keten: a.keten,
      waarom: 'alleen een bloknummer. Bij een reorg blijft dat nummer staan en verandert de inhoud, dus het pint niets vast',
    }
  }
  return {
    staat: 'ANKER_ONTBREEKT',
    nummer: null,
    blokhash: a.blokhash,
    keten: a.keten,
    waarom: 'het record leunt op een ketenlezing maar noemt geen blok, dus een reorg is later niet van een fout te onderscheiden',
  }
}

// De optionele, expliciete stap: het verklaarde anker bij de keten natrekken.
//
// Drie dingen die bewust zo zijn. Hij draait NOOIT uit zichzelf, want dit pakket werkt
// offline. Een mislukte aanroep geeft NIET_GEMETEN en nooit een afkeuring, want niet
// kunnen meten is geen bewijs van iets. En hij vraagt het blok op NUMMER en vergelijkt de
// hash, want dat is precies de richting waarin een reorg zichtbaar wordt.
export async function bevestigKetenanker(doc, { rpcUrl, fetchImpl } = {}) {
  const basis = ketenanker(doc)
  if (basis.staat !== 'ANKER_VOLLEDIG') return { ...basis, nagetrokken: false }
  const haal = fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  if (!haal || !rpcUrl) {
    return { ...basis, nagetrokken: false, waarom_niet: 'geen rpcUrl of fetch meegegeven, dus niet nagetrokken' }
  }
  let echteHash = null
  try {
    const r = await haal(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBlockByNumber',
        params: ['0x' + basis.nummer.toString(16), false],
      }),
    })
    const j = await r.json()
    echteHash = typeof j?.result?.hash === 'string' ? j.result.hash.toLowerCase() : null
  } catch {
    echteHash = null
  }
  if (!echteHash) {
    return { ...basis, nagetrokken: false, waarom_niet: 'de keten gaf geen blok terug op dit nummer, dus niet gemeten' }
  }
  if (echteHash === basis.blokhash) {
    return { ...basis, staat: 'ANKER_BEVESTIGD', nagetrokken: true, ketenhash: echteHash }
  }
  return {
    ...basis,
    staat: 'ANKER_WIJKT_AF',
    nagetrokken: true,
    ketenhash: echteHash,
    waarom: 'op dit bloknummer staat vandaag een ander blok dan het record noemt, dus een reorg of een verkeerd antwoord',
  }
}
