// Een MCP-server, zodat een agent deze controle AANROEPT in plaats van hem te moeten
// aanbevelen.
//
// WAAROM DIT BESTAAT, en het is gemeten en niet bedacht. Op 2026-10-17 classificeerde
// de gratis laag 32 marktsignalen over agent-betalingen: 14 benoemen een concreet
// probleem en alle 14 staan aan de KOPERSKANT. Niet een enkel verkopersprobleem. De
// titels zeggen het zelf: "5 Ways Your Paid Endpoint Gets Drained", "your agent still
// needs a bill", en "Your AI Agent Paid a Supplier Twice. Can You Prove What It Did?"
// In dezelfde ronde bleken er in de MCP-directories al zeven partijen DATA te
// verkopen over x402 en geen enkele die de betaallaag zelf controleert.
//
// Dat is de hele reden voor deze twee gereedschappen: het voor en het na van die ene
// pijn. Voor je betaalt, klopt dit eindpunt. Na je betaling, hoort dit bonnetje bij
// precies een echte betaling.
//
// GEEN AFHANKELIJKHEDEN, EN DAT IS EEN KEUZE EN GEEN LUIHEID. Dit protocol is
// newline-gescheiden JSON-RPC over stdio, dat is een paar regels. De officiele
// bibliotheek erbij halen zou betekenen dat een verifieerder wiens hele waarde
// onafhankelijkheid is, een boom afhankelijkheden meeneemt om te zeggen of een
// handtekening klopt. De vormen hieronder zijn overgenomen uit de officiele sdk die
// in ons andere project staat, niet uit het hoofd: protocolversie, de tools-vorm en
// de content-vorm komen daar letterlijk uit.
//
// DE VALKUIL DIE EEN MCP-SERVER STIL KAPOT MAAKT: alles wat naar stdout gaat en geen
// JSON-RPC-frame is, breekt de verbinding. Daarom gaat ELKE melding naar stderr en
// schrijft alleen `stuur()` naar stdout.
//
// GEBRUIK (in een MCP-client):
//   npx github:holistis/agent-receipt-verify mcp
//
// WAT DIT NIET DOET: het oordeelt over de VORM van een eindpunt en een bonnetje, niet
// over de eerlijkheid van de partij erachter. Een eindpunt dat alles goed doet kan je
// alsnog rommel verkopen. Zie CONFORMANCE.md voor wat met opzet niet gemeten wordt.

import { meetEindpunt, hoogsteTrede } from './x402-conformance-check.mjs'
import { TREDEN } from './x402-conformance-treden.mjs'
import { maakRpc, linkBonnetje } from './x402-link-onchain.mjs'

const PROTOCOL = '2025-11-25'
const ONDERSTEUND = [PROTOCOL, '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']

const NAAM = 'agent-receipt-verify'
const VERSIE = '0.2.0'

// Een publieke rpc per netwerk, zodat de koper niet eerst een sleutel hoeft te regelen
// om zijn eigen bonnetje te kunnen natrekken. Een netwerk dat hier niet staat wordt
// EERLIJK als niet-ondersteund gemeld en nooit stil op een ander netwerk gezocht.
const RPC_PER_NETWERK = {
  'eip155:84532': 'https://sepolia.base.org',
  'eip155:8453': 'https://mainnet.base.org',
  'base-sepolia': 'https://sepolia.base.org',
  base: 'https://mainnet.base.org',
}

const log = (...a) => process.stderr.write('[' + NAAM + '] ' + a.join(' ') + '\n')

const GEREEDSCHAP = [
  {
    name: 'check_x402_endpoint',
    description:
      'Check a paid x402 endpoint BEFORE paying it. Sends exactly one request, never pays, and reports which levels of ' +
      'the published conformance ladder it reaches: does it ask for payment the way x402 says, does it declare the ' +
      'offer-receipt extension, and does the signature on its offer actually verify. Levels that need a real settlement ' +
      'are reported as not measured, never as failed.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The paid endpoint to check, for example https://api.example.com/paid/thing' },
        method: { type: 'string', description: 'HTTP method the endpoint expects. Defaults to POST. Use GET for a GET-only route.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'link_receipt_to_settlement',
    description:
      'Check AFTER paying that a version 2 offer-receipt belongs to exactly one real on-chain settlement. Takes the ' +
      'signed receipt payload plus the authorization salt the seller returned outside it, and resolves the salted ' +
      'commitment against live chain state. Answers linked, not linked, or could-not-check, and never guesses between them.',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'object', description: 'The signed receipt payload, the object with version, network, payer and authorizationCommitment' },
        salt: { type: 'string', description: 'The authorizationSalt from extensions["offer-receipt"].info, which is deliberately not inside the signed payload' },
        asset: { type: 'string', description: 'The token contract from the accepts entry that was paid, for example the USDC address' },
        rpcUrl: { type: 'string', description: 'Optional. An RPC endpoint to use instead of the public default for that network.' },
      },
      required: ['payload', 'salt', 'asset'],
    },
  },
]

function tekst(s, fout = false) {
  return { content: [{ type: 'text', text: s }], ...(fout ? { isError: true } : {}) }
}

async function doeCheckEndpoint(args) {
  const url = typeof args?.url === 'string' ? args.url.trim() : ''
  if (!/^https?:\/\//.test(url)) return tekst('url must be an absolute http or https address', true)
  const methode = typeof args?.method === 'string' && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(args.method)
    ? args.method.toUpperCase()
    : 'POST'

  const m = await meetEindpunt(url, { methode })
  const hoogste = hoogsteTrede(m)
  const regels = [
    (hoogste >= 0 ? 'Reaches level ' + hoogste : 'Reaches no level') + ' of the conformance ladder.',
    'Checked with a single ' + methode + ' request. Nothing was paid.',
    '',
  ]
  for (const t of TREDEN) {
    const staat = m.treden[t.sleutel]
    if (!staat) continue
    const merk = staat === 'HAALT' ? 'reached    ' : staat === 'HAALT_NIET' ? 'NOT reached' : 'not measured'
    regels.push('L' + t.nummer + '  ' + merk + '  ' + t.naam)
    if (m.bewijs[t.sleutel]) regels.push('      ' + m.bewijs[t.sleutel])
  }
  if (m.bewijs.t2afwijking) regels.push('', 'note on the key: ' + m.bewijs.t2afwijking)
  regels.push(
    '',
    'Levels 3 to 5 cannot be observed without paying, so they are reported as not measured rather than absent.',
    'The ladder and what it deliberately does not measure: https://github.com/holistis/agent-receipt-verify/blob/main/CONFORMANCE.md',
    'This judges the form of an endpoint, not the honesty of the party behind it.',
  )
  return tekst(regels.join('\n'))
}

async function doeLinkReceipt(args) {
  const payload = args?.payload
  const salt = typeof args?.salt === 'string' ? args.salt.trim() : ''
  const asset = typeof args?.asset === 'string' ? args.asset.trim() : ''
  if (!payload || typeof payload !== 'object') return tekst('payload must be the signed receipt object', true)
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) return tekst('salt must be a 32 byte hex string starting with 0x', true)
  if (!/^0x[0-9a-fA-F]{40}$/.test(asset)) return tekst('asset must be a 20 byte hex address starting with 0x', true)

  const netwerk = String(payload.network ?? '')
  const rpcUrl = typeof args?.rpcUrl === 'string' && args.rpcUrl ? args.rpcUrl : RPC_PER_NETWERK[netwerk]
  if (!rpcUrl) {
    return tekst(
      'could not check: no public RPC is configured for network "' + netwerk + '".\n' +
      'Pass rpcUrl explicitly. This is reported as could-not-check, not as not-linked, because those are different answers.',
      true,
    )
  }

  try {
    const uit = await linkBonnetje(maakRpc(rpcUrl), { payload, salt, asset })
    const regels = []
    if (uit.linked) {
      regels.push('LINKED. This receipt opens to exactly one on-chain authorization.')
      regels.push('nonce       ' + uit.identifier)
      if (uit.afrekening?.tx) regels.push('transaction ' + uit.afrekening.tx)
      if (uit.afrekening?.blok) regels.push('block       ' + uit.afrekening.blok)
    } else {
      // Niet-gelinkt heeft bij deze controle altijd een REDEN mee, en die reden IS
      // het antwoord. Nul kandidaten en twee kandidaten zijn allebei niet-gelinkt en
      // bewust niet waarschijnlijk-gelinkt: fail-closed, zie 5.6.4 stap 3.
      regels.push('NOT LINKED. ' + (uit.reden ?? 'the commitment did not open to exactly one authorization'))
      regels.push('Two candidates opening the same commitment reads as not linked on purpose, not as probably linked.')
      regels.push('A receipt signed before its settlement was mined can also read this way; retry later or widen the window.')
    }
    if (uit.venster) {
      regels.push(
        '',
        'searched blocks ' + uit.venster.vanBlok + ' to ' + uit.venster.totBlok +
          ' (' + uit.venster.kandidaten + ' candidate authorizations, ' + uit.venster.aanroepen + ' rpc calls)',
      )
    }
    regels.push('checked against ' + rpcUrl + ' for network ' + netwerk + '.')
    return tekst(regels.join('\n'))
  } catch (e) {
    return tekst('could not check: ' + String(e.message).slice(0, 180) + '\nThis is a failure of the check, not a verdict on the receipt.', true)
  }
}

async function behandel(bericht) {
  const { id, method, params } = bericht

  if (method === 'initialize') {
    const gevraagd = params?.protocolVersion
    return {
      protocolVersion: ONDERSTEUND.includes(gevraagd) ? gevraagd : PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: NAAM, version: VERSIE },
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: GEREEDSCHAP }
  if (method === 'tools/call') {
    const naam = params?.name
    const args = params?.arguments ?? {}
    if (naam === 'check_x402_endpoint') return await doeCheckEndpoint(args)
    if (naam === 'link_receipt_to_settlement') return await doeLinkReceipt(args)
    // Een onbekend gereedschap is een fout van de aanroeper en hoort als JSON-RPC-fout
    // terug, niet als een tekst die op een uitslag lijkt.
    const fout = new Error('unknown tool: ' + String(naam))
    fout.code = -32602
    throw fout
  }
  const fout = new Error('method not found: ' + String(method))
  fout.code = -32601
  throw fout
}

function stuur(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

export function maakVerwerker() {
  let buffer = ''
  return async function verwerk(brok) {
    buffer += brok
    let grens
    while ((grens = buffer.indexOf('\n')) >= 0) {
      const regel = buffer.slice(0, grens).trim()
      buffer = buffer.slice(grens + 1)
      if (!regel) continue
      let bericht
      try {
        bericht = JSON.parse(regel)
      } catch {
        stuur({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
        continue
      }
      // Een notificatie heeft geen id en krijgt per specificatie GEEN antwoord. Wie
      // daar toch op antwoordt, laat sommige clients vastlopen.
      if (bericht.id === undefined || bericht.id === null) {
        if (bericht.method === 'notifications/initialized') log('client is ready')
        continue
      }
      try {
        stuur({ jsonrpc: '2.0', id: bericht.id, result: await behandel(bericht) })
      } catch (e) {
        stuur({ jsonrpc: '2.0', id: bericht.id, error: { code: e.code ?? -32603, message: String(e.message).slice(0, 200) } })
      }
    }
  }
}

if (process.argv[1]?.endsWith('mcp-server.mjs')) {
  log('listening on stdio, protocol ' + PROTOCOL + ', ' + GEREEDSCHAP.length + ' tools')
  const verwerk = maakVerwerker()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (b) => {
    verwerk(b).catch((e) => log('handler error: ' + e.message))
  })
  process.stdin.on('end', () => process.exit(0))
}
