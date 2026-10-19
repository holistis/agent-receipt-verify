// Vertaalt onze eigen vier-waardige uitkomst (LINKED/NOT_LINKED/AMBIGUOUS/NOT_MEASURED/
// SKIPPED) naar de zes namen die x402-foundation/x402#3827 op 19 oktober 2026 normatief
// maakte, commit e617b3e46b8aa0782ee129fad515eb0730307e9f, specs/extensions/
// extension-offer-and-receipt.md regel 486-491.
//
// WAAROM EEN APARTE VERTAALLAAG EN GEEN HERNOEMING. Onze eigen namen zijn fijner dan hun
// zes: AMBIGUOUS en NOT_LINKED zijn voor ons twee verschillende dingen (meer dan een
// kandidaat is een andere situatie dan nul), en voor hen is dat allebei `no_match`. Onze
// namen hernoemen zou die eigen, nuttige fijnheid weggooien om een vocabulaire te volgen
// dat zelf toegeeft dat het die twee niet uit elkaar kan houden. Deze laag bewijst
// VERENIGBAARHEID zonder de eigen granulariteit op te geven.
//
// WAT DEZE LAAG NIET DOET. Onze eigen NOT_MEASURED dekt zowel "kon de kandidatenlijst niet
// ophalen" als "er was geen commitment aanwezig", en de spec maakt daar nu twee namen van,
// `incomplete` en `not_attempted`. Die twee uit elkaar houden kan ALLEEN op basis van de
// letterlijke redentekst, niet op basis van het outcome-label. Een reden die geen van de
// patronen hieronder matcht wordt ONBEKEND, nooit stilzwijgend naar een van de zes geduwd.

export const ZES_NAMEN = ['linked', 'no_match', 'incomplete', 'not_attempted', 'malformed', 'inconsistent']

const INCOMPLETE_PATRONEN = [
  /candidate set was obtained/i, // "no candidate set was obtained" -> incomplete
  /candidate set is not a list/i,
  /SKIPPED/, // requires_chain_read: we hebben het NIET geprobeerd op te halen in dit testritje
]

const NOT_ATTEMPTED_PATRONEN = [
  /carries no commitment/i,
  /version 1 and carries no commitment/i,
  /no receipt payload/i,
  /no payload/i,
]

/**
 * @param {string} onzeOutcome LINKED, NOT_LINKED, AMBIGUOUS, NOT_MEASURED of SKIPPED
 * @param {string} reden de letterlijke reden-tekst uit beoordeelVector
 * @returns {{naam: string, zeker: boolean}} zeker=false bij SKIPPED/een ongeziene reden
 */
export function naarZesNamen(onzeOutcome, reden = '') {
  if (onzeOutcome === 'LINKED') return { naam: 'linked', zeker: true }
  if (onzeOutcome === 'NOT_LINKED') return { naam: 'no_match', zeker: true }
  if (onzeOutcome === 'AMBIGUOUS') return { naam: 'no_match', zeker: true }
  if (onzeOutcome === 'SKIPPED') return { naam: 'incomplete', zeker: true }
  if (onzeOutcome === 'NOT_MEASURED') {
    if (INCOMPLETE_PATRONEN.some((p) => p.test(reden))) return { naam: 'incomplete', zeker: true }
    if (NOT_ATTEMPTED_PATRONEN.some((p) => p.test(reden))) return { naam: 'not_attempted', zeker: true }
    return { naam: 'ONBEKEND', zeker: false, reden }
  }
  return { naam: 'ONBEKEND', zeker: false, reden: 'onbekende eigen outcome: ' + onzeOutcome }
}
