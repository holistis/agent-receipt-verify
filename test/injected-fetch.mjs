// Test: de fetchImpl die een aanroeper meegeeft bereikt OOK het ophalen van het did:web-document.
//
// WAAROM DIT BESTAAT. meetEindpunt kreeg een fetchImpl mee en gebruikte die voor de aanvraag
// aan het eindpunt, maar riep daarna verifyOfferSignature zonder die fetchImpl aan. Het
// did:web-document werd daardoor met de GLOBALE fetch opgehaald. Wie dit gereedschap achter
// een eigen afscherming draait (bijvoorbeeld een webdienst die alleen publieke adressen mag
// aanroepen) had dus een gat: de gemeten partij bepaalt zelf welke kid er in zijn aanbod
// staat, en daarmee welk adres er extra wordt opgehaald.
//
// De test zet de globale fetch op een functie die de test laat falen, en geeft meetEindpunt
// een eigen fetchImpl. Gaat het did.json-verzoek toch langs de globale fetch, dan faalt dit.

import { meetEindpunt } from '../src/x402-conformance-check.mjs'

let goed = 0
let fout = 0
const toets = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

// Het echte JWS-aanbod uit test/jws-offer.mjs, met een did:web-kid op een vreemde host.
const ECHTE_JWS =
  'eyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDp3ZWI6YWdlbnRzLmRhZWRhbHVzZGV2ZWxvcG1lbnRncm91cC5jb20ja2V5cy0xIn0.' +
  'eyJ2ZXJzaW9uIjoxLCJyZXNvdXJjZVVybCI6Imh0dHBzOi8vYWdlbnRzLmRhZWRhbHVzZGV2ZWxvcG1lbnRncm91cC5jb20vdjEv' +
  'ZW1haWwtc2VuZCIsInNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6ImVpcDE1NTo4NDUzIiwiYXNzZXQiOiIweDgzMzU4OWZDRDZl' +
  'RGI2RTA4ZjRjN0MzMkQ0ZjcxYjU0YmRBMDI5MTMiLCJwYXlUbyI6IjB4OEFmQkQ1MjJGOGExNkJFYTE4NGI0MWM1OTNCODkyNWE2' +
  'NjgzMEJjNiIsImFtb3VudCI6IjEwMDAwIiwidmFsaWRVbnRpbCI6MTc5MjIzMzQ4N30.' +
  'upSN4bcrrGOsn4x9i1wWGtqFYtE1FDdS7Nd3LX1o7Mr0mQ1B3BxUgrROm5BBVCu3RmjC2Zgu0wCGY0jcqbXWAA'

const aanbod = {
  accepts: [{ scheme: 'exact', network: 'eip155:8453', payTo: '0x8AfBD522F8a16BEa184b41c593B8925a66830BC6', amount: '10000' }],
  extensions: { 'offer-receipt': { info: { offers: [{ format: 'jws', signature: ECHTE_JWS }] } } },
}
const kop = Buffer.from(JSON.stringify(aanbod)).toString('base64')

const aangeroepen = []
const mijnFetch = async (url) => {
  aangeroepen.push(String(url))
  if (String(url).endsWith('/did.json')) return new Response('{}', { status: 404 })
  return new Response('{}', { status: 402, headers: { 'payment-required': kop } })
}

const echteFetch = globalThis.fetch
let globaalAangeroepen = 0
globalThis.fetch = async () => {
  globaalAangeroepen++
  throw new Error('de globale fetch mag hier niet gebruikt worden')
}
try {
  await meetEindpunt('https://voorbeeld.example/api', { fetchImpl: mijnFetch, methode: 'GET' })
} finally {
  globalThis.fetch = echteFetch
}

toets('de globale fetch is niet aangeroepen', globaalAangeroepen === 0, 'aantal: ' + globaalAangeroepen)
toets(
  'het did.json-verzoek ging door de meegegeven fetchImpl',
  aangeroepen.includes('https://agents.daedalusdevelopmentgroup.com/.well-known/did.json'),
  aangeroepen.join(' | '),
)

console.log(`\n${goed} geslaagd, ${fout} gefaald`)
if (fout > 0) process.exit(1)
