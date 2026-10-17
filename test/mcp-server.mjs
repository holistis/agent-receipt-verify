// Test voor de MCP-server, met echte processen en echte JSON-RPC-frames.
//
// Waarom zo en niet met de functies los: de manier waarop een MCP-server stil kapot
// gaat is dat er IETS naar stdout gaat dat geen frame is (een log, een waarschuwing,
// een console.log die iemand vergat). De client verbreekt dan de verbinding en de
// gebruiker ziet alleen "server disconnected". Dat is alleen te vangen door echt naar
// stdout te kijken, dus dat doet deze test: elke regel die eruit komt MOET parsen.
//
// De andere valkuil die hier vast staat: een notificatie (een bericht zonder id)
// krijgt per specificatie GEEN antwoord. Wie daar toch op antwoordt, laat sommige
// clients vastlopen op een frame dat ze niet verwachten.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SERVER = fileURLToPath(new URL('../src/mcp-server.mjs', import.meta.url))

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

/**
 * Stuurt een reeks frames en geeft alle stdout-regels terug.
 *
 * Wacht op een aantal verwachte antwoorden of op de tijdslimiet, zodat een test niet
 * hangt als de server niets stuurt.
 */
function praat(frames, verwachtAantal, tijdMs = 30000) {
  return new Promise((klaar) => {
    const kind = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
    const regels = []
    let stderr = ''
    let buffer = ''
    const stop = setTimeout(() => { try { kind.kill() } catch {} klaar({ regels, stderr }) }, tijdMs)
    kind.stdout.setEncoding('utf8')
    kind.stdout.on('data', (b) => {
      buffer += b
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const r = buffer.slice(0, i)
        buffer = buffer.slice(i + 1)
        if (r.trim()) regels.push(r)
      }
      if (regels.length >= verwachtAantal) {
        clearTimeout(stop)
        try { kind.kill() } catch {}
        klaar({ regels, stderr })
      }
    })
    kind.stderr.on('data', (b) => { stderr += String(b) })
    kind.on('close', () => { clearTimeout(stop); klaar({ regels, stderr }) })
    for (const f of frames) kind.stdin.write(JSON.stringify(f) + '\n')
  })
}

const parse = (regels) => regels.map((r) => { try { return JSON.parse(r) } catch { return { KAPOT: r.slice(0, 60) } } })

// ── de handdruk ──────────────────────────────────────────────────────────────
{
  const { regels, stderr } = await praat([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
  ], 1)
  const a = parse(regels)
  t('elke regel op stdout is geldige json', a.every((x) => !x.KAPOT), JSON.stringify(a.find((x) => x.KAPOT) ?? {}))
  t('de handdruk wordt beantwoord', a[0]?.id === 1 && !!a[0]?.result, JSON.stringify(a[0] ?? {}).slice(0, 90))
  t('een ondersteunde versie wordt teruggekaatst', a[0]?.result?.protocolVersion === '2025-06-18', a[0]?.result?.protocolVersion)
  t('de server noemt zijn naam', a[0]?.result?.serverInfo?.name === 'agent-receipt-verify')
  t('hij meldt dat hij gereedschap heeft', !!a[0]?.result?.capabilities?.tools)
  t('het opstartbericht gaat naar stderr en niet naar stdout', /listening on stdio/.test(stderr))
}
{
  const { regels } = await praat([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'onzin-9999' } },
  ], 1)
  const a = parse(regels)
  t('een onbekende versie geeft onze eigen versie terug', a[0]?.result?.protocolVersion === '2025-11-25', a[0]?.result?.protocolVersion)
}

// ── de gereedschapslijst ─────────────────────────────────────────────────────
{
  const { regels } = await praat([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ], 2)
  const a = parse(regels)
  const lijst = a.find((x) => x.id === 2)?.result?.tools ?? []
  t('er staan twee gereedschappen in', lijst.length === 2, 'kreeg ' + lijst.length)
  t('elk gereedschap heeft een naam en een schema', lijst.every((g) => g.name && g.inputSchema?.type === 'object'))
  t('elk gereedschap legt uit wat het doet', lijst.every((g) => String(g.description).length > 60))
  t('het eerste is de controle voor je betaalt', lijst.some((g) => g.name === 'check_x402_endpoint'))
  t('het tweede is de controle na je betaling', lijst.some((g) => g.name === 'link_receipt_to_settlement'))
  t('de beschrijving belooft niets over eerlijkheid van de partij',
    lijst.some((g) => /never pays|not measured/.test(g.description)))
}

// ── fouten gedragen zich als fouten ──────────────────────────────────────────
{
  const { regels } = await praat([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bestaat-niet', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'doetnietsbestaands' },
  ], 3)
  const a = parse(regels)
  t('een onbekend gereedschap geeft een json-rpc-fout', a.find((x) => x.id === 2)?.error?.code === -32602,
    JSON.stringify(a.find((x) => x.id === 2) ?? {}).slice(0, 90))
  t('een onbekende methode geeft method-not-found', a.find((x) => x.id === 3)?.error?.code === -32601)
}
{
  // Een notificatie heeft geen id en hoort GEEN antwoord te krijgen. We sturen er een
  // en daarna een echte vraag: komt er maar EEN frame terug, dan is dat correct.
  const { regels } = await praat([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 7, method: 'ping' },
  ], 1)
  const a = parse(regels)
  t('een notificatie krijgt geen antwoord', a.length === 1 && a[0].id === 7, 'kreeg ' + a.length + ' frames')
}

// ── invoercontrole, zonder netwerk ───────────────────────────────────────────
{
  const { regels } = await praat([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_x402_endpoint', arguments: { url: 'geen-url' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'link_receipt_to_settlement', arguments: { payload: {}, salt: 'kort', asset: '0x1' } } },
  ], 3)
  const a = parse(regels)
  const r2 = a.find((x) => x.id === 2)?.result
  const r3 = a.find((x) => x.id === 3)?.result
  t('een onbruikbare url wordt geweigerd zonder netwerk', r2?.isError === true && /absolute http/.test(r2.content[0].text))
  t('een te kort zout wordt geweigerd', r3?.isError === true && /32 byte hex/.test(r3.content[0].text))
  t('de uitslag heeft de content-vorm die een client verwacht',
    Array.isArray(r2?.content) && r2.content[0].type === 'text' && typeof r2.content[0].text === 'string')
}
{
  // Een netwerk dat wij niet kennen hoort KON-NIET-CONTROLEREN te geven en nooit
  // NIET-GELINKT, want dat zijn verschillende antwoorden over iemands bonnetje.
  const { regels } = await praat([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: {
        name: 'link_receipt_to_settlement',
        arguments: { payload: { network: 'eip155:999999', payer: '0x' + '11'.repeat(20) }, salt: '0x' + 'ab'.repeat(32), asset: '0x' + 'cd'.repeat(20) },
      },
    },
  ], 2)
  const a = parse(regels)
  const r = a.find((x) => x.id === 2)?.result
  t('een onbekend netwerk geeft kon-niet-controleren', /could not check/.test(r?.content?.[0]?.text ?? ''), (r?.content?.[0]?.text ?? '').slice(0, 70))
  t('en zegt expliciet dat dat iets anders is dan niet-gelinkt', /different answers/.test(r?.content?.[0]?.text ?? ''))
}

console.log('')
console.log('mcp-server: ' + goed + ' pass, ' + fout + ' fail')
if (fout > 0) process.exitCode = 1
