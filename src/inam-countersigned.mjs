// Onafhankelijke verificatie van INAM-tegengetekende bonnetjes.
//
// Geschreven tegen hun SPEC.md (§4.2 content-addressing, §4.3 lifecycle, §15 over
// HTTP) en hun README, NIET tegen hun verify.mjs. Dat is het hele punt: als twee
// implementaties die elkaars code niet hebben gezien dezelfde uitspraak doen over
// dezelfde vectoren, is dat interop-bewijs. Eén implementatie die zichzelf
// bevestigt, bewijst niets.
//
// Read-only, geen netwerk, geen sleutels van onszelf.

import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'

const VECTOREN = process.argv[2]
if (!VECTOREN) { console.error('gebruik: node verify-inam-onafhankelijk.mjs <vectors.json>'); process.exit(2) }

// ── bouwstenen ───────────────────────────────────────────────────────────────

// §4.2: "recursive key-sorted, whitespace-free JSON serializer"
function canoniek(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(canoniek).join(',') + ']'
  return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canoniek(x[k])).join(',') + '}'
}

const sha256hex = s => createHash('sha256').update(s, 'utf8').digest('hex')

// base58btc, zelf geschreven zodat we geen code van hen of van een pakket delen
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58decode(s) {
  let getal = 0n
  for (const teken of s) {
    const i = B58.indexOf(teken)
    if (i < 0) throw new Error('geen base58: ' + teken)
    getal = getal * 58n + BigInt(i)
  }
  const bytes = []
  while (getal > 0n) { bytes.unshift(Number(getal & 255n)); getal >>= 8n }
  for (const teken of s) { if (teken === '1') bytes.unshift(0); else break }
  return Buffer.from(bytes)
}

// did:key met multicodec 0xed01 = Ed25519 publieke sleutel
function didNaarSleutel(did) {
  const deel = did.replace(/^did:key:/, '').split('#')[0]
  if (!deel.startsWith('z')) throw new Error('verwacht base58btc (z...)')
  const ruw = base58decode(deel.slice(1))
  if (ruw[0] !== 0xed || ruw[1] !== 0x01) throw new Error('geen ed25519-multicodec')
  const sleutel = ruw.subarray(2)
  if (sleutel.length !== 32) throw new Error('verkeerde sleutellengte ' + sleutel.length)
  // minimale SPKI-DER-omhulling rond een rauwe ed25519-sleutel
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), sleutel])
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

function ed25519Klopt(did, inhoud, handtekeningB64) {
  try {
    const sig = Buffer.from(handtekeningB64, handtekeningB64.includes('-') || handtekeningB64.includes('_') ? 'base64url' : 'base64')
    return edVerify(null, Buffer.from(inhoud, 'utf8'), didNaarSleutel(did), sig)
  } catch { return false }
}

let keccak256
try {
  const ethers = await import('file:///C:/Code/tokenizen/node_modules/ethers/lib.esm/index.js')
  keccak256 = b => ethers.keccak256(b)
} catch {
  keccak256 = null
}

// ── de acht controles, zoals hun README ze beschrijft ────────────────────────

function toetsGeval(geval, vectoren) {
  const mislukt = []
  const bestand = geval.feedbackFile
  const f = JSON.parse(bestand)
  const r = f?.inam?.receipt ?? {}
  const ev = geval.onchainEvent ?? {}
  const obs = vectoren.observed ?? {}

  // 1. keccak256 van de bestandsbytes is de feedbackHash uit het event
  if (keccak256) {
    const berekend = keccak256(Buffer.from(bestand, 'utf8'))
    if (String(berekend).toLowerCase() !== String(ev.feedbackHash).toLowerCase()) mislukt.push('feedbackHashMatchesFile')
  }

  // 2. §4.2: receiptId = sha256 over canoniek van zeven velden
  const zeven = {}
  for (const k of ['jobId', 'agentA', 'agentB', 'task', 'result', 'settlement', 'verification']) {
    if (r[k] !== undefined) zeven[k] = r[k]
  }
  if ('sha256:' + sha256hex(canoniek(zeven)) !== r.receiptId) mislukt.push('receiptIdRecomputes')

  // 3+4. §4.3: beide partijen tekenen DEZELFDE canonieke inhoud, alles behalve
  // signatures, status en dispute
  const teTekenen = { ...r }
  delete teTekenen.signatures; delete teTekenen.status; delete teTekenen.dispute
  const inhoud = canoniek(teTekenen)
  const sigs = r.signatures ?? {}
  const didB = r.agentB?.did ?? r.agentB?.id ?? vectoren.parties?.provider?.did
  const didA = r.agentA?.did ?? r.agentA?.id ?? vectoren.parties?.requester?.did
  const sigB = sigs.agentB?.signature ?? sigs.agentB ?? sigs.worker
  const sigA = sigs.agentA?.signature ?? sigs.agentA ?? sigs.requester
  if (!sigB || !ed25519Klopt(didB, inhoud, sigB)) mislukt.push('workerSignature')
  if (!sigA || !ed25519Klopt(didA, inhoud, sigA)) mislukt.push('requesterSignature')

  // 5. waarde hoort bij de uitkomst: 100 / 50 / 0
  const uitkomst = r.result?.outcome ?? r.result?.status
  const hoort = { success: 100, partial: 50, failed: 0 }[uitkomst]
  const waarde = ev.value ?? f.value
  if (hoort !== undefined && Number(waarde) !== hoort) mislukt.push('valueMatchesOutcome')

  // 6. het bestand noemt het adres dat het event verstuurde
  const inBestand = String(f.clientAddress ?? '').split(':').pop().toLowerCase()
  if (inBestand !== String(ev.clientAddress ?? '').toLowerCase()) mislukt.push('fileClientAddressMatchesSender')

  // 7. dat adres is de wallet waarvan de requester controle bewees
  const bewezen = String(vectoren.parties?.requester?.erc8004Address ?? '').toLowerCase()
  if (String(ev.clientAddress ?? '').toLowerCase() !== bewezen) mislukt.push('senderIsRequesterWallet')

  // 8+9. §15: hashes over de bytes die daadwerkelijk over de lijn gingen
  const u = new URL(obs.request?.url ?? 'https://x/')
  const verzoekBytes = `${obs.request?.method} ${u.pathname}${u.search}\n${obs.request?.body ?? ''}`
  if ('sha256:' + sha256hex(verzoekBytes) !== r.task?.specHash) mislukt.push('specHashMatchesObservedBytes')
  if ('sha256:' + sha256hex(obs.response?.body ?? '') !== r.result?.outputHash) mislukt.push('outputHashMatchesObservedBytes')

  return { accepted: mislukt.length === 0, failedChecks: mislukt }
}

// ── draaien en vergelijken met wat de vectoren zelf verwachten ───────────────

const v = JSON.parse(readFileSync(VECTOREN, 'utf8'))
console.log(`suite: ${v.suite}`)
console.log(`keccak256 beschikbaar: ${keccak256 ? 'ja' : 'NEE (controle 1 overgeslagen)'}\n`)

let gelijk = 0, afwijkend = 0
for (const geval of v.cases) {
  const onze = toetsGeval(geval, v)
  const hunne = geval.expected
  const zelfdeOordeel = onze.accepted === hunne.accepted
  const onzeSet = [...onze.failedChecks].sort().join(',')
  const hunSet = [...(hunne.failedChecks ?? [])].sort().join(',')
  const zelfdeChecks = onzeSet === hunSet
  const merk = zelfdeOordeel && zelfdeChecks ? 'GELIJK  ' : (zelfdeOordeel ? 'deels   ' : 'AFWIJKEND')
  if (zelfdeOordeel && zelfdeChecks) gelijk++; else afwijkend++
  console.log(`${merk} ${geval.id}`)
  console.log(`   zij : accepted=${hunne.accepted} [${hunSet || '-'}]`)
  console.log(`   wij : accepted=${onze.accepted} [${onzeSet || '-'}]`)
}
console.log(`\n${gelijk} van ${v.cases.length} volledig gelijk, ${afwijkend} afwijkend`)
process.exit(afwijkend === 0 ? 0 : 1)
