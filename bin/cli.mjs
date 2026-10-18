#!/usr/bin/env node
// Een commando in plaats van een document.
//
// WAAROM DIT BESTAAT. Niemand neemt een meetlat over omdat die in een bestand staat.
// Mensen nemen hem over als het makkelijkste wat ze kunnen doen een regel is die hun
// eigen eindpunt nakijkt. Dan is de ladder de norm geworden zonder dat er ooit over
// gestemd is.
//
// BEWUST GEEN NPM-PUBLICATIE NODIG. npx kan een pakket rechtstreeks uit een git-repo
// draaien, dus dit werkt zonder dat er iets op npm staat:
//
//   npx github:holistis/agent-receipt-verify https://een-eindpunt.example/pad
//
// Dat is geen trucje maar een echte eigenschap van npx, en het haalt een hele
// publicatie-stap plus een naamclaim weg. Het betekent ook dat niemand een
// tussenversie van ons kan uitgeven: wat je draait is wat er in de repo staat.
//
// ethers is OPTIONEEL. Zonder ethers kan trede 2 van een eip712-aanbod niet
// gecontroleerd worden, en dan zegt de uitslag ONGEMETEN in plaats van stil een
// zwakkere controle te doen. Een jws-aanbod werkt wel zonder ethers, want dat gaat
// op ingebouwde crypto.

const args = process.argv.slice(2)
const eerste = args[0]

function gebruik() {
  console.log('agent-receipt-verify, een onafhankelijke controle op bonnetjes van agent-betalingen')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify <url> [url ...]')
  console.log('        meet een x402-eindpunt tegen de ladder in CONFORMANCE.md (trede 0 tot 2,')
  console.log('        zonder te betalen). Trede 3 tot 5 vereisen een echte afrekening en komen')
  console.log('        terug als ONGEMETEN, nooit als afgekeurd.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify census [uit.json]')
  console.log('        telt een discovery-index per host in plaats van per resource.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify link --receipt=<bestand>')
  console.log('        zoekt bij een bonnetje van versie 2 de bijbehorende afrekening op de keten.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify mcp')
  console.log('        draait als MCP-server over stdio, zodat een agent deze controle AANROEPT')
  console.log('        in plaats van hem aanbevolen te krijgen. Twee gereedschappen: controleer een')
  console.log('        eindpunt voor je betaalt, en link een bonnetje aan een echte afrekening.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify inam <vectors.json>')
  console.log('        controleert countersigned bonnetjes tegen gepubliceerde vectoren.')
  console.log('')
  console.log('Wat dit NIET doet: het oordeelt over de VORM van een bonnetje, niet over de')
  console.log('eerlijkheid van de partij die het afgaf. Zie CONFORMANCE.md voor wat met opzet')
  console.log('niet gemeten wordt.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify kanon')
  console.log('        cross-check our independent EIP-3009 verifier against the ten published')
  console.log('        vectors of iamonuwa/kanon, offline, no account and no key.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify beleid')
  console.log('        the same ten vectors under both amount policies, plus the two cases no')
  console.log('        published vector covers: overpayment, and one nonce across two payers.')
  console.log('        Those two are the open questions in x402 issue 2725.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify liveness [uit.json]')
  console.log('        takes the census and asks each host whether it still answers 402 today.')
  console.log('        A registration in an index is not a promise that the endpoint is alive.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify verify-delivery --answer=<file> --endpoint=<url>')
  console.log('        reads, at the source, whether a paid answer is TRUE. The location is')
  console.log('        DERIVED from --endpoint and never taken from the answer, because a seller')
  console.log('        who picks both the token and the place can stage any outcome.')
  console.log('')
  console.log('  npx github:holistis/agent-receipt-verify link-vectors')
  console.log('        twelve vectors for the half AFTER paying: does this receipt belong to')
  console.log('        that one settlement? Eleven run offline, the chain-reading one is')
  console.log('        marked and skipped rather than failed.')
}

// Het argument bepaalt welke module draait. De modules zijn ook los te draaien en te
// importeren; dit bestand voegt alleen een ingang toe, geen tweede implementatie,
// want twee plekken die hetzelfde doen lopen altijd uit elkaar.
const onderdelen = {
  mcp: '../src/mcp-server.mjs',
  census: '../src/x402-discovery-census.mjs',
  link: '../src/x402-link-onchain.mjs',
  inam: '../src/inam-countersigned.mjs',
  liveness: '../src/x402-index-liveness.mjs',
  kanon: '../src/eip3009-autorisatie.mjs',
  beleid: '../bench/eip3009-beleid.mjs',
  'link-vectors': '../src/settlement-link-vectors.mjs',
  'verify-delivery': '../src/verify-delivery.mjs',
}

if (!eerste || eerste === '--help' || eerste === '-h' || eerste === 'help') {
  gebruik()
  process.exitCode = eerste ? 0 : 2
} else if (onderdelen[eerste]) {
  // De doorgegeven argumenten zo neerzetten dat de module zijn eigen cli-tak kiest:
  // die kijkt naar process.argv[1], dus die moet naar de module zelf wijzen.
  const { fileURLToPath } = await import('node:url')
  const pad = fileURLToPath(new URL(onderdelen[eerste], import.meta.url))
  process.argv = [process.argv[0], pad, ...args.slice(1)]
  await import(onderdelen[eerste])
} else if (/^https?:\/\//.test(eerste)) {
  const { fileURLToPath } = await import('node:url')
  const pad = fileURLToPath(new URL('../src/x402-conformance-check.mjs', import.meta.url))
  process.argv = [process.argv[0], pad, ...args]
  await import('../src/x402-conformance-check.mjs')
} else {
  console.log('onbekend: ' + eerste)
  console.log('')
  gebruik()
  process.exitCode = 2
}
