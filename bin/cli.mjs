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
//   npx -y agent-receipt-verify https://een-eindpunt.example/pad
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

// De helptekst is ENGELS, en dat is geen voorkeur maar een gemeten noodzaak. Koud
// gedraaid vanuit een lege map op 18 oktober 2026 bleek het eerste scherm dat een vreemde
// ziet half Nederlands, terwijl iedereen die dit gereedschap in de x402- en
// erc-8004-draden gaat draaien Engels schrijft. Het meetresultaat zelf was al Engels, dus
// alleen de ingang stond nog in de weg. En de regel over wat dit NIET meet stond midden
// in de lijst in plaats van eronder, waar een lezer hem pas leest nadat hij weet wat het
// wel doet.
function gebruik() {
  console.log('agent-receipt-verify, an independent check on receipts for agent payments')
  console.log('')
  console.log('  npx -y agent-receipt-verify <url> [url ...]')
  console.log('        measures an x402 endpoint against the ladder in CONFORMANCE.md (levels 0')
  console.log('        to 2, without paying). Levels 3 to 5 need a real settlement and come back')
  console.log('        as NOT MEASURED, never as a failure.')
  console.log('')
  console.log('  npx -y agent-receipt-verify census [out.json]')
  console.log('        counts a discovery index per host instead of per resource.')
  console.log('')
  console.log('  npx -y agent-receipt-verify link --receipt=<file>')
  console.log('        for a version 2 receipt, finds the settlement it belongs to on chain. If the')
  console.log('        public node no longer has the block it asks a keyless explorer and says so')
  console.log('        (--no-explorer forbids that).')
  console.log('')
  console.log('  npx -y agent-receipt-verify ground --feedback=<tx hash>')
  console.log('        is an ERC-8004 feedback grounded in a payment? Four facts read from the chain, the ones')
  console.log('        AgenticFinanceGraph uses, plus one: does the feedbackHash open through the receipt.')
  console.log('')
  console.log('  npx -y agent-receipt-verify suite')
  console.log('        one suite, four assurances: attempt identity, payment authorization, receipt to')
  console.log('        settlement, feedback grounded in a payment. Offline, one table, exit 1 on any failure.')
  console.log('')
  console.log('  npx -y agent-receipt-verify mcp')
  console.log('        runs as an MCP server over stdio, so an agent CALLS this check instead of')
  console.log('        being advised to run it. Two tools: check an endpoint before you pay, and')
  console.log('        link a receipt to a real settlement.')
  console.log('')
  console.log('  npx -y agent-receipt-verify inam <vectors.json>')
  console.log('        checks countersigned receipts against published vectors.')
  console.log('')
  console.log('  npx -y agent-receipt-verify kanon')
  console.log('        cross-check our independent EIP-3009 verifier against the ten published')
  console.log('        vectors of iamonuwa/kanon, offline, no account and no key.')
  console.log('')
  console.log('  npx -y agent-receipt-verify beleid')
  console.log('        the same ten vectors under both amount policies, plus the two cases no')
  console.log('        published vector covers: overpayment, and one nonce across two payers.')
  console.log('        Those two are the open questions in x402 issue 2725.')
  console.log('')
  console.log('  npx -y agent-receipt-verify liveness [out.json]')
  console.log('        takes the census and asks each host whether it still answers 402 today.')
  console.log('        A registration in an index is not a promise that the endpoint is alive.')
  console.log('')
  console.log('  npx -y agent-receipt-verify verify-delivery --answer=<file> --endpoint=<url>')
  console.log('        reads, at the source, whether a paid answer is TRUE. The location is')
  console.log('        DERIVED from --endpoint and never taken from the answer, because a seller')
  console.log('        who picks both the token and the place can stage any outcome.')
  console.log('')
  console.log('  npx -y agent-receipt-verify link-vectors')
  console.log('        twelve vectors for the half AFTER paying: does this receipt belong to')
  console.log('        that one settlement? Eleven run offline, the chain-reading one is')
  console.log('        marked and skipped rather than failed.')
  console.log('')
  console.log('  npx -y agent-receipt-verify attempt-identity')
  console.log('        sixty-two vectors for the question the other layers assume: are these')
  console.log('        records about the SAME attempt? One acceptance and at least one refusal')
  console.log('        per normative clause of x402 spec section 5.5. Offline.')
  console.log('')
  console.log('What this does NOT do: it judges the SHAPE of a receipt, not the honesty of')
  console.log('the party that issued it. See CONFORMANCE.md for what is deliberately left')
  console.log('unmeasured.')
}

// Het argument bepaalt welke module draait. De modules zijn ook los te draaien en te
// importeren; dit bestand voegt alleen een ingang toe, geen tweede implementatie,
// want twee plekken die hetzelfde doen lopen altijd uit elkaar.
const onderdelen = {
  mcp: '../src/mcp-server.mjs',
  census: '../src/x402-discovery-census.mjs',
  link: '../src/x402-link-onchain.mjs',
  ground: '../src/x402-grounding.mjs',
  suite: '../src/conformance-suite.mjs',
  inam: '../src/inam-countersigned.mjs',
  liveness: '../src/x402-index-liveness.mjs',
  kanon: '../src/eip3009-autorisatie.mjs',
  beleid: '../bench/eip3009-beleid.mjs',
  'link-vectors': '../src/settlement-link-vectors.mjs',
  'attempt-identity': '../src/attempt-identity.mjs',
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
  console.log('unknown command: ' + eerste)
  console.log('')
  gebruik()
  process.exitCode = 2
}
