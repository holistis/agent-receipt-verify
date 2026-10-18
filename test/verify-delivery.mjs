// De leveringscontroleur, en vooral de randen waar hij gevaarlijk zou zijn.
//
// WAAROM DEZE TEST GEEN NETWERK GEBRUIKT. Een test die het echte DNS opvraagt meet het
// internet, niet onze code, en wordt rood bij een storing die niets met ons te maken
// heeft. De opzoekers worden daarom ingespoten. De ECHTE keten wordt apart, een keer,
// live bewezen en vastgelegd; dat is bewijs, dit is een regressienet.
//
// WAT DE EERSTE EDITIE VAN DEZE TEST MISTE, en dat hoort hier te staan omdat het de
// reden is dat de rest bestaat. Hij toetste vijfentwintig gevallen groen terwijl de
// kernbelofte van het bestand onwaar was: de verkoper leverde de methode, het token EN
// de plek, en de vergelijking was een deelstring. Een eigen keuring draaide het
// faalscenario werkelijk: een bonnetje met plek google.com en token "v=spf1 include"
// kreeg SUPPORTED met exitcode 0, omdat die tekst in Googles SPF-record staat. De
// enige drempel was de LENGTE van het token, acht tekens, niet de HERKOMST. Elk geval
// onder "de aanval zelf" hieronder bestaat om precies dat te laten falen.
//
// VIJF SOORTEN CONTROLE.
// 1. De aanval zelf. De plek wordt AFGELEID uit het eindpunt waarvoor betaald is en
//    nooit overgenomen uit het bonnetje, en de vergelijking is exact.
// 2. De drie uitkomsten blijven gescheiden, EN de zachte uitkomst is niet door de
//    verkoper te kiezen. NIET GESTEUND en NIET TE METEN door elkaar halen betekent een
//    eerlijke verkoper beschuldigen bij een DNS-storing.
// 3. De poort op de plek, nu op het OPGELOSTE ADRES en niet op de naam, want een naam
//    als 127-0-0-1.nip.io is volkomen normaal en wijst naar binnen.
// 4. Het samenvoegen van opgesplitste TXT-records, want een lang token komt in stukken
//    aan en zou zichzelf anders missen.
// 5. De uitvoer is niet door een vreemde te beschrijven: stuurcodes en nieuwe regels in
//    een veld van de verkoper mogen onze eigen uitslagregel niet kunnen naschrijven.

import {
  zoekToken,
  plekIsPubliek,
  privaatAdres,
  normaliseerHost,
  verwachtePlek,
  tokenStaatEr,
  plekVergelijking,
  veiligVeld,
  DNS_LABEL,
  WELL_KNOWN_PATH,
  MAX_DOCUMENT,
} from '../src/verify-delivery.mjs'

let goed = 0, fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const TOKEN = 'endpoint-attest-0123456789abcdef'
const EINDPUNT = 'https://klant.example/api/iets'
const PLEK = DNS_LABEL + '.klant.example'
const ANTWOORD = {
  method: 'dns-txt',
  token: TOKEN,
  location: PLEK,
  verifiedAt: '2026-10-18T05:00:00Z',
}
// Een opzoeker die alles naar een gewoon publiek adres wijst, zodat de poort niet de
// reden is dat een test faalt die over iets anders gaat.
const PUBLIEK = async () => [{ address: '93.184.216.34', family: 4 }]

console.log('de aanval zelf, uit onze eigen keuring')

{
  // Dit is het letterlijke faalscenario. De plek van de verkoper wijst naar een vreemd
  // domein met een bekend publiek record erin.
  const nep = { method: 'dns-txt', token: 'v=spf1 include', location: 'google.com' }
  const u = await zoekToken(nep, {
    endpoint: EINDPUNT,
    resolveTxt: async () => [['v=spf1 include:_spf.google.com ~all']],
  })
  t('een plek op een vreemd domein is een afkeuring, geen groen licht',
    u.outcome === 'NOT_SUPPORTED', u.outcome + ' ' + (u.reden ?? ''))
  t('en de uitslag noemt beide hosts, zodat de mens het ziet',
    /google\.com/.test(u.reden ?? '') && /klant\.example/.test(u.reden ?? ''), u.reden ?? '')
}
{
  // Zonder eindpunt kan er niets gebonden worden, en dan mag er niets groen zijn.
  const u = await zoekToken(ANTWOORD, { resolveTxt: async () => [[TOKEN]] })
  t('zonder eindpunt is de uitslag NIET TE METEN, nooit SUPPORTED',
    u.outcome === 'NOT_MEASURED', u.outcome)
  t('en de reden zegt dat er niets is om aan te binden',
    /nothing to bind/.test(u.reden ?? ''), u.reden ?? '')
}
{
  // De deelvergelijking. Het token is een deelstring van het record maar niet gelijk.
  const u = await zoekToken(ANTWOORD, {
    endpoint: EINDPUNT,
    resolveTxt: async () => [['prefix-' + TOKEN + '-suffix']],
  })
  t('een deelstring is niet genoeg, de vergelijking is exact',
    u.outcome === 'NOT_SUPPORTED', u.outcome + ' ' + (u.reden ?? ''))
}
{
  // De plek wordt afgeleid, niet overgenomen: wat de verkoper noemt doet er niet toe
  // voor WELKE naam er opgevraagd wordt.
  let gevraagd = null
  await zoekToken({ ...ANTWOORD, location: 'iets-anders.klant.example' }, {
    endpoint: EINDPUNT,
    resolveTxt: async (naam) => { gevraagd = naam; return [[TOKEN]] },
  })
  t('de opgevraagde naam komt uit het eindpunt, niet uit het bonnetje',
    gevraagd === PLEK, String(gevraagd))
}
{
  // En de verkoper kan daarmee de ZACHTE uitkomst niet kiezen. Een ander label op het
  // eigen domein van de klant levert gewoon de echte uitslag, met een mededeling.
  const u = await zoekToken({ ...ANTWOORD, location: 'iets-anders.klant.example' }, {
    endpoint: EINDPUNT,
    resolveTxt: async () => [['een heel ander record']],
  })
  t('een ander label op hetzelfde domein geeft NIET GESTEUND, niet de zachte uitkomst',
    u.outcome === 'NOT_SUPPORTED', u.outcome + ' ' + (u.reden ?? ''))
  t('en de mededeling vertelt welke plek er echt gelezen is',
    /this check read/.test(u.waarschuwing ?? ''), u.waarschuwing ?? '')
}
{
  // Een bonnetje zonder plek is prima: we leiden hem toch zelf af.
  const u = await zoekToken({ method: 'dns-txt', token: TOKEN }, {
    endpoint: EINDPUNT,
    resolveTxt: async () => [[TOKEN]],
  })
  t('een bonnetje zonder plek werkt, want de plek was nooit nodig',
    u.outcome === 'SUPPORTED', u.outcome + ' ' + (u.reden ?? ''))
}

console.log('')
console.log('de plek wordt afgeleid volgens de afspraak van de dienst zelf')

{
  const d = verwachtePlek(EINDPUNT, 'dns-txt')
  t('dns-txt leidt naar het afgesproken label', d.plek === PLEK, String(d.plek))
  const w = verwachtePlek(EINDPUNT, 'well-known-file')
  t('well-known-file leidt naar het afgesproken pad',
    w.plek === 'https://klant.example' + WELL_KNOWN_PATH, String(w.plek))
}
{
  t('een leeg eindpunt is een klacht, geen stille terugval',
    Boolean(verwachtePlek('', 'dns-txt').klacht))
  t('een onbruikbaar eindpunt is een klacht',
    Boolean(verwachtePlek('dit is geen url met spaties', 'dns-txt').klacht))
  t('een onbekende methode is een klacht',
    Boolean(verwachtePlek(EINDPUNT, 'magie').klacht))
}
{
  // Een punt achter de hostnaam is dezelfde host, en mag de afleiding niet verschuiven.
  const d = verwachtePlek('https://klant.example./api', 'dns-txt')
  t('een punt achter de hostnaam verschuift de afgeleide plek niet', d.plek === PLEK, String(d.plek))
}
{
  const v = plekVergelijking('_endpoint-attest.klant.example', { host: 'klant.example', plek: PLEK })
  t('de afgesproken plek is gelijk', v.gelijk === true)
  const h = plekVergelijking('evil.example', { host: 'klant.example', plek: PLEK })
  t('een vreemd domein is hard', Boolean(h.hard))
  const w = plekVergelijking('anders.klant.example', { host: 'klant.example', plek: PLEK })
  t('een ander label op het eigen domein is alleen een mededeling', Boolean(w.waarschuwing))
}

console.log('')
console.log('de drie uitkomsten blijven gescheiden')

{
  const u = await zoekToken(ANTWOORD, { endpoint: EINDPUNT, resolveTxt: async () => [[TOKEN]] })
  t('het token staat er echt: SUPPORTED', u.outcome === 'SUPPORTED', u.reden ?? '')
}
{
  const u = await zoekToken(ANTWOORD, { endpoint: EINDPUNT, resolveTxt: async () => [['iets anders']] })
  t('de bron was bereikbaar en zegt nee: NOT_SUPPORTED', u.outcome === 'NOT_SUPPORTED', u.outcome)
}
{
  const u = await zoekToken(ANTWOORD, {
    endpoint: EINDPUNT,
    resolveTxt: async () => { throw new Error('ENOTFOUND') },
  })
  t('de bron was onbereikbaar: NOT_MEASURED, geen beschuldiging', u.outcome === 'NOT_MEASURED', u.outcome)
  t('en de reden noemt de opzoekfout', /dns lookup failed/.test(u.reden ?? ''), u.reden ?? '')
}
{
  const u = await zoekToken(ANTWOORD, { endpoint: EINDPUNT, resolveTxt: async () => [] })
  t('nul records is NIET GESTEUND, want de bron antwoordde wel',
    u.outcome === 'NOT_SUPPORTED', u.outcome)
}
{
  // BIJGESTELD, en de oude verwachting was de fout zelf. Dit stond op NIET TE METEN, en
  // dat was een van de acht routes waarlangs een verkoper die niets leverde toch de
  // zachte uitslag kreeg. Het token komt VAN DE VERKOPER: onbruikbare waar sturen is
  // zijn keuze en niet onze storing, dus het is een afkeuring.
  for (const slecht of [undefined, null, 42, '', 'kort', '       ']) {
    const u = await zoekToken({ method: 'dns-txt', token: slecht, location: PLEK },
      { endpoint: EINDPUNT, resolveTxt: async () => [[TOKEN]] })
    t('een onbruikbaar token (' + JSON.stringify(slecht) + ') is een AFKEURING',
      u.outcome === 'NOT_SUPPORTED', u.outcome)
  }
}
{
  const u = await zoekToken({ method: 'telepathie', token: TOKEN, location: PLEK },
    { endpoint: EINDPUNT, resolveTxt: async () => [[TOKEN]] })
  t('een onbekende methode is NIET TE METEN, geen afkeuring', u.outcome === 'NOT_MEASURED', u.outcome)
}

console.log('')
console.log('opgesplitste TXT-records horen aan elkaar voor er vergeleken wordt')

{
  const helft = TOKEN.slice(0, 14)
  const rest = TOKEN.slice(14)
  const u = await zoekToken(ANTWOORD, { endpoint: EINDPUNT, resolveTxt: async () => [[helft, rest]] })
  t('een in stukken aangekomen token wordt gevonden', u.outcome === 'SUPPORTED', u.outcome)
}
{
  const u = await zoekToken(ANTWOORD, {
    endpoint: EINDPUNT,
    resolveTxt: async () => [['iets'], [TOKEN], ['nog iets']],
  })
  t('het token mag in een van meerdere records staan', u.outcome === 'SUPPORTED', u.outcome)
}
{
  // Witruimte rond een record hoort niet uit te maken; een zetter zet soms een spatie.
  const u = await zoekToken(ANTWOORD, { endpoint: EINDPUNT, resolveTxt: async () => [['  ' + TOKEN + ' ']] })
  t('witruimte rond het record maakt niet uit', u.outcome === 'SUPPORTED', u.outcome)
}
{
  t('tokenStaatEr vergelijkt exact', tokenStaatEr(['abc'], 'abc') && !tokenStaatEr(['xabcx'], 'abc'))
  t('tokenStaatEr op een leeg token is nooit waar', !tokenStaatEr([''], '   '))
  t('tokenStaatEr op niets klapt niet', tokenStaatEr(null, 'abc') === false)
}

console.log('')
console.log('de poort kijkt naar het OPGELOSTE adres, niet naar de naam')

{
  // Dit is de kern van de tweede reparatie. Deze namen zijn volkomen normaal en wijzen
  // naar binnen. Een naamfilter kan dat per definitie niet zien.
  const binnen = [
    ['127-0-0-1.nip.io', '127.0.0.1'],
    ['localtest.me', '127.0.0.1'],
    ['169-254-169-254.nip.io', '169.254.169.254'],
    ['10-0-0-1.nip.io', '10.0.0.1'],
    ['172-16-0-1.nip.io', '172.16.0.1'],
    ['192-168-1-1.nip.io', '192.168.1.1'],
    ['100-64-0-1.nip.io', '100.64.0.1'],
  ]
  for (const [naam, adres] of binnen) {
    const r = await plekIsPubliek('https://' + naam + WELL_KNOWN_PATH, {
      lookup: async () => [{ address: adres, family: 4 }],
    })
    t('een gewone naam die naar ' + adres + ' wijst wordt geweigerd', r.ok === false, r.reden ?? 'ok')
  }
}
{
  // Een punt achter de naam zette eerder alle drie de naamregels buiten werking.
  for (const naam of ['localhost.', 'iets.local.', 'iets.internal.']) {
    const r = await plekIsPubliek('https://' + naam + WELL_KNOWN_PATH, { lookup: PUBLIEK })
    t('een punt achter "' + naam + '" omzeilt de poort niet', r.ok === false, r.reden ?? 'ok')
  }
}
{
  // Een naam die naar meerdere adressen wijst waarvan EEN naar binnen gaat.
  const r = await plekIsPubliek('https://dubbel.example' + WELL_KNOWN_PATH, {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
  })
  t('een van de adressen naar binnen is genoeg om te weigeren', r.ok === false, r.reden ?? 'ok')
}
{
  const r = await plekIsPubliek('https://stuk.example' + WELL_KNOWN_PATH, {
    lookup: async () => { throw new Error('ENOTFOUND') },
  })
  t('niet op te lossen is GEEN groen licht', r.ok === false, r.reden ?? 'ok')
  const leeg = await plekIsPubliek('https://leeg.example' + WELL_KNOWN_PATH, { lookup: async () => [] })
  t('geen adres is ook geen groen licht', leeg.ok === false, leeg.reden ?? 'ok')
}
{
  const geweigerd = [
    // http staat hier NIET meer bij: de uitgever staat het toe en publiceert er ook op,
    // dus het weigeren was onze eigen, strengere regel die een eerlijke verkoper afkeurde.
    // De echte grens zit op het opgeloste adres, en die staat hieronder volledig.
    'ftp://example.com/pad',
    'file:///etc/passwd',
    'https://gebruiker:geheim@example.com/pad',
    'https://localhost/pad',
    'https://iets.localhost/pad',
    'https://iets.local/pad',
    'https://iets.internal/pad',
    'https://127.0.0.1/pad',
    'https://10.1.2.3/pad',
    'https://192.168.1.1/pad',
    'https://172.20.0.1/pad',
    'https://169.254.169.254/pad',
    'https://100.100.0.1/pad',
    'https://0.0.0.0/pad',
    'https://[::1]/pad',
    'niet eens een url met spaties',
  ]
  for (const g of geweigerd) {
    const r = await plekIsPubliek(g, { lookup: PUBLIEK })
    t('geweigerd: ' + g, r.ok === false, r.reden ?? 'ok')
  }
}
{
  const r = await plekIsPubliek('https://example.com' + WELL_KNOWN_PATH, { lookup: PUBLIEK })
  t('een echt publiek adres mag er wel door', r.ok === true, r.reden ?? '')
}
{
  // privaatAdres los, want hij is de enige echte beslisser hierboven.
  t('privaatAdres kent de ipv4-bereiken',
    privaatAdres('10.0.0.1') && privaatAdres('127.0.0.1') && privaatAdres('169.254.169.254') &&
    privaatAdres('100.64.0.1') && privaatAdres('0.0.0.0') && privaatAdres('224.0.0.1') &&
    privaatAdres('192.0.0.1') && !privaatAdres('93.184.216.34'))
  t('privaatAdres kent de ipv6-vormen',
    privaatAdres('::1') && privaatAdres('fd00::1') && privaatAdres('fe80::1') &&
    privaatAdres('ff02::1') && !privaatAdres('2606:2800:220:1:248:1893:25c8:1946'))
  t('een ipv4-adres verstopt in een ipv6-vorm wordt ook gezien',
    Boolean(privaatAdres('::ffff:127.0.0.1')), String(privaatAdres('::ffff:127.0.0.1')))
  t('onzin is geen geldig adres en dus geweigerd', Boolean(privaatAdres('geen adres')))
  t('normaliseerHost haalt punten weg en maakt klein',
    normaliseerHost('Voorbeeld.Example..') === 'voorbeeld.example')
}

console.log('')
console.log('het ophalen heeft een dak en een klok')

{
  // Een bron die eindeloos blijft sturen mag het geheugen niet opvreten. De lezer hier
  // levert meer dan het dak toestaat en telt hoeveel brokken er zijn opgevraagd.
  let brokken = 0
  const brok = new Uint8Array(8192).fill(97)
  const stroom = {
    getReader: () => ({
      read: async () => { brokken++; return { done: false, value: brok } },
      cancel: async () => {},
    }),
  }
  const u = await zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async () => ({ ok: true, body: stroom }),
  })
  t('een eindeloze bron wordt afgekapt in plaats van ingeslikt',
    u.outcome === 'NOT_SUPPORTED', u.outcome)
  t('en er zijn niet meer brokken gelezen dan het dak toestaat',
    brokken <= Math.ceil(MAX_DOCUMENT / 8192) + 1, 'brokken=' + brokken)
}
{
  // De klok. Een verzoek moet een abortsignaal meekrijgen, anders hangt het voor altijd.
  let gezienSignaal = null
  await zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async (_u, opties) => {
      gezienSignaal = opties?.signal ?? null
      return { ok: true, text: async () => TOKEN }
    },
  })
  t('het verzoek krijgt een tijdslimiet mee', gezienSignaal !== null && typeof gezienSignaal === 'object',
    String(gezienSignaal))
}
{
  // Een omleiding hoort niet gevolgd te worden: dat is de tweede sprong waarmee een
  // publieke naam je alsnog naar binnen stuurt.
  let gezien = null
  await zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async (_u, opties) => {
      gezien = opties?.redirect
      return { ok: true, text: async () => TOKEN }
    },
  })
  t('omleidingen worden niet gevolgd', gezien === 'error', String(gezien))
}
{
  const u = await zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async () => ({ ok: false, status: 404 }),
  })
  // BIJGESTELD. Een 404 is een ANTWOORD van de bron: er staat daar niets. Dat is bewijs
  // van afwezigheid, net zoals "het token staat in geen van de N records" dat is. Op
  // NIET TE METEN kon een verkoper de zachte uitslag kiezen door simpelweg de andere
  // methode te noemen dan die de klant gebruikte.
  t('een 404 op de plek is een AFKEURING, want de bron zei dat er niets staat',
    u.outcome === 'NOT_SUPPORTED', u.outcome)
}
{
  const u = await zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async () => { throw new Error('socket hangup') },
  })
  t('een kapotte verbinding is NIET TE METEN', u.outcome === 'NOT_MEASURED', u.outcome)
}
{
  // Het bestand bevat het token op een eigen regel tussen andere regels.
  const u = await zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async () => ({ ok: true, text: async () => '# commentaar\n' + TOKEN + '\nnog een regel\n' }),
  })
  // BIJGESTELD, en deze legde de interop-fout vast. De uitgever eist dat het GETRIMDE
  // LICHAAM gelijk is aan het token, met als eigen onderbouwing dat een token ergens in
  // een onverwante pagina niet aantoont dat de beheerder het met opzet publiceerde. Wij
  // accepteerden elke REGEL, dus wij zeiden GESTEUND over een bestand dat de echte poort
  // afwijst. Dat is de enige richting die echt telt.
  t('het token op een eigen regel tussen andere regels is NIET genoeg',
    u.outcome === 'NOT_SUPPORTED', u.outcome)
}
{
  // En een regel die het token alleen BEVAT is niet genoeg.
  const u = await zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async () => ({ ok: true, text: async () => 'token=' + TOKEN + ';' }),
  })
  t('een regel die het token alleen bevat is niet genoeg', u.outcome === 'NOT_SUPPORTED', u.outcome)
}
{
  // En de plek die opgehaald wordt is de AFGELEIDE plek, niet die van de verkoper.
  let opgehaald = null
  await zoekToken({ method: 'well-known-file', token: TOKEN, location: 'https://klant.example/ergens-anders' }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async (u) => { opgehaald = String(u); return { ok: true, text: async () => TOKEN } },
  })
  t('de opgehaalde url is de afgeleide url',
    opgehaald === 'https://klant.example' + WELL_KNOWN_PATH, String(opgehaald))
}

console.log('')
console.log('een vreemde kan onze eigen uitslagregel niet naschrijven')

{
  const ESC = String.fromCharCode(27)
  const kwaad = 'ok' + ESC + '[2K' + String.fromCharCode(13) + 'SUPPORTED  : alles is in orde' + String.fromCharCode(10) + 'meaning    : vertrouw mij'
  const schoon = veiligVeld(kwaad, 300)
  t('stuurcodes worden onschadelijk gemaakt', !schoon.includes(ESC), schoon.slice(0, 40))
  t('nieuwe regels worden onschadelijk gemaakt', !/\n/.test(schoon) && !/\r/.test(schoon))
  t('en de tekst blijft wel leesbaar', schoon.includes('SUPPORTED'), schoon.slice(0, 60))
  t('een leeg veld wordt zichtbaar leeg', veiligVeld(undefined) === '(none)')
  t('een eindeloos veld wordt afgekapt', veiligVeld('a'.repeat(5000), 50).length <= 53)
}


console.log('')
console.log('afwezigheid is een antwoord, een storing is dat niet')

{
  // De dns-tak. Een naam die NIET BESTAAT is bewijs dat er niets gepubliceerd staat.
  // Een resolver die uitvalt of weigert is een storing aan onze kant. Eerder gingen die
  // twee allebei naar NIET TE METEN.
  const metCode = (code) => async () => { const e = new Error(code); e.code = code; throw e }
  for (const code of ['ENOTFOUND', 'ENODATA', 'NXDOMAIN']) {
    const u = await zoekToken(ANTWOORD, { endpoint: EINDPUNT, resolveTxt: metCode(code) })
    t('dns ' + code + ' is een AFKEURING, want de naam bestaat niet',
      u.outcome === 'NOT_SUPPORTED', u.outcome + ' ' + (u.reden ?? ''))
  }
  for (const code of ['ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'EREFUSED']) {
    const u = await zoekToken(ANTWOORD, { endpoint: EINDPUNT, resolveTxt: metCode(code) })
    t('dns ' + code + ' blijft NIET TE METEN, want dat is een storing',
      u.outcome === 'NOT_MEASURED', u.outcome + ' ' + (u.reden ?? ''))
  }
  const zonderCode = await zoekToken(ANTWOORD, {
    endpoint: EINDPUNT,
    resolveTxt: async () => { throw new Error('iets onbekends') },
  })
  t('een dns-fout zonder code blijft NIET TE METEN, fail-closed naar zacht',
    zonderCode.outcome === 'NOT_MEASURED', zonderCode.outcome)
}
{
  // De http-tak. 4xx is een antwoord, 5xx is een storing.
  for (const status of [400, 403, 404, 410]) {
    const u = await zoekToken({ method: 'well-known-file', token: TOKEN }, {
      endpoint: EINDPUNT,
      lookup: PUBLIEK,
      fetchImpl: async () => ({ ok: false, status }),
    })
    t('http ' + status + ' is een AFKEURING', u.outcome === 'NOT_SUPPORTED', u.outcome)
  }
  for (const status of [500, 502, 503]) {
    const u = await zoekToken({ method: 'well-known-file', token: TOKEN }, {
      endpoint: EINDPUNT,
      lookup: PUBLIEK,
      fetchImpl: async () => ({ ok: false, status }),
    })
    t('http ' + status + ' blijft NIET TE METEN', u.outcome === 'NOT_MEASURED', u.outcome)
  }
}

console.log('')
console.log('de plek volgt de uitgever: met poort, met het echte schema')

{
  // GEMETEN TEGEN proofLocation in packages/endpoint-attest/src/ownership.ts. Wij bouwden
  // 'https://' plus hostname, dus zonder poort en met https afgedwongen, terwijl de
  // uitgever protocol plus host gebruikt en http uitdrukkelijk toestaat. Een eerlijke
  // verkoper met http of een andere poort werd daardoor onterecht afgekeurd.
  const paren = [
    ['https://klant.example/mcp', 'https://klant.example' + WELL_KNOWN_PATH],
    ['http://klant.example/mcp', 'http://klant.example' + WELL_KNOWN_PATH],
    ['https://klant.example:8443/mcp', 'https://klant.example:8443' + WELL_KNOWN_PATH],
    ['http://klant.example:8080/mcp', 'http://klant.example:8080' + WELL_KNOWN_PATH],
  ]
  for (const [endpoint, verwacht] of paren) {
    const w = verwachtePlek(endpoint, 'well-known-file')
    t(endpoint + ' leidt naar ' + verwacht, w.plek === verwacht, String(w.plek))
    // En de dns-plek draagt NOOIT een poort, want een dns-naam kan er geen hebben.
    const d = verwachtePlek(endpoint, 'dns-txt')
    t(endpoint + ' geeft een dns-naam zonder poort', d.plek === DNS_LABEL + '.klant.example', String(d.plek))
  }
}
{
  t('inloggegevens in het eindpunt zijn een klacht, zoals bij de uitgever',
    Boolean(verwachtePlek('https://gebruiker:geheim@klant.example/mcp', 'dns-txt').klacht))
}
{
  // Een http-plek mag gelezen worden, en de uitslag hoort te zeggen dat het plat was.
  const u = await zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: 'http://klant.example/mcp',
    lookup: PUBLIEK,
    fetchImpl: async () => ({ ok: true, text: async () => TOKEN }),
  })
  t('een http-plek wordt gelezen in plaats van geweigerd', u.outcome === 'SUPPORTED', u.outcome + ' ' + (u.reden ?? ''))
  t('en de uitslag zegt dat het over platte http ging',
    /plain http/.test(u.waarschuwing ?? ''), u.waarschuwing ?? '(geen)')
}
{
  // Het hele lichaam moet gelijk zijn, met witruimte eromheen als enige tolerantie.
  const leest = (tekst) => zoekToken({ method: 'well-known-file', token: TOKEN }, {
    endpoint: EINDPUNT,
    lookup: PUBLIEK,
    fetchImpl: async () => ({ ok: true, text: async () => tekst }),
  })
  t('precies het token is genoeg', (await leest(TOKEN)).outcome === 'SUPPORTED')
  t('witruimte en een nieuwe regel eromheen mag', (await leest('  ' + TOKEN + ' \n')).outcome === 'SUPPORTED')
  t('het token met een commentaarregel erboven is NIET genoeg',
    (await leest('# commentaar\n' + TOKEN)).outcome === 'NOT_SUPPORTED')
  t('het token in een langere regel is NIET genoeg',
    (await leest('token=' + TOKEN + ';')).outcome === 'NOT_SUPPORTED')
}

console.log('')
console.log('verify-delivery: ' + goed + ' pass, ' + fout + ' fail')
if (fout) process.exit(1)
