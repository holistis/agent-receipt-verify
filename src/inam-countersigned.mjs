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

const DIRECT = process.argv[1]?.endsWith('inam-countersigned.mjs')
const VECTOREN = process.argv[2]
if (DIRECT && !VECTOREN) { console.error('usage: node src/inam-countersigned.mjs <vectors.json>'); process.exit(2) }

// ── bouwstenen ───────────────────────────────────────────────────────────────

// §4.2: "recursive key-sorted, whitespace-free JSON serializer"
export function canoniek(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(canoniek).join(',') + ']'
  return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canoniek(x[k])).join(',') + '}'
}

const sha256hex = s => createHash('sha256').update(s, 'utf8').digest('hex')

// base58btc, zelf geschreven zodat we geen code van hen of van een pakket delen
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58decode(s) {
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
export function didNaarSleutel(did) {
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

export function ed25519Klopt(did, inhoud, handtekeningB64) {
  try {
    const sig = Buffer.from(handtekeningB64, handtekeningB64.includes('-') || handtekeningB64.includes('_') ? 'base64url' : 'base64')
    return edVerify(null, Buffer.from(inhoud, 'utf8'), didNaarSleutel(did), sig)
  } catch { return false }
}

let keccak256
try {
  // Een BARE import, en bewust geen pad op iemands schijf. Dit stond hier als
  // file:///C:/Code/... en dat werkte alleen op de machine van de schrijver: voor
  // iedere vreemde viel controle 1 stil weg en kreeg hij zonder het te weten een
  // zwakkere uitslag dan wij. Dat is het tegenovergestelde van een onafhankelijke
  // verifieerder. ethers staat nu als optionele afhankelijkheid in package.json.
  const ethers = await import('ethers')
  keccak256 = b => ethers.keccak256(b)
} catch {
  keccak256 = null
}

// ── de acht controles, zoals hun README ze beschrijft ────────────────────────

export function toetsGeval(geval, vectoren) {
  const mislukt = []
  // Apart van de mislukte checks: gevallen waar het formaat niets te toetsen GEEFT.
  // Die horen niet als mislukking te tellen (dan keur je een geldige bon af) en ook niet
  // stil te verdwijnen (dan lijkt ongemeten op goedgekeurd). Dit veld raakt `accepted`
  // bewust niet aan, zodat de vergelijking met hun verwachting zuiver blijft.
  const onbegrensd = []
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
  //
  // HET VELD IS `verification.outcome`, EN DAT IS EEN REPARATIE. Deze check las eerder
  // `result.outcome` en `result.status`. Die velden bestaan niet in dit formaat: de bon
  // draagt alleen `result.completedAt` en `result.outputHash`. Gevolg was dat `hoort`
  // altijd undefined bleef en de hele check werd OVERGESLAGEN, waarna wij de
  // INFLATED-VALUE-vector (waarde 999 bij een succesvolle levering) ACCEPTEERDEN terwijl
  // de methode hem afkeurt. Een valse goedkeuring is de duurste richting voor een
  // verifieerder, en de check bestond wel: hij kon alleen niet vuren.
  //
  // De plaats staat in hun eigen methodetekst, interop/countersigned/METHOD.md: "The
  // signed receipt binds the outcome (`verification.outcome`), not an amount. `value` is
  // derived from the outcome (100 / 50 / 0)". Gelezen in de bron in plaats van geraden,
  // want geraden was precies de fout.
  const uitkomst = r.verification?.outcome ?? r.result?.outcome ?? r.result?.status
  const hoort = { success: 100, partial: 50, failed: 0 }[uitkomst]
  const waarde = ev.value ?? f.value
  if (hoort !== undefined && Number(waarde) !== hoort) mislukt.push('valueMatchesOutcome')
  // Een bon ZONDER uitkomst laat de waarde onbegrensd, en dat is geen detail maar precies
  // de beperking die wij zelf in die methodetekst hebben laten opnemen. Dus wordt dat
  // geval apart gemeld in plaats van stil als geldig te passeren.
  else if (hoort === undefined) onbegrensd.push('valueOnbegrensdZonderUitkomst')

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

  return { accepted: mislukt.length === 0, failedChecks: mislukt, onbegrensd }
}

// ── draaien en vergelijken met wat de vectoren zelf verwachten ───────────────
//
// Alleen bij directe aanroep. Importeren levert de functies, niets anders.
if (DIRECT) {

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

}
