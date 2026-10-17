// De conformance-ladder, en de optionele crypto die een deel ervan nodig heeft.
//
// De treden staan hier als DATA en niet als losse regels code, omdat de ladder de
// eenheid is: wie een ander getal publiceert moet kunnen aanwijzen welke trede hij
// anders heeft gelegd. Verandert de ladder, dan verandert de editie, en dan hoort
// dat met een datum opgeschreven te worden in CONFORMANCE.md.

export const TREDEN = [
  {
    sleutel: 't0',
    nummer: 0,
    naam: 'asks for payment the way x402 says',
    eis: 'HTTP 402 carrying accepts[] with scheme, network, payTo and an amount, in the body or in the Payment-Required header',
    meetbaarZonderTeBetalen: true,
  },
  {
    sleutel: 't1',
    nummer: 1,
    naam: 'declares the offer-receipt extension',
    eis: 'the 402 carries an offer-receipt entry in extensions',
    meetbaarZonderTeBetalen: true,
  },
  {
    sleutel: 't2',
    nummer: 2,
    naam: 'signs its offer, and the signature verifies',
    eis: 'extensions["offer-receipt"].info.offers[0] is an eip712 artifact whose signature recovers to an address',
    meetbaarZonderTeBetalen: true,
  },
  {
    sleutel: 't3',
    nummer: 3,
    naam: 'emits a receipt that verifies',
    eis: 'after payment, the settlement response carries a receipt whose signature recovers to the same signer',
    meetbaarZonderTeBetalen: false,
  },
  {
    sleutel: 't4',
    nummer: 4,
    naam: 'receipt is version 2 and the salt arrives where 5.6.3 says',
    eis: 'payload.version is 2 with both commitment fields, and the salt is at extensions["offer-receipt"].info.authorizationSalt',
    meetbaarZonderTeBetalen: false,
  },
  {
    sleutel: 't5',
    nummer: 5,
    naam: 'the commitment opens against the chain to exactly one settlement',
    eis: 'section 5.6.4 run against live chain state resolves to exactly one AuthorizationUsed nonce',
    meetbaarZonderTeBetalen: false,
  },
]

/**
 * ethers, als het er is.
 *
 * Een BARE import, en bewust niet een pad op iemands schijf. Een vorige versie van
 * dit project importeerde ethers vanaf file:///C:/Code/... en dat werkte alleen op
 * de machine van de schrijver: voor iedere vreemde viel de controle stil weg en hij
 * kreeg zonder het te weten een zwakkere uitslag dan wij. Dat is precies het
 * tegenovergestelde van wat een onafhankelijke verifieerder hoort te zijn.
 *
 * Niet aanwezig betekent ONGEMETEN en nooit stil overgeslagen: de aanroeper krijgt
 * een reden terug die hij in zijn uitslag kan laten zien.
 */
let ethersCache
export async function laadEthers() {
  if (ethersCache !== undefined) return ethersCache
  try {
    ethersCache = await import('ethers')
  } catch {
    ethersCache = null
  }
  return ethersCache
}

/** §4.3, normatief. Reist niet over de lijn, dus een verifier haalt het uit de spec. */
export const OFFER_EIP712_DOMAIN = { name: 'x402 offer', version: '1', chainId: 1 }
export const OFFER_EIP712_TYPES = {
  Offer: [
    { name: 'version', type: 'uint256' },
    { name: 'resourceUrl', type: 'string' },
    { name: 'scheme', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'asset', type: 'string' },
    { name: 'payTo', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'validUntil', type: 'uint256' },
  ],
}

/**
 * Controleer de handtekening op een aangeboden offer.
 *
 * Geeft {ok, signer} of {ok:false, reden}. Zonder ethers komt er expliciet
 * ongemeten terug, want een overgeslagen controle mag nooit als geslaagde controle
 * lezen.
 */
export async function verifyOfferSignature(artefact) {
  if (!artefact || artefact.format !== 'eip712' || !artefact.payload || !artefact.signature) {
    return { ok: false, reden: 'geen eip712-artefact met payload en signature' }
  }
  const ethers = await laadEthers()
  if (!ethers) {
    return { ok: false, ongemeten: true, reden: 'ethers niet beschikbaar, dus de handtekening is NIET gecontroleerd' }
  }
  try {
    const signer = ethers.verifyTypedData(OFFER_EIP712_DOMAIN, OFFER_EIP712_TYPES, artefact.payload, artefact.signature)
    return { ok: true, signer }
  } catch (e) {
    return { ok: false, reden: String(e.message).slice(0, 90) }
  }
}
