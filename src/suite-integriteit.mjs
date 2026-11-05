// De vectorsuites van dit pakket meten zichzelf: de map op schijf moet de map zijn die is uitgegeven, en mag niet leeg zijn.
// Elke vectormap heeft een SHA256SUMS (sha256sum-formaat, hash over de bytes met CRLF naar LF). Bij elke run controleren de commando's
// attempt-identity, kanon, beleid, link-vectors en ground --vectors dat elke vector in die lijst staat en elke regel een vector heeft,
// zodat een weggehaalde, toegevoegde of gewijzigde vector een PROBLEM-regel en exit 1 geeft in plaats van een telling van wat overblijft.
// scripts/seal-vectors.mjs schrijft de lijsten na een bewuste wijziging van de vectoren.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const SUITE_MAPPEN = ['attempt-identity', 'kanon', 'settlement-link', 'grounding']
export const eersteRegel = (e) => String((e && e.message) || e).split(String.fromCharCode(10))[0]

// Wat als vector telt: een bestand dat op .json eindigt. Een plek, zodat de controle en de commando's nooit uiteenlopen.
export const lijstVectoren = (map) => fs.readdirSync(map).filter((b) => b.endsWith('.json')).sort()

// De bytes met CRLF naar LF, zonder te decoderen, zodat een gewijzigde byte zich niet achter een tekstdecodering kan verstoppen.
export function crlfNaarLf(buf) {
  const uit = []
  for (let i = 0; i < buf.length; i++) if (!(buf[i] === 13 && buf[i + 1] === 10)) uit.push(buf[i])
  return Buffer.from(uit)
}
export const hashVanBytes = (buf) => crypto.createHash('sha256').update(crlfNaarLf(buf)).digest('hex')

// hashVan(bestand) geeft de sha256 van de bytes met CRLF naar LF. Een hash in hoofdletters en een BOM voorop zijn toegestaan,
// zoals bij sha256sum en bij een lijst die met PowerShell is gemaakt.
export function vergelijkSuiteMetHashlijst({ bestanden, lijstTekst, hashVan }) {
  const problemen = []
  const lijst = new Map()
  for (const regel of lijstTekst.replace(/^\ufeff/, '').split(/\r?\n/)) {
    if (!regel.trim() || regel.startsWith('#')) continue
    const m = regel.match(/^([0-9a-fA-F]{64}) [ *](.+)$/)
    if (!m) { problemen.push('unreadable line in SHA256SUMS: ' + regel.slice(0, 60)); continue }
    if (lijst.has(m[2])) problemen.push(m[2] + ' is listed twice in SHA256SUMS')
    lijst.set(m[2], m[1].toLowerCase())
  }
  if (lijst.size === 0) problemen.push('SHA256SUMS names no vectors')
  for (const b of bestanden) {
    if (!lijst.has(b)) problemen.push(b + ' is not in SHA256SUMS')
    else if (hashVan(b) !== lijst.get(b)) problemen.push(b + ' does not match SHA256SUMS')
  }
  for (const n of lijst.keys()) if (!bestanden.includes(n)) problemen.push(n + ' is in SHA256SUMS but missing on disk')
  return problemen
}

// Geeft de problemen van een vectormap terug (lege lijst = in orde).
export function controleerSuiteMap(map) {
  let bestanden
  try { bestanden = lijstVectoren(map) } catch (e) { return ['the vector folder could not be read (' + eersteRegel(e) + ')'] }
  const problemen = []
  if (bestanden.length === 0) problemen.push('no vectors found')
  const lijstPad = path.join(map, 'SHA256SUMS')
  if (!fs.existsSync(lijstPad)) { problemen.push('SHA256SUMS is missing: the suite cannot be checked against what was published'); return problemen }
  try {
    problemen.push(...vergelijkSuiteMetHashlijst({
      bestanden,
      lijstTekst: fs.readFileSync(lijstPad, 'utf8'),
      hashVan: (b) => hashVanBytes(fs.readFileSync(path.join(map, b))),
    }))
  } catch (e) { problemen.push('SHA256SUMS or a vector could not be read (' + eersteRegel(e) + ')') }
  return problemen
}

// De inhoud van SHA256SUMS voor een vectormap, gesorteerd, voor het seal-script.
export function maakHashlijst(map) {
  return lijstVectoren(map).map((n) => hashVanBytes(fs.readFileSync(path.join(map, n))) + '  ' + n).join('\n') + '\n'
}

// Schrijft de problemen op de manier die alle commando's delen: een PROBLEM-regel per probleem en een slotregel.
// ookMislukt: het afspelen zelf faalde al, dan staat de slotregel er ook zonder problemen. Geeft terug of de slotregel is geschreven.
export function meldProblemen(problemen, ookMislukt = false) {
  for (const p of problemen) console.log('PROBLEM ' + p)
  const mislukt = problemen.length > 0 || ookMislukt
  if (mislukt) console.log('FAIL: this run does not show that the suite is intact and passing. See the lines above.')
  return mislukt
}

// Draait het afspelen van een suite en meldt de integriteit er altijd bij, ook als het afspelen crasht of de map niet te lezen is.
// replay(problemen) geeft terug of het afspelen zelf faalde; een gegooide fout wordt een PROBLEM-regel. Zet de exitcode.
export async function draaiMetIntegriteit(map, replay) {
  const problemen = controleerSuiteMap(map)
  let faalde = false
  try { faalde = Boolean(await replay(problemen)) } catch (e) {
    problemen.push('the replay stopped at a vector that could not be run (' + eersteRegel(e) + ')')
  }
  process.exitCode = meldProblemen(problemen) || faalde ? 1 : 0
}
