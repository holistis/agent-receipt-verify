// Tests that use only tables, examples and statements that are in the specification text.
// Every test name carries the line numbers of the text it comes from.
// Codes are asserted only where the text names them; for invented codes the tests assert
// the outcome REJECT and nothing about the code.
// Run: node --test interop/refusal-row/spec-examples.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluate, deriveAttemptIdentity } from './refusal-row.mjs';

const KEY = 'ed25519:' + 'A'.repeat(43);
const ID = 'sha256:' + 'a'.repeat(64);
const SETTLEMENTS = ['not_submitted', 'pending', 'settled', 'unknown'];
const STATUSES = ['not_reached', 'executed', 'failed', 'unknown'];
const CLASSES = ['issuer_asserted', 'client_verifiable', 'chain_verifiable', 'independently_witnessed'];

const row = (o = {}) => ({
  signing_public_key: KEY,
  attempt_identity: ID,
  decision: 'refused',
  settlement: 'unknown',
  ...o,
});
const legs = (a, t) => {
  const l = {};
  if (a) l.authorization = { status: a };
  if (t) l.transfer = { status: t };
  return l;
};
const accepts = (r) => assert.equal(evaluate(r).outcome, 'ACCEPT', JSON.stringify(evaluate(r)));
const rejects = (r, code) => {
  const out = evaluate(r);
  assert.equal(out.outcome, 'REJECT', JSON.stringify(out));
  if (code) assert.equal(out.code, code);
};

// Section 5 table, lines 132-150 (ceilings).
const CEILING = {
  invalid_signature: 'client_verifiable',
  wrong_amount: 'client_verifiable',
  wrong_recipient: 'client_verifiable',
  malformed_payload: 'client_verifiable',
  authorization_expired: 'chain_verifiable',
  authorization_not_yet_valid: 'chain_verifiable',
  insufficient_funds: 'issuer_asserted',
  duplicate_payment: 'chain_verifiable',
  nonce_already_used: 'chain_verifiable',
  transfer_leg_failed: 'issuer_asserted', // line 143
  facilitator_timeout: 'issuer_asserted',
  risk_policy_rejected: 'issuer_asserted',
  commercial_refusal: 'issuer_asserted',
  internal_error: 'issuer_asserted',
  replay_already_settled: 'issuer_asserted',
  replay_in_flight: 'issuer_asserted',
  could_not_compare: 'issuer_asserted',
};
const REASONS = Object.keys(CEILING);

// Lines 174-178: settlement each repeat reason claims.
const REPEAT = { replay_already_settled: 'settled', replay_in_flight: 'pending', could_not_compare: 'unknown' };
const settlementFor = (reason) => REPEAT[reason] ?? 'not_submitted';
const finalFor = (s) => (s === 'pending' ? { final: false } : {});

// Section 15.4 table, lines 533-552, transcribed in the text's own notation:
// bare list = required, bracketed list = bounded optional.
const LEG_TABLE = {
  invalid_signature: ['failed,unknown', '[not_reached]'],
  wrong_amount: ['failed,unknown', '[not_reached]'],
  wrong_recipient: ['failed,unknown', '[not_reached]'],
  malformed_payload: ['failed,unknown,not_reached', '[not_reached]'],
  authorization_expired: ['failed,unknown', '[not_reached]'],
  authorization_not_yet_valid: ['failed,unknown', '[not_reached]'],
  insufficient_funds: ['failed,unknown', '[not_reached]'],
  nonce_already_used: ['failed,executed', '[not_reached,failed]'],
  transfer_leg_failed: ['executed', 'failed'],
  facilitator_timeout: ['unknown', '[not_reached,unknown]'],
  internal_error: ['executed,unknown', '[not_reached,unknown]'],
  risk_policy_rejected: ['not_reached,unknown', '[not_reached]'],
  commercial_refusal: ['not_reached,unknown', '[not_reached]'],
  replay_already_settled: ['executed', '[not_reached]'],
  duplicate_payment: ['executed', '[not_reached]'],
  replay_in_flight: ['[not_reached,unknown]', '[not_reached,unknown]'],
  could_not_compare: ['[not_reached,unknown]', '[not_reached,unknown]'],
};
const parseCell = (s) => {
  const optional = s.startsWith('[');
  return { optional, values: s.replace(/[\[\]]/g, '').split(',') };
};

// Section 15.4 L6 table, lines 618-627.
const L6 = {
  authorization: {
    executed: ['not_submitted', 'pending', 'settled', 'unknown'],
    failed: ['not_submitted', 'unknown'],
    not_reached: ['not_submitted', 'unknown'],
    unknown: ['not_submitted', 'pending', 'unknown'],
  },
  transfer: {
    executed: ['settled', 'pending'],
    failed: ['not_submitted', 'unknown'],
    not_reached: ['not_submitted', 'unknown'],
    unknown: ['not_submitted', 'pending', 'unknown'],
  },
};
// A settlement that satisfies the L6 rows of the recorded legs and the repeat table, or null.
const pickSettlement = (reason, a, t) => {
  for (const s of ['unknown', 'not_submitted', 'pending', 'settled']) {
    if (a && !L6.authorization[a].includes(s)) continue;
    if (t && !L6.transfer[t].includes(s)) continue;
    if (REPEAT[reason] && REPEAT[reason] !== s) continue;
    return s;
  }
  return null;
};

// ---- Section 4 (lines 86-125)

test('line 88: schema_version of an accepted row is sycee/refusal/v0.1', () => {
  const out = evaluate(row({ decision: 'accepted' }));
  assert.equal(out.fields.schema_version, 'sycee/refusal/v0.1');
});

test('lines 89, 196: decision accepted and refused are the two values; anything else is rejected', () => {
  accepts(row({ decision: 'accepted' }));
  accepts(row({ decision: 'refused', reason: 'wrong_amount' }));
  rejects(row({ decision: 'declined' }));
  rejects(row({ decision: undefined }));
});

test('lines 94, 200: settlement is one of four values', () => {
  for (const s of SETTLEMENTS) accepts(row({ decision: 'accepted', settlement: s, ...finalFor(s) }));
  rejects(row({ decision: 'accepted', settlement: 'settling' }));
});

test('lines 95, 200-201: final is false when settlement is pending (accepted row)', () => {
  accepts(row({ decision: 'accepted', settlement: 'pending', final: false }));
  rejects(row({ decision: 'accepted', settlement: 'pending', final: true }));
  assert.equal(evaluate(row({ decision: 'accepted', settlement: 'pending' })).fields.final, false);
});

test('lines 95, 200-201: final is false when settlement is pending (refused row)', () => {
  rejects(row({ reason: 'wrong_amount', settlement: 'pending', final: true }));
  accepts(row({ reason: 'wrong_amount', settlement: 'pending', final: false }));
});

test('lines 93, 101: attempt_identity is sha256:<64 hex>; signer.public_key is ed25519:<base64url>', () => {
  rejects(row({ decision: 'accepted', attempt_identity: 'sha256:abc' }));
  rejects(row({ decision: 'accepted', attempt_identity: 'a'.repeat(64) }));
  rejects(row({ decision: 'accepted', signing_public_key: 'rsa:AAAA' }));
  rejects(row({ decision: 'accepted', signing_public_key: 'ed25519:' }));
  const out = evaluate(row({ decision: 'accepted' }));
  assert.equal(out.fields.attempt_identity, ID);
  assert.equal(out.fields.signer.public_key, KEY);
});

test('line 103: key_check is not_measured when the payee is unknown (no payee is supplied)', () => {
  assert.equal(evaluate(row({ decision: 'accepted' })).fields.key_check, 'not_measured');
});

test('lines 123-125: two presentations of one payload resolve to two identities', () => {
  const a = deriveAttemptIdentity('payload-bytes', 'requirements-bytes', 1);
  const b = deriveAttemptIdentity('payload-bytes', 'requirements-bytes', 2);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

// ---- Section 11 (lines 300-318)

test('lines 307, 311: naive concatenation collides for (A:1, 2) and (A:, 12); the object form does not', () => {
  const h = (s) => createHash('sha256').update(s).digest('hex');
  assert.equal(h('A:1' + String(2)), h('A:' + String(12)));
  assert.notEqual(
    deriveAttemptIdentity('A:1', 'req', 2),
    deriveAttemptIdentity('A:', 'req', 12),
  );
});

// ---- Section 5 (lines 127-190)

for (const reason of REASONS) {
  const ceiling = CEILING[reason];
  test(`line 134-150: ${reason} accepts its ceiling ${ceiling} and rejects the class above it`, () => {
    const s = settlementFor(reason);
    const base = row({ reason, settlement: s, ...finalFor(s) });
    accepts({ ...base, evidence_class: ceiling });
    assert.equal(evaluate({ ...base, evidence_class: ceiling }).fields.evidence_class, ceiling);
    const above = CLASSES[CLASSES.indexOf(ceiling) + 1];
    if (above) rejects({ ...base, evidence_class: above });
  });
}

test('lines 28-29: no reason may claim independently_witnessed', () => {
  for (const reason of REASONS) {
    const s = settlementFor(reason);
    rejects(row({ reason, settlement: s, ...finalFor(s), evidence_class: 'independently_witnessed' }));
  }
});

for (const reason of REASONS) {
  test(`lines 157-159, 693-695: ${reason} without evidence_class gets the reproducible ceiling ${CEILING[reason]}`, () => {
    const s = settlementFor(reason);
    const out = evaluate(row({ reason, settlement: s, ...finalFor(s) }));
    assert.equal(out.outcome, 'ACCEPT');
    assert.equal(out.fields.evidence_class, CEILING[reason]);
  });
}

test('lines 657-660: transfer_leg_failed claiming chain_verifiable is rejected at construction', () => {
  rejects(
    row({
      reason: 'transfer_leg_failed',
      evidence_class: 'chain_verifiable',
      legs: legs('executed', 'failed'),
      settlement: 'unknown',
    }),
  );
});

test('lines 730-731: the base ceiling of transfer_leg_failed is not its default', () => {
  const out = evaluate(row({ reason: 'transfer_leg_failed', legs: legs('executed', 'failed') }));
  assert.equal(out.fields.evidence_class, 'issuer_asserted');
});

test('lines 151-155, 197-198: an unknown reason is rejected', () => {
  rejects(row({ reason: 'made_up_reason' }));
  rejects(row({ reason: 'made_up_reason', evidence_class: 'issuer_asserted' }));
});

test('lines 599-603: an unknown reason is rejected whatever leg statuses it carries', () => {
  for (const a of STATUSES) {
    for (const t of STATUSES) rejects(row({ reason: 'made_up_reason', legs: legs(a, t) }));
  }
});

test('lines 174-178, 180-181: each repeat reason accepts its settlement and rejects the other three with settlement_contradicts_reason', () => {
  for (const [reason, claimed] of Object.entries(REPEAT)) {
    for (const s of SETTLEMENTS) {
      const r = row({ reason, settlement: s, ...finalFor(s) });
      if (s === claimed) accepts(r);
      else rejects(r, 'settlement_contradicts_reason');
    }
  }
});

test('lines 203-205: replay_already_settled with not_submitted is rejected', () => {
  rejects(row({ reason: 'replay_already_settled', settlement: 'not_submitted' }), 'settlement_contradicts_reason');
});

test('lines 187-190: could_not_compare is not collapsed into replay_already_settled', () => {
  rejects(row({ reason: 'could_not_compare', settlement: 'settled' }), 'settlement_contradicts_reason');
  accepts(row({ reason: 'could_not_compare', settlement: 'unknown' }));
});

test('lines 183-185: duplicate_payment is not constrained by the repeat table', () => {
  for (const s of SETTLEMENTS) accepts(row({ reason: 'duplicate_payment', settlement: s, ...finalFor(s) }));
});

// ---- Section 13 crosswalk (lines 360-365)

test('lines 362-363: could_not_compare with unknown is a refusal', () => {
  const out = evaluate(row({ reason: 'could_not_compare', settlement: 'unknown' }));
  assert.equal(out.fields.decision, 'refused');
});
test('line 364: replay_already_settled with settled is a refusal', () => {
  const out = evaluate(row({ reason: 'replay_already_settled', settlement: 'settled' }));
  assert.equal(out.fields.decision, 'refused');
});
test('line 365: accepted with not_submitted is an accepted row', () => {
  const out = evaluate(row({ decision: 'accepted', settlement: 'not_submitted' }));
  assert.equal(out.fields.decision, 'accepted');
  assert.equal(out.fields.settlement, 'not_submitted');
});

// ---- Section 15.4 (lines 505-632)

test('lines 518-519: a refused row may omit legs, for every reason', () => {
  for (const reason of REASONS) {
    const s = settlementFor(reason);
    const out = evaluate(row({ reason, settlement: s, ...finalFor(s) }));
    assert.equal(out.outcome, 'ACCEPT', reason);
    assert.equal('legs' in out.fields, false, reason);
  }
});

test('lines 588-591, 528-531: an unknown leg name is rejected with unknown_leg', () => {
  rejects(row({ reason: 'internal_error', legs: { authorization: { status: 'executed' }, settlement: { status: 'executed' } } }), 'unknown_leg');
});

test('lines 528-531, 588-591: a status outside the four is rejected with unknown_leg_status, whatever the reason', () => {
  for (const reason of REASONS) {
    rejects(row({ reason, legs: legs('half_done') }), 'unknown_leg_status');
    rejects(row({ reason, legs: { transfer: { status: 'half_done' } } }), 'unknown_leg_status');
  }
});

test('lines 554-556: a bare list is required once legs is present (leg_not_observed)', () => {
  for (const [reason, [aCell, tCell]] of Object.entries(LEG_TABLE)) {
    const a = parseCell(aCell);
    const t = parseCell(tCell);
    if (!a.optional) {
      rejects(row({ reason, legs: { transfer: { status: t.values[0] } } }), 'leg_not_observed');
    }
    if (!t.optional) {
      rejects(row({ reason, legs: { authorization: { status: a.values[0] } } }), 'leg_not_observed');
    }
    if (!a.optional || !t.optional) rejects(row({ reason, legs: {} }), 'leg_not_observed');
  }
});

// Table-driven: one leg varied over all four statuses, the other leg held at a value the table permits.
const heldOther = (reason, leg, status) => {
  const [aCell, tCell] = LEG_TABLE[reason].map(parseCell);
  if (leg === 'authorization') {
    return { a: status, t: tCell.optional ? null : tCell.values[0] };
  }
  // varying the transfer: pick an authorization value that keeps the order rule satisfied
  const ok = aCell.values.find((v) => status === 'not_reached' || (v !== 'not_reached' && v !== 'failed'));
  return { a: aCell.optional && ok === undefined ? null : ok ?? aCell.values[0], t: status };
};

for (const reason of Object.keys(LEG_TABLE)) {
  for (const leg of ['authorization', 'transfer']) {
    const cell = parseCell(LEG_TABLE[reason][leg === 'authorization' ? 0 : 1]);
    for (const status of STATUSES) {
      const permitted = cell.values.includes(status);
      const { a, t } = heldOther(reason, leg, status);
      const s = pickSettlement(reason, a, t);
      const name = `lines 533-552: ${reason}.${leg} = ${status} is ${permitted ? 'permitted' : 'rejected with leg_contradicts_reason'}`;
      if (s === null) {
        test(name, { skip: 'no settlement satisfies both the L6 table and the repeat table; see AMBIGUITIES.md entry A20' }, () => {});
        continue;
      }
      test(name, () => {
        const r = row({ reason, settlement: s, ...finalFor(s), legs: legs(a, t) });
        if (permitted) accepts(r);
        else rejects(r, 'leg_contradicts_reason');
      });
    }
  }
}

test('lines 564-568: no reviewed reason takes transfer executed', () => {
  for (const reason of REASONS) {
    for (const a of ['executed', 'unknown']) {
      rejects(row({ reason, settlement: 'settled', legs: legs(a, 'executed') }));
    }
  }
});

test('lines 569-573: only transfer_leg_failed takes transfer failed; invalid_signature, wrong_amount, wrong_recipient admit only not_reached', () => {
  for (const reason of REASONS) {
    const r = row({ reason, settlement: 'unknown', legs: legs('executed', 'failed') });
    if (reason === 'transfer_leg_failed' || reason === 'nonce_already_used') accepts(r); // line 542 lists failed for nonce_already_used
    else if (REPEAT[reason]) rejects(r); // a second fault (the repeat table) may also apply
    else rejects(r, 'leg_contradicts_reason');
  }
  for (const reason of ['invalid_signature', 'wrong_amount', 'wrong_recipient']) {
    for (const t of ['executed', 'failed', 'unknown']) {
      rejects(row({ reason, settlement: 'unknown', legs: legs('unknown', t) }), 'leg_contradicts_reason');
    }
  }
});

test('lines 574-577: facilitator_timeout and internal_error take transfer not_reached or unknown', () => {
  for (const reason of ['facilitator_timeout', 'internal_error']) {
    accepts(row({ reason, legs: legs('unknown', 'not_reached') }));
    accepts(row({ reason, legs: legs('unknown', 'unknown') }));
    rejects(row({ reason, legs: legs('unknown', 'failed') }), 'leg_contradicts_reason');
  }
});

test('lines 578-582: internal_error with transfer failed fails with leg_contradicts_reason, whatever the authorization leg says', () => {
  for (const a of STATUSES) {
    rejects(row({ reason: 'internal_error', legs: legs(a, 'failed') }), 'leg_contradicts_reason');
  }
});

test('lines 592-597: a transfer status other than not_reached cannot follow authorization not_reached or failed', () => {
  // Line 542 admits failed on authorization and failed on transfer for nonce_already_used, each alone.
  accepts(row({ reason: 'nonce_already_used', legs: legs('failed', 'not_reached') }));
  accepts(row({ reason: 'nonce_already_used', legs: legs('executed', 'failed') }));
  rejects(row({ reason: 'nonce_already_used', legs: legs('failed', 'failed') }), 'leg_contradicts_reason');
  // Line 550 admits not_reached on authorization and unknown on transfer for replay_in_flight, each alone.
  rejects(row({ reason: 'replay_in_flight', settlement: 'unknown', legs: legs('not_reached', 'unknown') }), 'leg_contradicts_reason');
});

test('lines 605-608: transfer_leg_failed is pinned on both legs', () => {
  accepts(row({ reason: 'transfer_leg_failed', legs: legs('executed', 'failed') }));
  rejects(row({ reason: 'transfer_leg_failed', legs: legs('executed') }), 'leg_not_observed');
  rejects(row({ reason: 'transfer_leg_failed', legs: legs(null, 'failed') }), 'leg_not_observed');
  rejects(row({ reason: 'transfer_leg_failed', legs: legs('unknown', 'failed') }), 'leg_contradicts_reason');
  rejects(row({ reason: 'transfer_leg_failed', legs: legs('executed', 'unknown') }), 'leg_contradicts_reason');
});

test('lines 609-610: nonce_already_used admits executed', () => {
  accepts(row({ reason: 'nonce_already_used', legs: legs('executed', 'not_reached') }));
  accepts(row({ reason: 'nonce_already_used', legs: legs('executed', 'failed') }));
});

test('lines 637-638: an accepted row records no legs at all', () => {
  rejects(row({ decision: 'accepted', legs: legs('executed') }));
  accepts(row({ decision: 'accepted' }));
});

// L6 table, lines 612-632.
const L6_CASES = [
  ['authorization', 'executed', 'internal_error', (st) => legs(st, null)],
  ['authorization', 'failed', 'wrong_amount', (st) => legs(st, null)],
  ['authorization', 'not_reached', 'risk_policy_rejected', (st) => legs(st, null)],
  ['authorization', 'unknown', 'wrong_amount', (st) => legs(st, null)],
  ['transfer', 'failed', 'transfer_leg_failed', () => legs('executed', 'failed')],
  ['transfer', 'not_reached', 'wrong_amount', () => legs('failed', 'not_reached')],
  ['transfer', 'unknown', 'facilitator_timeout', () => legs('unknown', 'unknown')],
];
for (const [leg, status, reason, mk] of L6_CASES) {
  test(`lines 618-627: ${leg} ${status} lists its settlement values and rejects the rest with settlement_contradicts_leg`, () => {
    for (const s of SETTLEMENTS) {
      const l = mk(status);
      const a = l.authorization?.status;
      const t = l.transfer?.status;
      const allowed =
        (!a || L6.authorization[a].includes(s)) && (!t || L6.transfer[t].includes(s));
      const r = row({ reason, settlement: s, ...finalFor(s), legs: l });
      if (allowed) accepts(r);
      else rejects(r, 'settlement_contradicts_leg');
    }
  });
}

test('lines 629-632: settled appears only beside executed', () => {
  for (const [reason, l] of [
    ['wrong_amount', legs('failed')],
    ['wrong_amount', legs('unknown')],
    ['risk_policy_rejected', legs('not_reached')],
    ['transfer_leg_failed', legs('executed', 'failed')],
    ['facilitator_timeout', legs('unknown', 'unknown')],
  ]) {
    rejects(row({ reason, settlement: 'settled', legs: l }), 'settlement_contradicts_leg');
  }
  accepts(row({ reason: 'internal_error', settlement: 'settled', legs: legs('executed') }));
});

test('lines 644-648: internal_error with authorization executed, transfer not_reached, not_submitted is constructible', () => {
  accepts(row({ reason: 'internal_error', settlement: 'not_submitted', legs: legs('executed', 'not_reached') }));
});

test('lines 613-616: a permit that landed with a transferFrom never sent, and a reverted transferFrom, both record not_submitted', () => {
  accepts(row({ reason: 'internal_error', settlement: 'not_submitted', legs: legs('executed', 'not_reached') }));
  accepts(row({ reason: 'transfer_leg_failed', settlement: 'not_submitted', legs: legs('executed', 'failed') }));
});

test('lines 97, 507-516: the recorded legs are returned as recorded', () => {
  const out = evaluate(row({ reason: 'transfer_leg_failed', legs: legs('executed', 'failed') }));
  assert.deepEqual(out.fields.legs, { authorization: { status: 'executed' }, transfer: { status: 'failed' } });
  assert.equal(out.fields.reason, 'transfer_leg_failed');
  assert.equal(typeof out.fields.reason_detail, 'string');
  assert.ok(out.fields.reason_detail.length > 0);
});
