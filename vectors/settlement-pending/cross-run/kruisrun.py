#!/usr/bin/env python3
# Cross-run: lets the decision logic of mitaka7210's runnable gist answer every vector of this family and compares the
# answers with the reference of this set. Standard library only. No network. Reads only the two paths it is given.
#
#   python -I kruisrun.py ../vectors.json path/to/test_settlement_pending_chain_before_delivery.py --sha256 <sha256 of that file>
#
# This runs the file you give it as Python code. Read it first. With --sha256 the adapter refuses (exit 2) a file with another hash.
#
# This is our own adapter. It translates an observation of this set into the inputs of his decide() and translates his verdict
# back (allow = DELIVER, deny = REFUSE, pending and indeterminate = HOLD). It does not copy his file into this repository.
# What the adapter has to assume is listed in README.md next to this file. The result says "ran against", not "verified".
# Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending/cross-run, 2026-11-23.
import hashlib
import importlib.util
import json
import sys

USAGE = 'usage: python -I kruisrun.py <vectors.json> <gist file> [--sha256 <hex sha256 of the gist file>]'
# The same bytes on every platform, so that uitvoer.txt can be compared; a file name outside the console code page must not crash it.
sys.stdout.reconfigure(newline='\n', encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')


def fail(message):
    sys.stderr.write(message + '\n')
    sys.exit(2)


args = sys.argv[1:]
expected = None
if '--sha256' in args:
    at = args.index('--sha256')
    if at + 1 >= len(args):
        fail(USAGE)
    expected = args[at + 1].lower()
    del args[at:at + 2]
if len(args) != 2:
    fail(USAGE)
vectors_path, gist_path = args
try:
    raw = open(gist_path, 'rb').read()
except OSError as error:
    fail('cannot read the gist file: %s' % error)
digest = hashlib.sha256(raw).hexdigest()
if expected is not None and digest != expected:
    fail('the gist file has sha256 %s and not %s: it was not run' % (digest, expected))
if expected is None:
    sys.stderr.write('WARNING: this runs the file you gave it as Python code. Read it first, or pass --sha256 with the hash of a file you have read.\n')
spec = importlib.util.spec_from_file_location('gist', gist_path)
m = importlib.util.module_from_spec(spec)
sys.modules['gist'] = m  # the file uses dataclasses with postponed annotations, which need the module to be registered
spec.loader.exec_module(m)

S = json.load(open(vectors_path, encoding='utf8'))
HEAD = 1000
BLOCK = {'shallow': 999, 'deep': 990, 'reverted': 990, 'reverted_shallow': 999}
OUT = {m.ALLOW: 'DELIVER', m.DENY: 'REFUSE', m.PENDING: 'HOLD', m.INDETERMINATE: 'HOLD'}
# Revisions of the gist from its second revision on compare amounts as integers in atomic units and take a payer. The first one
# compared floats and had no payer. The adapter speaks both so that the run that led to the fix stays reproducible.
ATOMIC_API = hasattr(m, 'PRICE_ATOMIC')

# Why his answer may differ from ours, per vector. A difference without an entry here is reported as unexplained.
# The revision of 24 November adds decide(nonce=...); earlier revisions (including the one the README calls
# "the revision of 23 November") have no nonce parameter at all, and ATOMIC_API alone does not tell them apart.
import inspect
HAS_NONCE = ATOMIC_API and 'nonce' in inspect.signature(m.decide).parameters

NONCE_BINDING = 'not in his file: the nonce binding of the authorization rail is described in his message and lives in his production code'
NONCE_UNREADABLE = 'his nonce check needs a receipt that names an authorization; this vector has none to name, so it is never the one that consumed the nonce'
FIRST_REVISION_BINDING = 'not in the first revision of his file: the binding of a transfer to a payment (nonce on the authorization rail, payer on the proof rail) lived in his production code'
FIRST_REVISION_FLOATS = 'the first revision of his file compared amounts as floats and handled USDC with 6 decimals only'
WHY = {
    'old-payment-of-ours-refuse': (None if HAS_NONCE else NONCE_BINDING) if ATOMIC_API else FIRST_REVISION_BINDING,
    'old-payment-overpaid-refuse': (None if HAS_NONCE else NONCE_BINDING) if ATOMIC_API else FIRST_REVISION_BINDING,
    'transfer-nonce-unreadable-open': (NONCE_UNREADABLE if HAS_NONCE else NONCE_BINDING) if ATOMIC_API else FIRST_REVISION_BINDING,
    'proof-rail-other-payer-refuse': FIRST_REVISION_BINDING,
    'proof-rail-near-miss-payer-refuse': FIRST_REVISION_BINDING,
    'proof-rail-payer-unreadable-open': 'his file cannot express a sender that is unreadable: the adapter hands it the default sender' if ATOMIC_API else FIRST_REVISION_BINDING,
    'underpaid-beyond-safe-integer-refuse': FIRST_REVISION_FLOATS,
    'underpaid-18-decimals-refuse': FIRST_REVISION_FLOATS,
    'pending-without-hash-open': 'open in this set; his file denies it',
    'reverted-shallow-open': 'open in this set; his file denies a reverted transaction at any depth',
    'malformed-hash-open': 'open in this set; his file denies it',
}


def build(o):
    resp = dict(o['response'])
    retry = o.get('retry')
    if retry and retry.get('sameAuthorization'):
        # Adoption by nonce is not in his file. We hand his decide() the hash that the nonce lookup found, as a pending response.
        resp = {'success': False, 'errorReason': m.SETTLEMENT_PENDING_CODE, 'transaction': retry['hashFromNonceLookup']}
    c = o['chain']
    receipt = c['receipt']
    receipts = {}
    if receipt not in ('absent', 'not_measured'):
        t = c.get('transfer')
        transfers = ()
        authorizations = ()
        if t:
            token = m.USDC if t['token'].lower() == o['quote']['asset'].lower() else m.OTHER_TOKEN
            kw = {'sender': t['from']} if t.get('from') else {}
            if ATOMIC_API:
                transfers = (m.Transfer(token=token, to=t['to'], amount_atomic=int(t['amount']), **kw),)
                # The authorization this receipt actually consumed, if the vector's chain data names one.
                # On the authorization rail, this is what his nonce check compares the vector's own
                # payment.nonce against (build of the Receipt's authorizations, not the Transfer's sender).
                if t.get('nonce') and t.get('from'):
                    authorizations = ((t['from'], t['nonce']),)
            else:
                transfers = (m.Transfer(token=token, to=t['to'], amount_usdc=int(t['amount']) / 1e6, **kw),)
        tx = resp.get('transaction') or ''
        receipt_kwargs = dict(tx_hash=tx, status=0 if receipt.startswith('reverted') else 1, block_number=BLOCK[receipt], transfers=transfers)
        if ATOMIC_API:
            receipt_kwargs['authorizations'] = authorizations
        receipts[tx] = m.Receipt(**receipt_kwargs)
    chain = m.SyntheticChain(head=HEAD, receipts=receipts)
    store = m.EffectStore()
    if o.get('claims', {}).get('hash') == 'delivered':
        tx = resp.get('transaction') or ''
        store.claim(tx)
        store.mark_delivered(tx, {'ok': True})
    return resp, chain, store


rows = []
for v in S['vectors']:
    o = v['input']
    resp, chain, store = build(o)
    if ATOMIC_API:
        # The proof rail binds a transfer by the payer that signed the proof. The authorization rail binds
        # by the nonce of the authorization that pays for THIS call (his decide(nonce=...), added in the
        # gist revision of 24 November) -- the payer named by the receipt's own transfer is what his nonce
        # check keys the consumed-authorizations lookup by, so it is passed on this rail too.
        rail = o['payment']['rail']
        if rail == 'proof':
            payer, nonce = o['payment'].get('payer'), None
        else:
            t = o['chain'].get('transfer')
            payer, nonce = (t.get('from') if t else None), o['payment'].get('nonce')
        d = m.handle(resp, chain, store, pay_to=o['quote']['payTo'], price_atomic=int(o['quote']['price']), payer=payer, nonce=nonce)
    else:
        d = m.handle(resp, chain, store, pay_to=o['quote']['payTo'], price=int(o['quote']['price']) / 1e6)
    short = v['id'].replace('x402-settlement-pending-', '')
    exp = v['expected']
    allowed = exp.get('acceptable') or [exp['outcome']]
    got = OUT[d.verdict]
    asserted = v.get('asserted') is not False
    if not asserted:
        kind = 'open'
    elif got == exp['outcome']:
        kind = 'same'
    elif got in allowed:
        kind = 'within'
    else:
        kind = 'differs'
    rows.append((short, asserted, exp['outcome'], allowed, d.verdict, got, ','.join(d.reasons), kind))

asserted_rows = [r for r in rows if r[1]]
count = lambda k: len([r for r in asserted_rows if r[7] == k])
print('cross-run: the vectors of draft 3 against the decision logic of the gist of mitaka7210')
print('gist file: %s, %d bytes, sha256 %s' % (gist_path.replace('\\', '/').split('/')[-1], len(raw), digest))
print('python: %d.%d.%d, %s' % (sys.version_info[0], sys.version_info[1], sys.version_info[2], 'started with -I' if sys.flags.isolated else 'not started with -I'))
print('vectors: %d, asserted %d, open %d' % (len(rows), len(asserted_rows), len(rows) - len(asserted_rows)))
print('asserted vectors, answer of his logic compared with ours:')
print('  same answer as the reference: %d' % count('same'))
print('  a different answer that the vector allows (refuse or hold): %d' % count('within'))
print('  outside what the vector allows: %d' % count('differs'))
unexplained = [r for r in rows if r[7] == 'differs' and r[0] not in WHY]
print('  of those, without an explanation in this adapter: %d' % len(unexplained))
print('open vectors (nothing is asserted, his answer is shown): %d' % (len(rows) - len(asserted_rows)))
print('')
print('every vector where his answer is not the reference answer:')
for r in rows:
    if r[7] == 'same':
        continue
    label = {'within': 'allowed', 'differs': 'outside', 'open': 'open   '}[r[7]]
    why = ''
    if r[7] in ('differs', 'open') and r[0] in WHY:
        why = '  [' + WHY[r[0]] + ']'
    print('  %s %-46s reference %-7s his logic %-13s (%s)%s' % (label, r[0], r[2], r[4], r[6] or 'no reason given', why))
sys.exit(0)
