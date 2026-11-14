// x402-client-checklist tegen echte, bevestigde gevallen EN tegen geplante
// mutaties die de treffer juist weg moeten halen (Test-de-tester-discipline:
// een controleur is pas af als een geplante fout hem laat falen, ook een
// WEGLATING). De twee "echt"-vectoren zijn letterlijke, ongewijzigde stukken
// publieke broncode (Apache-2.0 resp. een OSS-repo), kort gehouden tot precies
// de functies die de treffer/niet-treffer bepalen, zodat deze test geen
// afhankelijkheid heeft op een lokale clone van een ander project.

import { scanBron, vindOngebruikteLimietParameter, vindOpstartHerlaadStructurAsymmetrie, taalVanBestand } from '../src/x402-client-checklist.mjs'

let goed = 0
let fout = 0
function check(naam, conditie, detail = '') {
  if (conditie) {
    goed++
    console.log('  pass  ' + naam)
  } else {
    fout++
    console.log('  FAIL  ' + naam + (detail ? '  -- ' + detail : ''))
  }
}

console.log('x402-client-checklist')

// --- ECHT, POSITIEF: google-agentic-commerce/a2a-x402, process_payment() ---
// Letterlijk uit python/x402_a2a/src/x402_a2a/core/wallet.py (Apache-2.0),
// ingekort tot signature + lichaam; max_value komt in de signature voor en
// NERGENS in het lichaam.
const A2A_PROCESS_PAYMENT = `
def process_payment(
    requirements: PaymentRequirements,
    account: LocalAccount,
    max_value: Optional[int] = None,
    valid_after: Optional[int] = None,
    valid_before: Optional[int] = None,
) -> PaymentPayload:
    """Creates a PaymentPayload containing a valid EIP-3009 signature."""
    rpc_url = os.getenv("RPC_URL", "https://sepolia.base.org")
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    auth_data = {
        "from_": account.address,
        "to": requirements.pay_to,
        "value": int(requirements.max_amount_required),
        "valid_after": valid_after if valid_after is not None else 0,
    }
    signed_message = account.sign_message(auth_data)
    return PaymentPayload(payload=signed_message)
`

// --- ECHT, TRUE NEGATIVE in DEZELFDE bron: process_payment_required() geeft
// max_value wel door aan x402Client, dus mag NIET getroffen worden.
const A2A_PROCESS_PAYMENT_REQUIRED = `
def process_payment_required(
    payment_required: x402PaymentRequiredResponse,
    account: LocalAccount,
    max_value: Optional[int] = None,
    valid_after: Optional[int] = None,
    valid_before: Optional[int] = None,
) -> PaymentPayload:
    """Process full payment required response using x402Client logic."""
    client = x402Client(account=cast(Account, account), max_value=max_value)
    selected_requirement = client.select_payment_requirements(payment_required.accepts)
    return process_payment(selected_requirement, account, max_value, valid_after, valid_before)
`

{
  const treffers = vindOngebruikteLimietParameter(A2A_PROCESS_PAYMENT, 'py')
  check(
    'a2a-x402 process_payment: max_value wordt getroffen (echte, bevestigde bug)',
    treffers.length === 1 && treffers[0].functie === 'process_payment' && treffers[0].parameter === 'max_value'
  )
}
{
  const treffers = vindOngebruikteLimietParameter(A2A_PROCESS_PAYMENT_REQUIRED, 'py')
  check('a2a-x402 process_payment_required: GEEN treffer, max_value wordt wel doorgegeven', treffers.length === 0)
}

// --- ECHT, POSITIEF: BlockRunAI/ClawRouter, src/spend-control.ts ---
// Letterlijk de relevante catch-blokken, ingekort maar met dezelfde namen en
// structuur als de echte klasse.
const CLAWROUTER_SPEND_CONTROL = `
export class UnreadableSpendPolicyError extends Error {
  constructor(cause) { super('unreadable'); this.name = 'UnreadableSpendPolicyError' }
}
export class MalformedSpendPolicyError extends Error {
  constructor(key) { super('malformed'); this.name = 'MalformedSpendPolicyError' }
}
export class SpendControl {
  constructor(options) {
    this.load()
  }
  private load() {
    try {
      this.storage.load()
    } catch (err) {
      if (err instanceof UnreadableSpendPolicyError) {
        console.error('starting fresh')
        return
      }
      if (!(err instanceof MalformedSpendPolicyError)) throw err
      this.policyFileBroken = err.message
      return
    }
  }
  reloadLimits() {
    try {
      this.storage.load()
    } catch (err) {
      if (err instanceof UnreadableSpendPolicyError) {
        console.error('keeping the limits already in effect')
        return
      }
      if (!(err instanceof MalformedSpendPolicyError)) throw err
      this.policyFileBroken = err.message
      return
    }
  }
}
`

{
  const treffers = vindOpstartHerlaadStructurAsymmetrie(CLAWROUTER_SPEND_CONTROL, 'ts')
  const foutNamen = treffers.map((t) => t.fout).sort()
  check(
    'ClawRouter SpendControl: beide foutklassen getroffen (load=init-vormig, reloadLimits=herlaad-vormig)',
    treffers.length === 2 && foutNamen.join(',') === 'MalformedSpendPolicyError,UnreadableSpendPolicyError'
  )
}

// --- MUTATIE 1 (WEGLATING): haal reloadLimits() weg -- de asymmetrie-vorm kan
// dan niet meer bestaan, dus GEEN treffer. Dit is precies de mutatiesoort
// ("weghalen uit een niet-lege lijst") die de huis-regel voorschrijft.
{
  const zonderReload = CLAWROUTER_SPEND_CONTROL.replace(/reloadLimits\(\)[\s\S]*?\n  \}\n/, '')
  const treffers = vindOpstartHerlaadStructurAsymmetrie(zonderReload, 'ts')
  check('mutatie: reloadLimits() weggehaald -> geen treffer meer', treffers.length === 0, JSON.stringify(treffers))
}

// --- MUTATIE 2 (OMWISSELEN): hernoem reloadLimits naar iets niet-herlaad-vormigs
// -- de naam-heuristiek moet dan niet meer vuren.
{
  const herbenoemd = CLAWROUTER_SPEND_CONTROL.replace(/reloadLimits/g, 'checkPolicyAgain')
  const treffers = vindOpstartHerlaadStructurAsymmetrie(herbenoemd, 'ts')
  check('mutatie: reloadLimits hernoemd naar een niet-herlaad-vormige naam -> geen treffer', treffers.length === 0)
}

// --- SYNTHETISCHE NEGATIEVE CONTROLE (patroon 1): maxValue WORDT gelezen in
// een vergelijking -- moet NOOIT getroffen worden.
{
  const veilig = `
function pay(maxValue, amount) {
  if (amount > maxValue) throw new Error('boven de limiet')
  return sign(amount)
}
`
  const treffers = vindOngebruikteLimietParameter(veilig, 'js')
  check('synthetische negatieve controle: maxValue wordt wel gelezen -> geen treffer', treffers.length === 0)
}

// --- SYNTHETISCHE NEGATIEVE CONTROLE (patroon 2): dezelfde foutklasse alleen
// gevangen in EEN methode, geen init/herlaad-paar -- moet niet getroffen worden.
{
  const veilig = `
class Ding {
  doeIets() {
    try { x() } catch (err) { if (err instanceof RareError) return }
  }
}
`
  const treffers = vindOpstartHerlaadStructurAsymmetrie(veilig, 'ts')
  check('synthetische negatieve controle: fout maar in 1 methode -> geen treffer', treffers.length === 0)
}

// --- RANDGEVAL: lege/onbekende taal mag niet crashen, geeft gewoon niets terug.
{
  check('taalVanBestand(onbekend.rb) is null', taalVanBestand('ding.rb') === null)
  check('scanBron op onbekende taal crasht niet en geeft [] terug', JSON.stringify(scanBron('x', 'ding.rb')) === '[]')
  check('scanBron op leeg bestand crasht niet', JSON.stringify(scanBron('', 'leeg.ts')) === '[]')
}

console.log('\n' + goed + ' passed, ' + fout + ' failed')
process.exitCode = fout === 0 ? 0 : 1
