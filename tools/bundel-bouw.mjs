// Stageert de MCPB-bundel en BEWIJST dat hij werkt, voor er iets gepubliceerd wordt.
//
// WAAROM DIT EEN SCRIPT IS EN GEEN STUK YAML. Een controle die alleen in een
// workflow staat, is alleen op een server te draaien en dus niet na te kijken door
// wie hem moet vertrouwen. Dit bestand draait ook lokaal:
//
//   node tools/bundel-bouw.mjs <doelmap>
//
// WAT HET BEWIJST, en dit is het hele punt. Een bundel is een losse kopie van de
// server. Wie hem samenstelt uit een lijst mappen, kan een bestand vergeten dat de
// repo wel heeft: dan werkt alles bij ons en gaat het pas stuk bij een vreemde die
// de bundel installeert. Daarom start dit script de server UIT de gestageerde map en
// voert een echte initialize plus tools/list uit over stdio. Faalt dat, dan is er
// niets om te publiceren.
//
// ethers zit er BEWUST niet in. Het is een optionele afhankelijkheid voor één
// controle binnen trede 2, en zonder dat pakket meldt die controle ONGEMETEN in
// plaats van te slagen. Een bundel van 184 kB die eerlijk zegt wat hij niet kon
// meten, is beter dan een bundel met een hele node_modules erin.

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const wortel = fileURLToPath(new URL('..', import.meta.url))

// Alleen wat de server bij het draaien ECHT nodig heeft, plus de stukken die een
// mens moet kunnen lezen als hij de bundel binnenhaalt. vectors/ en test/ horen hier
// niet: die zijn er voor onze eigen bewijslast, niet voor het draaien.
export const INHOUD = {
  bestanden: ['manifest.json', 'LICENSE', 'NOTICE', 'README.md', 'CONFORMANCE.md'],
  mappen: ['src', 'profiles'],
}

function kopieerMap(van, naar) {
  fs.mkdirSync(naar, { recursive: true })
  for (const item of fs.readdirSync(van, { withFileTypes: true })) {
    const a = path.join(van, item.name), b = path.join(naar, item.name)
    if (item.isDirectory()) kopieerMap(a, b)
    else fs.copyFileSync(a, b)
  }
}

export function stageer(doel) {
  fs.rmSync(doel, { recursive: true, force: true })
  fs.mkdirSync(doel, { recursive: true })
  for (const f of INHOUD.bestanden) {
    const bron = path.join(wortel, f)
    if (!fs.existsSync(bron)) throw new Error(`bundel mist een bestand dat de repo hoort te hebben: ${f}`)
    fs.copyFileSync(bron, path.join(doel, f))
  }
  for (const m of INHOUD.mappen) {
    const bron = path.join(wortel, m)
    if (!fs.existsSync(bron)) throw new Error(`bundel mist een map die de repo hoort te hebben: ${m}`)
    kopieerMap(bron, path.join(doel, m))
  }
  return doel
}

/** De drie versienummers moeten gelijk zijn, anders publiceren wij een versie die niet bestaat. */
export function versiesKloppen(leesJson) {
  // De lezer is een parameter zodat een test de rode kant kan aantonen zonder
  // bestanden in de repo te verminken. Een controle die alleen groen kan worden,
  // bewijst niets.
  const lees = leesJson || ((f) => JSON.parse(fs.readFileSync(path.join(wortel, f), 'utf8')))
  const pkg = lees('package.json').version
  const man = lees('manifest.json').version
  const srv = lees('server.json').version
  const klachten = []
  if (man !== pkg) klachten.push(`manifest.json zegt ${man}, package.json zegt ${pkg}`)
  if (srv !== pkg) klachten.push(`server.json zegt ${srv}, package.json zegt ${pkg}`)
  return { versie: pkg, klachten }
}

/** Start de server uit de bundel en eis een echte handdruk plus een echte toollijst. */
export async function bewijsDatDeBundelWerkt(doel, { wachtMs = 2500 } = {}) {
  const entry = path.join(doel, JSON.parse(fs.readFileSync(path.join(doel, 'manifest.json'), 'utf8')).server.entry_point)
  if (!fs.existsSync(entry)) throw new Error(`het manifest wijst naar een entry_point die niet in de bundel zit: ${entry}`)

  const kind = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] })
  let uit = '', err = ''
  kind.stdout.on('data', (d) => { uit += d })
  kind.stderr.on('data', (d) => { err += d })
  const stuur = (o) => kind.stdin.write(JSON.stringify(o) + '\n')

  stuur({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bundel-bouw', version: '1' } } })
  await new Promise((r) => setTimeout(r, 700))
  stuur({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  await new Promise((r) => setTimeout(r, wachtMs))
  kind.kill()

  const frames = uit.trim().split('\n').filter(Boolean).map((r) => { try { return JSON.parse(r) } catch { return null } }).filter(Boolean)
  const init = frames.find((f) => f.id === 1)
  const lijst = frames.find((f) => f.id === 2)
  if (!init?.result?.serverInfo?.name) throw new Error('de bundel gaf geen bruikbaar initialize-antwoord. stderr: ' + err.slice(0, 400))
  if (!Array.isArray(lijst?.result?.tools) || lijst.result.tools.length === 0) throw new Error('de bundel gaf geen tools terug')
  // Alles wat geen protocolframe is hoort naar stderr. Een regel op stdout die geen
  // JSON-RPC is, breekt elke client, en dat moet hier opvallen en niet bij een vreemde.
  const nietFrames = uit.trim().split('\n').filter((r) => r.trim()).filter((r) => { try { JSON.parse(r); return false } catch { return true } })
  if (nietFrames.length) throw new Error('er staat iets op stdout dat geen frame is: ' + nietFrames[0].slice(0, 120))

  return { naam: init.result.serverInfo.name, versie: init.result.serverInfo.version, protocol: init.result.protocolVersion, tools: lijst.result.tools.map((t) => t.name) }
}

if (process.argv[1]?.endsWith('bundel-bouw.mjs')) {
  const doel = process.argv[2]
  if (!doel) {
    console.log('gebruik: node tools/bundel-bouw.mjs <doelmap>')
    process.exitCode = 2
  } else {
    const v = versiesKloppen()
    if (v.klachten.length) {
      console.log('versies lopen uiteen, dit stopt hier:')
      for (const k of v.klachten) console.log('  ' + k)
      process.exitCode = 1
    } else {
      stageer(doel)
      const n = fs.readdirSync(doel, { recursive: true }).length
      const uitslag = await bewijsDatDeBundelWerkt(doel)
      console.log(`versie ${v.versie}, ${n} items gestageerd in ${doel}`)
      console.log(`de bundel spreekt MCP: ${uitslag.naam} v${uitslag.versie}, protocol ${uitslag.protocol}`)
      console.log(`tools: ${uitslag.tools.join(', ')}`)
    }
  }
}
