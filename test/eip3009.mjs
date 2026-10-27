// Onze onafhankelijke verifieerder tegen de gepubliceerde vectoren van iamonuwa/kanon,
// plus eigen mutaties als tegencontrole.
//
// WAAROM DE MUTATIES ER OOK ZIJN. Instemmen met tien vectoren bewijst dat wij hetzelfde
// zeggen als hij, niet dat onze meter uberhaupt kan afkeuren. Een verifieerder die
// altijd VALID antwoordt is het met zijn baseline ook eens. Daarom wordt dezelfde
// baseline hier twaalf keer bewust stukgemaakt, en elke mutatie moet de redencode
// opleveren die bij dat gebrek hoort. Dat is dezelfde discipline als de
// twaalf-mutatie-benchmark die wij eerder op de INAM-bonnetjes gebruikten.
//
// WAAROM DE VOLGORDE VAN DE CONTROLES EEN VOORSPELLING WAS. De volgorde is vooraf
// afgeleid uit zijn eigen beschrijvingen bij de vectoren ("the plaintext mismatch is
// caught", "caught only after the signature verifies") en pas daarna gedraaid. Dat is
// het verschil tussen een voorspelling en een uitkomst die is bijgeschaafd tot hij
// groen werd, en dat verschil is het halve bewijs.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beoordeelVector, beoordeelAutorisatie, isKneedbaar, chainIdUitNetwerk, domeinUit, REDENEN } from '../src/eip3009-autorisatie.mjs'

const wortel = fileURLToPath(new URL('..', import.meta.url))
const VECTORMAP = path.join(wortel, 'vectors', 'kanon')

let groen = 0, rood = 0
const t = (naam, v) => { if (v) { groen++; console.log('  pass  ' + naam) } else { rood++; console.log('  FAIL  ' + naam) } }

const lees = (naam) => JSON.parse(fs.readFileSync(path.join(VECTORMAP, naam), 'utf8'))

console.log('EIP-3009 autorisaties, hun vectoren')
{
  const bestanden = fs.readdirSync(VECTORMAP).filter((f) => f.endsWith('.json')).sort()
  t('alle tien vectoren staan in de repo', bestanden.length === 10)

  let eens = 0, oneens = [], ongemeten = 0
  for (const f of bestanden) {
    const v = lees(f)
    const u = await beoordeelVector(v)
    if (u.ongemeten) { ongemeten++; continue }
    if (u.valid === v.expected.valid && u.reason_code === v.expected.reason_code) eens++
    else oneens.push(v.id + ' wij ' + u.reason_code + ' zij ' + v.expected.reason_code)
  }
  if (ongemeten) {
    // Zonder ethers kan de ondertekenaar niet hersteld worden. Dat is een gat in onze
    // meter en wordt als zodanig gemeld; het mag deze test niet stil laten slagen.
    t('ethers ontbreekt, dus de kruiscontrole is ONGEMETEN en niet geslaagd', ongemeten === 10)
    console.log('  (installeer ethers om de kruiscontrole echt te draaien)')
  } else {
    t('eens met alle tien, inclusief de redencode' + (oneens.length ? ': ' + oneens.join('; ') : ''), eens === 10)
  }
}

console.log('\nde tegencontrole: dezelfde baseline twaalf keer stukgemaakt')
{
  const basis = lees('valid-baseline-001.json')
  const ethersAanwezig = !(await beoordeelVector(basis)).ongemeten

  const kopie = () => JSON.parse(JSON.stringify(basis))
  const draai = async (muteer) => {
    const v = kopie()
    muteer(v)
    return beoordeelVector(v)
  }

  t('de ongewijzigde baseline is geldig', (await beoordeelVector(basis)).reason_code === (ethersAanwezig ? 'VALID' : null))

  const geval = async (naam, muteer, verwacht) => {
    const u = await draai(muteer)
    if (!ethersAanwezig && u.ongemeten) { console.log('  (overgeslagen, geen ethers) ' + naam); return }
    t(naam + ' geeft ' + verwacht, u.reason_code === verwacht && u.valid === false)
  }

  await geval('een ander doelnetwerk', (v) => { v.network = 'eip155:1' }, 'NETWORK_MISMATCH')
  // LET OP, deze mutatie moest worden gecorrigeerd en de reden is zelf leerzaam. Eerst
  // verlaagde ik het ONDERTEKENDE bedrag, en dat gaf SIGNER_MISMATCH in plaats van
  // AMOUNT_INSUFFICIENT: value zit onder de handtekening, dus dat verlagen maakt een
  // vervalsing en geen onderbetaling. Zijn eigen vector heeft een authentiek
  // ondertekend lager bedrag. De juiste mutatie is dus de GEVRAAGDE prijs verhogen,
  // want die staat buiten de handtekening. De tegencontrole vond deze fout in mijn
  // test, niet in de code.
  await geval('een gevraagde prijs boven het ondertekende bedrag', (v) => { v.input.accepted.amount = '20000' }, 'AMOUNT_INSUFFICIENT')
  await geval('een venster dat nog niet open is', (v) => { v.context.verification_time = 1 }, 'NOT_YET_VALID')
  await geval('een venster dat al dicht is', (v) => { v.context.verification_time = 9999999999 }, 'EXPIRED')
  await geval('een nonce die al verbruikt is', (v) => { v.context.seen_nonces = [v.input.payload.authorization.nonce] }, 'NONCE_REPLAY')
  await geval('een andere betaler in de autorisatie', (v) => { v.input.payload.authorization.from = '0x0000000000000000000000000000000000000001' }, 'SIGNER_MISMATCH')
  await geval('een andere ontvanger', (v) => { v.input.payload.authorization.to = '0x0000000000000000000000000000000000000002' }, 'SIGNER_MISMATCH')
  await geval('een ander token als verifyingContract', (v) => { v.input.accepted.asset = '0x0000000000000000000000000000000000000003' }, 'SIGNER_MISMATCH')
  await geval('een andere domeinnaam', (v) => { v.input.accepted.extra.name = 'NietUSDC' }, 'SIGNER_MISMATCH')
  await geval('een andere domeinversie', (v) => { v.input.accepted.extra.version = '9' }, 'SIGNER_MISMATCH')
  await geval('een omgezet laatste byte van de handtekening', (v) => {
    const s = v.input.payload.signature
    v.input.payload.signature = s.slice(0, -2) + (s.slice(-2) === '1c' ? '1b' : '1c')
  }, 'SIGNER_MISMATCH')
  await geval('een nonce die niet bij de handtekening hoort', (v) => {
    v.input.payload.authorization.nonce = '0x' + '11'.repeat(32)
  }, 'SIGNER_MISMATCH')

  // DEZE CONTROLE IS MEEVERANDERD MET DE CODE, en dat hoort zo. Eerst stond hier dat
  // een bedrag BOVEN het gevraagde geldig blijft. Sinds twee referentie-implementaties
  // bleken gelijkheid te eisen (go eip3009.go:65, python facilitator.py:235) is exact
  // het standaardbeleid, en moet juist AFKEUREN de verwachting zijn. De oorspronkelijke
  // bedoeling, een omgekeerde vergelijking vangen, staat nu onder het at-least-beleid.
  if (ethersAanwezig) {
    const u = await draai((v) => { v.input.accepted.amount = '1' })
    t('een bedrag boven het gevraagde wordt standaard afgekeurd, zoals go en python doen',
      u.valid === false && u.reason_code === 'AMOUNT_INSUFFICIENT')
  }
}

console.log('')
console.log('de twee keuzes die geen enkele vector dekt')
{
  const basis = lees('valid-baseline-001.json')
  const erIsEthers = !(await beoordeelVector(basis)).ongemeten
  const kopie = () => JSON.parse(JSON.stringify(basis))
  const run = async (muteer, ctx = {}) => {
    const v = kopie(); muteer(v)
    return beoordeelAutorisatie(v.input, { ...(v.context ?? {}), doelNetwerk: v.network, ...ctx })
  }
  if (!erIsEthers) {
    console.log('  (overgeslagen, geen ethers)')
  } else {
    const teVeel = await run((v) => { v.input.accepted.amount = '9999' })
    t('standaard wijst TE VEEL betalen af, zoals go en python doen',
      teVeel.valid === false && teVeel.reason_code === 'AMOUNT_INSUFFICIENT')
    t('en de uitslag noemt het gebruikte beleid, want dit is een keuze en geen natuurwet',
      teVeel.amountPolicy === 'exact')
    const soepel = await run((v) => { v.input.accepted.amount = '9999' }, { amountPolicy: 'at-least' })
    t('met at-least is te veel betalen juist geldig', soepel.valid === true && soepel.amountPolicy === 'at-least')
    const teWeinig = await run((v) => { v.input.accepted.amount = '20000' }, { amountPolicy: 'at-least' })
    t('maar te WEINIG blijft ook met at-least afgewezen', teWeinig.reason_code === 'AMOUNT_INSUFFICIENT')
    t('een bedrag dat precies klopt is onder beide beleiden geldig', (await run(() => {})).valid === true)
    const nonce = basis.input.payload.authorization.nonce
    const ander = '0x000000000000000000000000000000000000dEaD'
    t('dezelfde nonce verbruikt door een ANDER adres blokkeert ons niet, net als op de keten',
      (await run(() => {}, { seen_nonces: { [ander]: [nonce] } })).valid === true)
    t('dezelfde nonce verbruikt door DEZE betaler blokkeert wel',
      (await run(() => {}, { seen_nonces: { [basis.input.payload.authorization.from]: [nonce] } })).reason_code === 'NONCE_REPLAY')
    t('een platte lijst telt als de nonces van deze betaler, zoals hun eigen vector hem gebruikt',
      (await run(() => {}, { seen_nonces: [nonce] })).reason_code === 'NONCE_REPLAY')
    t('adressen worden niet op hoofdletters vergeleken',
      (await run(() => {}, { seen_nonces: { [ander.toUpperCase()]: [nonce] } })).valid === true)
    t('een lege boekhouding blokkeert niets', (await run(() => {}, { seen_nonces: {} })).valid === true)
  }
}

console.log('\nde losse stukken')
{
  t('eip155:84532 wordt 84532', chainIdUitNetwerk('eip155:84532') === 84532)
  t('een onbekende netwerkvorm geeft null in plaats van een gok', chainIdUitNetwerk('solana:mainnet') === null)
  t('een lege waarde geeft null', chainIdUitNetwerk(undefined) === null)

  // De grens van de kneedbaarheid, op de halve groepsorde zelf en een stap erboven.
  const halve = '7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0'
  const eenHoger = '7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a1'
  const r = '11'.repeat(32)
  t('precies de halve orde is nog NIET kneedbaar', isKneedbaar('0x' + r + halve + '1b') === false)
  t('een stap erboven is kneedbaar', isKneedbaar('0x' + r + eenHoger + '1b') === true)
  t('een te korte handtekening valt niet om', isKneedbaar('0x1234') === false)

  const d = domeinUit({ extra: { name: 'USDC', version: '2' }, network: 'eip155:84532', asset: '0xabc' })
  t('het domein komt uit accepted, niet uit de autorisatie',
    d.name === 'USDC' && d.version === '2' && d.chainId === 84532 && d.verifyingContract === '0xabc')

  t('de acht redencodes staan vast en in de vorm die zijn schema gebruikt',
    REDENEN.length === 8 && REDENEN[0] === 'VALID' && REDENEN.includes('SIG_MALLEABLE'))

  const leeg = await beoordeelAutorisatie({ accepted: { network: 'eip155:1' }, payload: {} }, { doelNetwerk: 'eip155:2' })
  t('een lege betaling valt niet om maar geeft een redencode', leeg.reason_code === 'NETWORK_MISMATCH')
}

// WIE HEEFT CODE. Aangewezen door robertolocatelli81-dev op x402#3925 en juist: USDC kiest de controle naar de code
// van de betaler. Zonder code ecrecover (en dan weigert het een hoge s), met code ERC-1271. Een slimme portemonnee
// of een gewoon adres met een EIP-7702-delegatie hoort dus niet afgekeurd te worden om de vorm van zijn handtekening,
// en kan zonder ketenaanroep ook niet VALID worden: dan is de uitslag ONGEMETEN.
console.log('\nde scope van de betaler: wie heeft code')
{
  const basis = lees('valid-baseline-001.json')
  const hoog = lees('sig-malleable-high-s-001.json')
  const draai = (v, extra) => beoordeelAutorisatie(v.input, { ...(v.context ?? {}), doelNetwerk: v.network, ...extra })
  const kopie = (v) => JSON.parse(JSON.stringify(v))
  const ethersAanwezig = !(await beoordeelVector(basis)).ongemeten

  const onbekend = await draai(hoog, {})
  t('zonder opgave gedraagt hij zich als voorheen en zegt dat de scope onbekend is', onbekend.reason_code === 'SIG_MALLEABLE' && onbekend.payerScope === 'unknown')

  const zonderCode = await draai(hoog, { payerHasCode: false })
  t('een betaler zonder code met een hoge s wordt afgekeurd', zonderCode.reason_code === 'SIG_MALLEABLE' && zonderCode.payerScope === 'no-code')

  const metCode = await draai(hoog, { payerHasCode: true })
  t('een betaler met code wordt niet afgekeurd om de vorm van de handtekening', metCode.reason_code !== 'SIG_MALLEABLE')
  t('en komt nooit als geldig terug, want de handtekening is niet gecontroleerd', metCode.valid === false && metCode.ongemeten === true && metCode.payerScope === 'code')

  const schoon = await draai(basis, { payerHasCode: true })
  t('ook een verder volledig geldige betaling van een betaler met code is ONGEMETEN en niet VALID', schoon.valid === false && schoon.ongemeten === true && schoon.reason_code === null)

  const verlopen = kopie(basis)
  verlopen.context = { ...(verlopen.context ?? {}), verification_time: 9999999999 }
  const u1 = await draai(verlopen, { payerHasCode: true })
  t('de andere regels gelden gewoon voor een betaler met code: een verlopen venster', u1.reason_code === 'EXPIRED' && u1.valid === false)

  const duur = kopie(basis)
  duur.input.accepted.amount = '20000'
  const u2 = await draai(duur, { payerHasCode: true })
  t('en een bedrag dat niet klopt', u2.reason_code === 'AMOUNT_INSUFFICIENT' && u2.valid === false)

  const herhaald = kopie(basis)
  herhaald.context = { ...(herhaald.context ?? {}), seen_nonces: [herhaald.input.payload.authorization.nonce] }
  const u3 = await draai(herhaald, { payerHasCode: true })
  t('en een nonce die al is gebruikt', u3.reason_code === 'NONCE_REPLAY' && u3.valid === false)

  if (ethersAanwezig) {
    const gewijzigd = kopie(basis)
    gewijzigd.input.payload.authorization.to = '0x0000000000000000000000000000000000000002'
    const u4 = await draai(gewijzigd, { payerHasCode: true })
    t('een betaler met code wordt niet op herstellen beoordeeld, dus een andere ontvanger geeft hier geen SIGNER_MISMATCH', u4.reason_code !== 'SIGNER_MISMATCH')
    const u5 = await draai(gewijzigd, { payerHasCode: false })
    t('terwijl dezelfde wijziging voor een betaler zonder code wel SIGNER_MISMATCH geeft', u5.reason_code === 'SIGNER_MISMATCH')
  }
}

console.log('\nERC-6492: de omhulling gaat via het deployment-pad of nergens (x402#3925)')
{
  const { leesErc6492, beoordeelAutorisatie } = await import('../src/eip3009-autorisatie.mjs')
  const basis = JSON.parse(fs.readFileSync(new URL('../vectors/kanon/valid-baseline-001.json', import.meta.url), 'utf8'))
  const MAGIC = '6492649264926492649264926492649264926492649264926492649264926492'
  const w = (hex) => hex.replace(/^0x/, '').padStart(64, '0')
  const pad = (h) => h + '0'.repeat((64 - (h.length % 64)) % 64)
  const wikkel = (inner, factory, calldata) => {
    const i = inner.replace(/^0x/, ''), c = calldata.replace(/^0x/, '')
    return '0x' + w(factory) + w('60') + w((0x60 + 32 + pad(c).length / 2).toString(16)) + w((c.length / 2).toString(16)) + pad(c) + w((i.length / 2).toString(16)) + pad(i) + MAGIC
  }
  const FACTORY = '0x0000000000000000000000000000000000001234'
  const inner = basis.input.payload.signature
  const geef = async (sig, extra = {}) => { const input = structuredClone(basis.input); input.payload.signature = sig; return beoordeelAutorisatie(input, { ...basis.context, payerHasCode: false, ...extra }) }
  t('een kale handtekening is geen omhulling', leesErc6492(inner) === null)
  t('nul-factory en lege calldata: geen pad, afgewezen', (await geef(wikkel(inner, '0', ''))).reason_code === 'invalid_exact_evm_payload_undeployed_smart_wallet')
  t('echte factory maar lege calldata: geen pad, afgewezen', (await geef(wikkel(inner, FACTORY, ''))).reason_code === 'invalid_exact_evm_payload_undeployed_smart_wallet')
  t('nul-factory met calldata: geen pad, afgewezen', (await geef(wikkel(inner, '0', '0xdeadbeef'))).reason_code === 'invalid_exact_evm_payload_undeployed_smart_wallet')
  t('volledige omhulling, factory niet op de lijst: afgewezen', (await geef(wikkel(inner, FACTORY, '0xdeadbeef'))).reason_code === 'ERC6492_FACTORY_NOT_ALLOWED')
  const toegestaan = await geef(wikkel(inner, FACTORY, '0xdeadbeef'), { erc6492Factories: [FACTORY.toUpperCase().replace('0X', '0x')] })
  t('volledige omhulling, factory op de lijst: niet te beoordelen zonder simulatie, geen afwijzing', toegestaan.ongemeten === true && toegestaan.valid === false && toegestaan.reason_code === null)
  {
    const wikkelToegestaan = wikkel(inner, FACTORY, '0xdeadbeef')
    const lijst = { erc6492Factories: [FACTORY] }
    const verlopen = await geef(wikkelToegestaan, { ...lijst, verification_time: 9999999999 })
    t('toegestane factory, maar het venster is verlopen: nog steeds EXPIRED, niet "niet te beoordelen"', verlopen.reason_code === 'EXPIRED')
    const input = structuredClone(basis.input); input.payload.signature = wikkelToegestaan; input.payload.authorization.value = '1'
    const bedrag = await beoordeelAutorisatie(input, { ...basis.context, payerHasCode: false, ...lijst })
    t('toegestane factory, maar het bedrag klopt niet: nog steeds AMOUNT_INSUFFICIENT', bedrag.reason_code === 'AMOUNT_INSUFFICIENT')
    t('een lijst die geen lijst is wordt behandeld als een lege lijst', (await geef(wikkelToegestaan, { erc6492Factories: FACTORY })).reason_code === 'ERC6492_FACTORY_NOT_ALLOWED')
  }
  t('een omhulling die niet te lezen is: geen pad, afgewezen met de code uit de tekst (72608ea1)', (await geef('0x' + 'ab'.repeat(40) + MAGIC)).reason_code === 'invalid_exact_evm_payload_malformed_erc6492_wrapper')
  t('een betaler MET code: de omhulling-regel geldt niet, de ERC-1271-weg blijft', (await geef(wikkel(inner, '0', ''), { payerHasCode: true })).reason_code !== 'invalid_exact_evm_payload_undeployed_smart_wallet' && (await geef(wikkel(inner, '0', ''), { payerHasCode: true })).reason_code !== 'ERC6492_WRAPPER_UNREADABLE')
  t('de kale handtekening blijft geldig', (await geef(inner)).valid === true)
  for (const f of fs.readdirSync(new URL('../vectors/kanon-voorstel/', import.meta.url)).filter((x) => x.includes('erc6492'))) {
    const v = JSON.parse(fs.readFileSync(new URL('../vectors/kanon-voorstel/' + f, import.meta.url), 'utf8'))
    const u = await beoordeelAutorisatie(v.input, v.context)
    t('het voorstel-vector ' + f + ' wordt zo beoordeeld als ze zegt', u.valid === v.expected.valid && u.reason_code === v.expected.reason_code)
  }
}

console.log('\neip3009: ' + groen + ' pass, ' + rood + ' fail')
process.exitCode = rood === 0 ? 0 : 1
