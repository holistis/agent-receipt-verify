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
// acceptatierecord hetzelfde opgeleverde bestand, dezelfde machtiging, en voldoet het
// record aan de twee voorwaarden die de uitgever er zelf aan stelt.
//
// WAT HIER MET OPZET NIET GEMETEN WORDT, en dat is geen tekortkoming maar de grens van
// deze laag. Wij toetsen de handtekening van het acceptatierecord NIET, en wij
// beoordelen zijn criteria NIET. Dat is het werk van de controleur die het record
// uitgaf, met zijn eigen sleutel en zijn eigen verifieerder. Wie hier een groen antwoord
// krijgt weet dus dat de twee bewijsstukken over hetzelfde gaan, en niet dat het
// acceptatierecord zelf klopt. Die twee door elkaar halen is precies de fout die deze
// module bestaat om te voorkomen.
//
// EEN AANNAME DIE NOG BEVESTIGD MOET WORDEN, en daarom staat hij hier en niet verstopt.
// Als de sidecar een machtiging draagt, nemen wij aan dat dat dezelfde waarde is als de
// nonce in het bonnetje. Draagt een uitgever daar in plaats daarvan een transactiehash,
// dan geeft deze module NOT_LINKED terwijl het paar in werkelijkheid klopt. Dat is een
// vals negatief, en dat is de veilige kant om op te falen, maar het blijft een aanname
// tot het formaat het zelf vastlegt. De vergelijking gebeurt alleen als BEIDE kanten een
// waarde hebben: afwezig is geen afkeuring.
//
// DE TWEE VOORWAARDEN komen van de uitgever van het formaat zelf
// (trilatic.acceptance-receipt/1.2): een record telt alleen als de controleur niet de
// producent is, en als de criteria vastlagen voordat er getoetst werd. Ze staan hier in
// code omdat een voorwaarde die alleen in proza staat bij de eerste drukke dag wordt
// overgeslagen.

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

const partij = (w) => (typeof w === 'string' && w.trim() ? w.trim().toLowerCase() : null)

// Is er genoeg om uberhaupt een oordeel te vellen? Ontbreekt er iets aan ONZE kant van de
// vergelijking, dan is het antwoord NOT_MEASURED en nooit NOT_LINKED. Een ontbrekend veld
// als "niet gekoppeld" lezen zou een ongemeten geval als een afkeuring laten tellen.
export function bindingMeetbaar({ receipt, acceptance, bindings }) {
  const mist = []
  if (!receipt || typeof receipt !== 'object') mist.push('receipt')
  if (!acceptance || typeof acceptance !== 'object') mist.push('acceptance')
  if (!bindings || typeof bindings !== 'object') mist.push('bindings')
  if (mist.length) return { meetbaar: false, mist }

  if (genormaliseerdeHash(bindings.receipt_sha256) === null) mist.push('bindings.receipt_sha256')
  if (genormaliseerdeHash(bindings.deliverable_sha256) === null) mist.push('bindings.deliverable_sha256')
  if (genormaliseerdeHash(acceptance.deliverable_sha256) === null) mist.push('acceptance.deliverable_sha256')
  return mist.length ? { meetbaar: false, mist } : { meetbaar: true, mist: [] }
}

// De twee voorwaarden van de uitgever zelf, apart toetsbaar zodat een afkeuring hierop
// niet verward wordt met een hash die niet matcht.
export function recordTelt(acceptance) {
  const controleur = partij(acceptance?.checker)
  const producent = partij(acceptance?.producer)
  if (controleur === null || producent === null) {
    return { telt: false, reden: 'CHECKER_OR_PRODUCER_UNKNOWN' }
  }
  if (controleur === producent) {
    return { telt: false, reden: 'CHECKER_IS_PRODUCER' }
  }
  const vastgelegd = tijdstip(acceptance?.criteria_committed_at)
  const getoetst = tijdstip(acceptance?.checked_at)
  if (vastgelegd === null || getoetst === null) {
    return { telt: false, reden: 'CRITERIA_TIMING_UNKNOWN' }
  }
  if (!(vastgelegd < getoetst)) {
    return { telt: false, reden: 'CRITERIA_NOT_COMMITTED_FIRST' }
  }
  return { telt: true, reden: null }
}

// Het eigenlijke oordeel. Drie uitkomsten, nooit twee: gekoppeld, niet gekoppeld, of
// niet te meten.
export function koppelAcceptatie({ receipt, acceptance, bindings, receiptSha256 }) {
  const m = bindingMeetbaar({ receipt, acceptance, bindings })
  if (!m.meetbaar) {
    return { valid: false, measurable: false, reason_code: 'NOT_MEASURED', missing: m.mist }
  }

  const telt = recordTelt(acceptance)
  if (!telt.telt) {
    return { valid: false, measurable: true, reason_code: 'NOT_LINKED', detail: telt.reden }
  }

  // Noemt de sidecar het bonnetje dat wij in handen hebben? Zonder een meegegeven hash van
  // ons eigen bonnetje kan die helft niet getoetst worden, en dan is het niet gemeten.
  if (receiptSha256 !== undefined) {
    if (genormaliseerdeHash(receiptSha256) === null) {
      return { valid: false, measurable: false, reason_code: 'NOT_MEASURED', missing: ['receiptSha256'] }
    }
    if (!gelijkeHash(receiptSha256, bindings.receipt_sha256)) {
      return { valid: false, measurable: true, reason_code: 'NOT_LINKED', detail: 'RECEIPT_HASH_MISMATCH' }
    }
  }

  // De kern: wijzen het record en de sidecar naar hetzelfde opgeleverde bestand.
  if (!gelijkeHash(acceptance.deliverable_sha256, bindings.deliverable_sha256)) {
    return { valid: false, measurable: true, reason_code: 'NOT_LINKED', detail: 'DELIVERABLE_HASH_MISMATCH' }
  }

  // De machtiging hoeft niet in elke sidecar te staan, maar staat hij er WEL, dan moet hij
  // die van het bonnetje zijn. Aanwezig en afwijkend is erger dan afwezig.
  const sidecarAut = bindings.authorization ?? bindings.authorizationNonce
  const bonAut = receipt?.authorizationNonce ?? receipt?.payload?.authorizationNonce
  if (sidecarAut !== undefined && sidecarAut !== null && bonAut !== undefined && bonAut !== null) {
    if (!gelijkeHash(sidecarAut, bonAut)) {
      return { valid: false, measurable: true, reason_code: 'NOT_LINKED', detail: 'AUTHORIZATION_MISMATCH' }
    }
  }

  return { valid: true, measurable: true, reason_code: 'LINKED' }
}

export const UITKOMSTEN = ['LINKED', 'NOT_LINKED', 'NOT_MEASURED']
