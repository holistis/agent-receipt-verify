#!/usr/bin/env node
// Controleer of een BETAALD antwoord WAAR is, bij een bron die de verkoper niet bezit.
//
// WAT DIT VASTSTELT, en de formulering is met opzet smal. Een handtekening bewijst dat
// een bericht ECHT is, niet dat het WAAR is. Zodra alleen de verkoper de uitvoering
// ziet, is elk bewijsstuk dat hij maakt een functie van zijn eigen toestand, en een
// handtekening eronder verandert daar niets aan. Deze controle pakt de andere helft:
// hij leest zelf, bij de bron, of de bewering van de verkoper klopt.
//
// WAT DIT UITDRUKKELIJK NIET VASTSTELT, en dit stond er in de eerste versie te breed in.
//  - Het bewijst NIET dat de verkoper werk heeft verricht. Het bewijstoken staat in
//    publieke DNS of in een publiek bestand, dus een luie verkoper kan het daar zelf
//    lezen en teruggeven. De uitslag zegt dat het ANTWOORD WAAR is, niet dat het
//    VERDIEND is. Dat verschil hoort hardop benoemd te worden en niet verstopt.
//  - Het bewijst NIET dat het token het JUISTE token voor deze klant is. Dat token is
//    een hmac van de uitgever; zonder diens sleutel is het door een vreemde niet na te
//    rekenen. Wie dat wel beweert, overvraagt zijn eigen gereedschap.
//  - Het bindt dit antwoord NIET aan een specifieke betaling. Die binding vraagt een
//    ondertekend leveringsbewijs met een inhoudshash, en dat is een losse stap.
//
// WAT HET WEL AFSLUIT, en dat is de hele reden van deze herziening. De plek komt NIET
// uit het bonnetje. Hij wordt hier AFGELEID uit het eindpunt waarvoor de koper betaalde,
// met de vaste afspraak van de dienst zelf (zie DNS_LABEL en WELL_KNOWN_PATH). Zonder
// die binding koos de verkoper zowel het token als de plek, en dan is elke uitslag te
// regisseren: een token dat in een bekend publiek record staat, met dat record als plek,
// en de controle zegt groen. Dat is in onze eigen keuring werkelijk gedraaid met een
// verzonnen bonnetje dat naar een vreemd domein wees, en het kwam groen uit met
// exitcode 0. Daarom moet de koper nu het eindpunt noemen.
//
// UITKOMSTEN, drie met opzet, en over de zachte moet eerlijk gezegd worden wat hij wel
// en niet uitsluit. Een eerdere versie van deze koptekst beweerde dat de verkoper de
// zachte uitkomst nooit kan kiezen. Dat was onwaar, en onze eigen tweede keuring heeft
// acht routes gemeten waarlangs het toch lukte. Zeven daarvan zijn nu dicht: een
// onbruikbaar token, een 404 op de plek, en een dns-naam die niet bestaat zijn alle drie
// een AFKEURING geworden, want het zijn antwoorden en geen storingen.
//
// EEN ROUTE BLIJFT OPEN, EN DIE STAAT HIER OMDAT HIJ NIET TE DICHTEN IS. De verkoper
// noemt de METHODE, dus hij kiest welke van de twee bronnen gelezen wordt. Noemt hij een
// methode die wij niet kennen, dan kunnen wij niets afleiden en is de uitslag NIET
// GEMETEN. Dat is eerlijk, want wij hebben werkelijk niets gemeten, en het is tegelijk
// een route die een verkoper kan nemen. NIET GEMETEN betekent dus: wij konden niet
// kijken. Het betekent NIET: de verkoper is eerlijk.
// SUPPORTED als het token werkelijk op de AFGELEIDE plek staat. NOT_SUPPORTED als de
// bron bereikbaar was en het token er niet staat, en ook als het antwoord over een
// ander domein gaat dan waarvoor betaald is. NOT_MEASURED alleen als de controle
// werkelijk niet kon lopen. Wie die laatste twee door elkaar haalt, beschuldigt een
// eerlijke verkoper bij een dns-storing.
//
// GEBRUIK:
//   node src/verify-delivery.mjs --answer=<bonnetje.json> --endpoint=<url van de klant>
//   npx agent-receipt-verify verify-delivery --answer=a.json --endpoint=https://klant.example/pad
// Exitcodes: 0 gesteund, 1 niet gesteund, 2 niet te meten.

import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns/promises'
import { fileURLToPath } from 'node:url'

/** De twee plekken waar dit soort bewijs hoort te staan, uit de dienst zelf. */
export const DNS_LABEL = '_endpoint-attest'
export const WELL_KNOWN_PATH = '/.well-known/endpoint-attest.txt'

/**
 * Een dak op het document en een klok op het verzoek.
 *
 * Zonder het dak OP DE STROOM leest dit alles in voordat het knipt: een plek die
 * eindeloos blijft sturen trok in de keuring 2,4 GiB geheugen in veertig seconden.
 * Zonder de klok hangt het commando voor altijd aan een bestemming die wel verbindt en
 * nooit antwoordt.
 */
export const MAX_DOCUMENT = 65536
export const HAAL_TIJDSLIMIET_MS = 10000

/**
 * Een hostnaam met een punt op het eind is dezelfde naam.
 *
 * Zonder dit zet een punt achter de naam elke naamregel hieronder buiten werking, want
 * "localhost." eindigt niet op "localhost". Dat is in de keuring gemeten en er werd
 * echt verbonden met 127.0.0.1.
 */
export function normaliseerHost(h) {
  let s = String(h ?? '').toLowerCase().trim()
  while (s.endsWith('.')) s = s.slice(0, -1)
  return s
}

/**
 * Is dit opgeloste adres een adres waar een vreemde ons niet naartoe mag sturen?
 *
 * WAAROM DIT OP HET ADRES ZIT EN NIET OP DE NAAM. Een naamfilter kan dit per definitie
 * niet dekken, en dat is gemeten in plaats van beredeneerd: 127-0-0-1.nip.io,
 * localtest.me, 169-254-169-254.nip.io en 10-0-0-1.nip.io zijn volkomen normale
 * publieke namen zonder enig verdacht label, en ze wijzen alle vier naar binnen. De
 * naam zegt dus niets. Alleen het opgeloste adres zegt iets.
 *
 * Geeft een reden terug als het adres geweigerd hoort te worden, en null als het mag.
 */
export function privaatAdres(ip) {
  const s = String(ip ?? '').toLowerCase().trim()
  if (/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(s)) {
    const d = s.split('.').map(Number)
    if (d.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return 'not a usable address: ' + s
    if (d[0] === 0) return 'this-network address: ' + s
    if (d[0] === 10) return 'private address: ' + s
    if (d[0] === 127) return 'loopback address: ' + s
    if (d[0] === 192 && d[1] === 168) return 'private address: ' + s
    if (d[0] === 172 && d[1] >= 16 && d[1] <= 31) return 'private address: ' + s
    if (d[0] === 169 && d[1] === 254) return 'link-local address: ' + s
    if (d[0] === 100 && d[1] >= 64 && d[1] <= 127) return 'carrier-grade nat address: ' + s
    if (d[0] === 192 && d[1] === 0 && d[2] === 0) return 'reserved address: ' + s
    if (d[0] >= 224) return 'multicast or reserved address: ' + s
    return null
  }
  if (s.includes(':')) {
    const kaal = s.replace(/^\[/, '').replace(/\]$/, '').split('%')[0]
    if (kaal === '::1' || kaal === '::') return 'loopback or unspecified address: ' + kaal
    if (/^f[cd][0-9a-f]{2}:/.test(kaal)) return 'unique local address: ' + kaal
    if (/^fe[89ab][0-9a-f]:/.test(kaal)) return 'link-local address: ' + kaal
    if (/^ff[0-9a-f]{2}:/.test(kaal)) return 'multicast address: ' + kaal
    // Een ipv4-adres dat in een ipv6-vorm verstopt zit, hoort langs dezelfde regels.
    const ingebed = kaal.match(/([0-9]{1,3}(?:\.[0-9]{1,3}){3})$/)
    if (ingebed) {
      const r = privaatAdres(ingebed[1])
      if (r) return 'ipv6-mapped ' + r
    }
    return null
  }
  return 'not a usable address: ' + s
}

/**
 * Weiger een plek die niet publiek is, en los de naam daarvoor echt op.
 *
 * `lookup` is inspuitbaar zodat de test geen dns nodig heeft. Faalt het oplossen, dan is
 * dat GEEN groen licht: zonder opgelost adres weten we niet waar we heen gaan, en dan
 * gaan we niet.
 */
export async function plekIsPubliek(waarde, { lookup = dns.lookup } = {}) {
  // EEN ANDER SCHEMA WORDT GEWEIGERD EN NIET OMGEBOUWD. Zonder deze regel vuurde de
  // schema-controle hieronder NOOIT: alles wat niet met http of https begon kreeg er
  // https voor, dus een ftp-adres werd een https-adres met hostnaam "ftp". Gevonden
  // door een NIEUWE test van onze eigen suite, die dus iets echts aanwees in plaats van
  // alleen een oude verwachting te bevestigen.
  const heeftSchema = /^[a-z][a-z0-9+.-]*:/i.test(String(waarde))
  if (heeftSchema && !/^https?:/i.test(String(waarde))) {
    const schema = String(waarde).split(':')[0]
    return { ok: false, reden: 'only http or https is allowed, got ' + schema + ':' }
  }
  let u
  try {
    u = new URL(/^https?:\/\//i.test(waarde) ? waarde : 'https://' + waarde)
  } catch {
    return { ok: false, reden: 'not a usable location' }
  }
  // HTTP WORDT NIET MEER GEWEIGERD, EN DAT IS EEN CORRECTIE. Hier stond "alleen https",
  // maar de uitgever van dit bewijs staat http uitdrukkelijk toe (zie parseEndpoint in
  // packages/endpoint-attest/src/ownership.ts) en publiceert dan ook op http. Een eigen,
  // strengere eis klinkt veiliger en levert hier het tegenovergestelde op: een eerlijke
  // verkoper met een http-eindpunt werd afgekeurd op een regel die de dienst zelf niet
  // heeft. De echte grens blijft staan en die zit op het OPGELOSTE ADRES, niet op het
  // schema. Wie over platte http leest hoort dat wel in de uitslag te zien, want dan kan
  // iemand op het pad ertussen het antwoord verzinnen.
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reden: 'only http or https is allowed, got ' + u.protocol }
  }
  if (u.username || u.password) return { ok: false, reden: 'credentials in the location are refused' }
  const h = normaliseerHost(u.hostname)
  if (!h) return { ok: false, reden: 'no hostname in the location' }
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return { ok: false, reden: 'non-public hostname: ' + h }
  }
  if (h.startsWith('[') || h.includes(':')) return { ok: false, reden: 'literal ipv6 is refused' }
  if (/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(h)) {
    const r = privaatAdres(h)
    if (r) return { ok: false, reden: r }
    return { ok: true, url: u, adressen: [h], plattekst: u.protocol === 'http:' }
  }
  let adressen
  try {
    const uit = await lookup(h, { all: true })
    adressen = (Array.isArray(uit) ? uit : [uit]).map((a) => (a && a.address ? a.address : String(a)))
  } catch (e) {
    return { ok: false, reden: 'could not resolve ' + h + ': ' + String(e?.message ?? e).slice(0, 80) }
  }
  if (!adressen.length) return { ok: false, reden: 'no address for ' + h }
  for (const a of adressen) {
    const r = privaatAdres(a)
    if (r) return { ok: false, reden: h + ' resolves to a ' + r }
  }
  return { ok: true, url: u, adressen, plattekst: u.protocol === 'http:' }
}

/**
 * Welke plek HOORT hier gelezen te worden, gegeven het eindpunt waarvoor betaald is.
 *
 * Dit is de kern van de reparatie. De plek is geen invoer van de verkoper maar een
 * gevolg van de aanvraag van de koper, met de vaste afspraak van de dienst erbij.
 */
export function verwachtePlek(endpoint, methode) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return { klacht: 'no endpoint was named by the caller, so there is nothing to bind the location to' }
  }
  let u
  try {
    // Een kale hostnaam krijgt https ervoor, want dan is er geen schema om te volgen.
    // Staat er WEL een schema, dan blijft het staan: http is bij de uitgever geldig en
    // stilzwijgend naar https tillen levert een andere plek dan hij publiceert.
    u = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : 'https://' + endpoint)
  } catch {
    return { klacht: 'the endpoint is not a usable url: ' + endpoint.slice(0, 60) }
  }
  if (u.username || u.password) {
    return { klacht: 'the endpoint must not carry credentials' }
  }
  const host = normaliseerHost(u.hostname)
  if (!host) return { klacht: 'the endpoint has no hostname' }
  // DE PLEK WORDT PRECIES ZO GEBOUWD ALS DE UITGEVER HEM BOUWT, en dat was hij niet.
  // Gemeten tegen hun eigen proofLocation in packages/endpoint-attest/src/ownership.ts:
  // bij dns-txt gebruikt die `hostname`, dus zonder poort, want een dns-naam kan geen
  // poort dragen. Bij well-known-file gebruikt die `${url.protocol}//${url.host}`, dus
  // MET poort en met het ECHTE schema, en hun parseEndpoint staat http uitdrukkelijk
  // toe. Wij bouwden hier 'https://' plus hostname, dus wij lieten de poort vallen en
  // dwongen https af. Gevolg, en dat is de valse beschuldiging waar deze hele controle
  // tegen bedoeld is: een eerlijke verkoper met een http-eindpunt of een poort die niet
  // 443 is, kreeg NIET TE METEN, of zelfs een harde NIET GESTEUND als er op 443
  // toevallig een ander bestand stond.
  if (methode === 'dns-txt') return { host, plek: DNS_LABEL + '.' + host }
  if (methode === 'well-known-file') {
    return { host, plek: u.protocol + '//' + u.host + WELL_KNOWN_PATH, schema: u.protocol }
  }
  return { klacht: 'unknown ownership method: ' + String(methode) }
}

/**
 * Wat zegt de genoemde plek, vergeleken met de plek die wij zelf afleiden?
 *
 * WAAROM DIT NOOIT DE UITKOMST BEPAALT, behalve bij een ander domein. De zachte
 * uitkomst mag niet door de verkoper te kiezen zijn. Een eerdere versie van deze
 * reparatie gaf NOT_MEASURED zodra de genoemde plek afweek van de afgesproken plek, en
 * dat liet een verkoper die niets leverde de zachte uitslag kiezen door simpelweg een
 * ander label op hetzelfde domein te noemen. Nu wordt ALTIJD de afgeleide plek gelezen
 * en is de genoemde plek alleen nog een mededeling. Een ander DOMEIN blijft hard, want
 * dan gaat het antwoord aantoonbaar over iets anders dan waarvoor betaald is.
 */
export function plekVergelijking(genoemdePlek, verwacht) {
  if (!genoemdePlek) return { gelijk: true }
  let genoemdeHost = normaliseerHost(genoemdePlek)
  if (/^https?:\/\//i.test(genoemdePlek)) {
    try {
      genoemdeHost = normaliseerHost(new URL(genoemdePlek).hostname)
    } catch { /* vorm al fout; de vergelijking hieronder wijst hem af */ }
  }
  const onderPaidHost = genoemdeHost === verwacht.host || genoemdeHost.endsWith('.' + verwacht.host)
  if (!onderPaidHost) {
    return {
      hard: 'the answer points at ' + genoemdeHost + ', which is not ' + verwacht.host +
        ', the host the caller paid about',
    }
  }
  const zelfdePlek = genoemdePlek === verwacht.plek ||
    normaliseerHost(genoemdePlek) === normaliseerHost(verwacht.plek)
  if (zelfdePlek) return { gelijk: true }
  return {
    waarschuwing: 'the answer names ' + genoemdePlek + ', this check read ' + verwacht.plek +
      ' instead, which is where the endpoint-attest convention puts it',
  }
}

/**
 * Staat het token er, exact?
 *
 * WAAROM EXACT EN NIET ALS DEELSTRING. De uitgever vergelijkt zelf exact. Een
 * deelvergelijking laat een token van acht tekens slagen zodra die reeks ergens in een
 * willekeurig record voorkomt, en dat was in de keuring de hele barriere: de drempel
 * bleek lengte in plaats van herkomst. Een TXT-record kan in stukken aankomen, dus die
 * horen eerst aan elkaar voor er vergeleken wordt.
 */
export function tokenStaatEr(waarden, token) {
  const t = String(token).trim()
  if (!t) return false
  return (waarden ?? []).some((w) => String(w).trim() === t)
}

/**
 * Lees de bron zelf, met een dak en een klok.
 */
async function haalDocument(url, fetchImpl) {
  const r = await fetchImpl(url, {
    redirect: 'error',
    headers: { accept: 'text/plain' },
    signal: AbortSignal.timeout(HAAL_TIJDSLIMIET_MS),
  })
  if (!r.ok) {
    // EEN HTTP-FOUTSTATUS IS EEN ANTWOORD VAN DE BRON, GEEN STORING VAN ONS. Een 404 op
    // het well-known pad betekent dat de klant daar niets heeft gepubliceerd, en dat is
    // bewijs van afwezigheid. Dit ging eerder naar NIET GEMETEN, waardoor een verkoper de
    // zachte uitslag kon kiezen door simpelweg de andere methode te noemen dan die de
    // klant gebruikte. Een 5xx is wel een storing, en blijft dus niet-gemeten.
    if (r.status >= 400 && r.status < 500) {
      return { afwezig: 'the location answered http ' + r.status + ', so nothing is published there' }
    }
    return { klacht: 'the location answered http ' + r.status }
  }
  // Het dak hoort OP de stroom. Pas na het inlezen knippen is geen grens.
  if (r.body && typeof r.body.getReader === 'function') {
    const lezer = r.body.getReader()
    const brokken = []
    let totaal = 0
    while (totaal < MAX_DOCUMENT) {
      const { done, value } = await lezer.read()
      if (done) break
      if (!value) continue
      totaal += value.byteLength ?? value.length ?? 0
      brokken.push(value)
    }
    try { await lezer.cancel() } catch { /* de bron is al weg, dat is hier geen fout */ }
    const samen = new Uint8Array(Math.min(totaal, MAX_DOCUMENT))
    let i = 0
    for (const b of brokken) {
      for (let k = 0; k < b.length && i < samen.length; k++) samen[i++] = b[k]
    }
    return { tekst: new TextDecoder().decode(samen) }
  }
  return { tekst: String(await r.text()).slice(0, MAX_DOCUMENT) }
}

/**
 * Zoek het token zelf op, bij de bron die de verkoper niet bezit.
 *
 * `endpoint` is VERPLICHT: het is de enige invoer die niet van de verkoper komt, en dus
 * het enige waaraan de plek gebonden kan worden. Zonder dat argument kan deze functie
 * met opzet niets groen noemen.
 */
export async function zoekToken(antwoord, opties = {}) {
  const { endpoint, resolveTxt = dns.resolveTxt, fetchImpl = fetch, lookup = dns.lookup } = opties
  const methode = antwoord?.method
  const token = antwoord?.token
  const genoemdePlek = typeof antwoord?.location === 'string' ? antwoord.location.trim() : ''

  if (typeof token !== 'string' || token.trim().length < 8) {
    // EEN ONBRUIKBAAR TOKEN IS EEN AFKEURING, GEEN ONVOLLEDIGE METING. Dit gaf eerder
    // NIET GEMETEN, en dat was een van de acht routes waarlangs een verkoper die niets
    // leverde toch de zachte uitslag kreeg: stuur een token van zeven tekens, of een
    // getal, en de uitslag was exitcode 2 in plaats van 1. Het token komt van de
    // verkoper. Onbruikbare waar sturen is zijn keuze, niet onze storing.
    return { outcome: 'NOT_SUPPORTED', reden: 'the answer carries no usable token' }
  }
  const verwacht = verwachtePlek(endpoint, methode)
  if (verwacht.klacht) return { outcome: 'NOT_MEASURED', reden: verwacht.klacht }

  // Gaat het antwoord over een ANDER domein dan waarvoor betaald is, dan is dat geen
  // storing maar een antwoord over iets anders, en dat is een afkeuring. Alle andere
  // afwijkingen zijn alleen een mededeling: we lezen hieronder toch de afgeleide plek.
  const vergelijking = plekVergelijking(genoemdePlek, verwacht)
  if (vergelijking.hard) return { outcome: 'NOT_SUPPORTED', reden: vergelijking.hard }
  const waarschuwing = vergelijking.waarschuwing

  if (methode === 'dns-txt') {
    if (!/^[a-z0-9._-]+$/i.test(verwacht.plek) || verwacht.plek.length > 253) {
      return { outcome: 'NOT_MEASURED', reden: 'not a usable dns name: ' + verwacht.plek }
    }
    let records
    try {
      records = await resolveTxt(verwacht.plek)
    } catch (e) {
      // AFWEZIGHEID IS EEN ANTWOORD, EEN STORING IS DAT NIET. Hier ging elke dns-fout
      // naar NIET GEMETEN, dus ook het geval dat de naam gewoon NIET BESTAAT. Dat is
      // precies het bewijs dat er niets gepubliceerd staat, net zoals "het token staat in
      // geen van de N records" dat is. Een resolver die uitvalt of weigert is wel een
      // echte storing aan onze kant. De codes komen uit node se eigen dns-module.
      const code = String(e?.code ?? '')
      const bestaatNiet = code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN'
      if (bestaatNiet) {
        return {
          outcome: 'NOT_SUPPORTED',
          reden: 'there is no TXT record at ' + verwacht.plek + ', so nothing is published there',
          waarschuwing,
        }
      }
      return { outcome: 'NOT_MEASURED', reden: 'dns lookup failed: ' + String(e?.message ?? e).slice(0, 90) }
    }
    const geplakt = (records ?? []).map((r) => (Array.isArray(r) ? r.join('') : String(r)))
    return tokenStaatEr(geplakt, token)
      ? { outcome: 'SUPPORTED', bron: 'dns TXT ' + verwacht.plek, records: geplakt.length, waarschuwing }
      : {
          outcome: 'NOT_SUPPORTED',
          reden: 'the token is not any of the ' + geplakt.length + ' TXT record(s) at ' + verwacht.plek,
          waarschuwing,
        }
  }

  if (methode === 'well-known-file') {
    const poort = await plekIsPubliek(verwacht.plek, { lookup })
    if (!poort.ok) return { outcome: 'NOT_MEASURED', reden: poort.reden }
    let uit
    try {
      uit = await haalDocument(poort.url.toString(), fetchImpl)
    } catch (e) {
      return { outcome: 'NOT_MEASURED', reden: 'fetch failed: ' + String(e?.message ?? e).slice(0, 90) }
    }
    if (uit.afwezig) return { outcome: 'NOT_SUPPORTED', reden: uit.afwezig, waarschuwing }
    if (uit.klacht) return { outcome: 'NOT_MEASURED', reden: uit.klacht }
    // HET HELE GETRIMDE LICHAAM, NIET EEN REGEL ERVAN, en dat is een correctie tegen mijn
    // eigen onderbouwing in. Dit bestand beargumenteert hierboven dat de vergelijking
    // exact is omdat de uitgever exact vergelijkt, en deed daarna iets ruimers: het token
    // werd geaccepteerd als ELKE regel van het document. Gemeten tegen de uitgever zelf
    // (packages/endpoint-attest/src/ownership.ts): die eist dat het getrimde lichaam
    // GELIJK is aan het token, en zegt er in zijn eigen commentaar bij waarom, namelijk
    // dat een token dat ergens in een verder onverwante pagina staat niet aantoont dat de
    // beheerder het met opzet heeft gepubliceerd. Een bestand met het token op een eigen
    // regel tussen html kwam bij ons uit op GESTEUND terwijl de echte poort het afwees.
    // Dat is de enige richting die echt telt: ons gereedschap zei waar over iets dat
    // geweigerd wordt.
    const lichaam = String(uit.tekst).trim()
    const platteNoot = poort.plattekst
      ? 'read over plain http, so anyone on the path could have written this answer'
      : null
    const samen = [waarschuwing, platteNoot].filter(Boolean).join('; ') || undefined
    return lichaam === String(token).trim()
      ? { outcome: 'SUPPORTED', bron: poort.url.toString(), records: 1, waarschuwing: samen }
      : {
          outcome: 'NOT_SUPPORTED',
          reden: 'the document at ' + poort.url.toString() + ' is not exactly the token',
          waarschuwing: samen,
        }
  }

  return { outcome: 'NOT_MEASURED', reden: 'unknown ownership method: ' + String(methode) }
}

/**
 * Toon een veld van een vreemde zonder dat hij de uitslag kan naschrijven.
 *
 * Zonder dit zet een verkoper stuurcodes of nieuwe regels in een veld en schrijft zo
 * zijn eigen SUPPORTED-regel in onze uitvoer, op de plek waar de mens kijkt.
 */
export function veiligVeld(waarde, max = 120) {
  const s = String(waarde ?? '')
  let uit = ''
  for (const teken of s) {
    const c = teken.codePointAt(0)
    uit += c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) ? '.' : teken
    if (uit.length >= max) return uit + '...'
  }
  return uit || '(none)'
}

const ditBestand = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ditBestand)) {
  const vlag = (naam) => process.argv.slice(2).find((a) => a.startsWith('--' + naam + '='))
  const antwoordVlag = vlag('answer')
  const endpointVlag = vlag('endpoint')
  if (!antwoordVlag || !endpointVlag) {
    console.log('usage: node src/verify-delivery.mjs --answer=<file> --endpoint=<url of the customer>')
    console.log('')
    console.log('--answer    the json a paid call returned: method, token, location, verifiedAt.')
    console.log('--endpoint  the url you paid to have checked. REQUIRED, and it is the point:')
    console.log('            the location is derived from this, never taken from the answer.')
    console.log('')
    console.log('This then reads that location itself, on the customer domain, and reports')
    console.log('whether the answer is TRUE. It does not claim the seller did any work, and it')
    console.log('cannot recompute the token, which is an hmac held by the issuer.')
    process.exitCode = 2
  } else {
    const pad = antwoordVlag.slice('--answer='.length)
    const endpoint = endpointVlag.slice('--endpoint='.length)
    let antwoord
    try {
      antwoord = JSON.parse(fs.readFileSync(pad, 'utf8'))
    } catch (e) {
      console.error('could not read the answer: ' + e.message)
      process.exit(2)
    }
    const verwacht = verwachtePlek(endpoint, antwoord?.method)
    console.log('what the seller answered:')
    console.log('  method     : ' + veiligVeld(antwoord?.method, 40))
    console.log('  token      : ' + veiligVeld(String(antwoord?.token ?? '').slice(0, 24)) + '...')
    console.log('  location   : ' + veiligVeld(antwoord?.location))
    console.log('  verifiedAt : ' + veiligVeld(antwoord?.verifiedAt, 40) + '   (shown, never checked)')
    console.log('')
    console.log('what this check reads instead, derived from --endpoint:')
    console.log('  ' + (verwacht.plek ? veiligVeld(verwacht.plek, 200) : verwacht.klacht))
    console.log('')
    const u = await zoekToken(antwoord, { endpoint })
    console.log('read independently, at a source the seller does not own:')
    if (u.waarschuwing) console.log('  note       : ' + veiligVeld(u.waarschuwing, 300))
    if (u.outcome === 'SUPPORTED') {
      console.log('  SUPPORTED  : the token really is published at ' + veiligVeld(u.bron, 200))
      console.log('  meaning    : the answer is TRUE. The public world agrees with it, and the')
      console.log('               location was derived here rather than taken from the answer.')
      console.log('  not shown  : that the seller did any work (the record is public, so he could')
      console.log('               have read it too), nor that this token is the right one for this')
      console.log('               customer (that needs the issuer key), nor that this answer')
      console.log('               belongs to one specific payment.')
      process.exit(0)
    }
    if (u.outcome === 'NOT_SUPPORTED') {
      console.log('  NOT SUPPORTED: ' + veiligVeld(u.reden, 300))
      console.log('  meaning      : the source was reachable and does not back this answer.')
      process.exit(1)
    }
    console.log('  NOT MEASURED : ' + veiligVeld(u.reden, 300))
    console.log('  meaning      : the check could not run. This is NOT a failed delivery, and')
    console.log('                 treating it as one would blame an honest seller for a dns fault.')
    process.exit(2)
  }
}
