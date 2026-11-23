// Refusal row validator and constructor.
//
// Built from the text of the refusal row specification: section 4 (row structure),
// section 5 (the closed reason set), section 6 (verification) and section 15
// (split-leg authorization). Where the text does not decide, the choice taken is
// recorded in AMBIGUITIES.md next to this file, and every such place is marked
// here with an "A<number>" tag that matches an entry in that file.
//
// evaluate(input) is pure. It returns
//   { outcome: 'ACCEPT', fields: {...} }   the values an accepted row records or computes
//   { outcome: 'REJECT', code: '<code>' }  the name of the rejection
//
// Codes that the text names: settlement_contradicts_reason, leg_contradicts_reason,
// leg_not_observed, unknown_leg_status, unknown_leg, settlement_contradicts_leg.
// Every other code below is invented and listed in AMBIGUITIES.md.

import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = 'sycee/refusal/v0.1';

const DECISIONS = ['accepted', 'refused'];
const SETTLEMENTS = ['not_submitted', 'pending', 'settled', 'unknown'];
// A11: the text lists the classes in this order and never states a ranking.
const EVIDENCE_CLASSES = [
  'issuer_asserted',
  'client_verifiable',
  'chain_verifiable',
  'independently_witnessed',
];
const LEG_NAMES = ['authorization', 'transfer'];
const LEG_STATUSES = ['not_reached', 'executed', 'failed', 'unknown'];

// Section 15.4 marks: a bare list is required, a bracketed list is bounded optional.
const req = (...allowed) => ({ required: true, allowed });
const opt = (...allowed) => ({ required: false, allowed });

// Section 5 table (ceiling, meaning) joined with the section 15.4 leg table.
// A8: the "fixed sentence" for reason_detail is not given; the Meaning column is used,
// without its trailing cross references.
// A9: transfer_leg_failed keeps the section 15.3 base ceiling here, and
// reproducibleCeiling() takes it down to issuer_asserted (section 15.5).
const REASONS = {
  invalid_signature: {
    ceiling: 'client_verifiable',
    detail: "the payload's authorization signature does not verify",
    legs: { authorization: req('failed', 'unknown'), transfer: opt('not_reached') },
  },
  wrong_amount: {
    ceiling: 'client_verifiable',
    detail: 'authorized amount ≠ price',
    legs: { authorization: req('failed', 'unknown'), transfer: opt('not_reached') },
  },
  wrong_recipient: {
    ceiling: 'client_verifiable',
    detail: 'authorized recipient ≠ this merchant',
    legs: { authorization: req('failed', 'unknown'), transfer: opt('not_reached') },
  },
  malformed_payload: {
    ceiling: 'client_verifiable',
    detail: 'the payload could not be decoded',
    legs: { authorization: req('failed', 'unknown', 'not_reached'), transfer: opt('not_reached') },
  },
  authorization_expired: {
    ceiling: 'chain_verifiable',
    detail: 'the authorization window has closed',
    legs: { authorization: req('failed', 'unknown'), transfer: opt('not_reached') },
  },
  authorization_not_yet_valid: {
    ceiling: 'chain_verifiable',
    detail: 'the window has not opened',
    legs: { authorization: req('failed', 'unknown'), transfer: opt('not_reached') },
  },
  insufficient_funds: {
    ceiling: 'issuer_asserted',
    detail: 'balance does not cover the authorized amount',
    legs: { authorization: req('failed', 'unknown'), transfer: opt('not_reached') },
  },
  duplicate_payment: {
    ceiling: 'chain_verifiable',
    detail: 'the proof was already settled',
    legs: { authorization: req('executed'), transfer: opt('not_reached') },
  },
  nonce_already_used: {
    ceiling: 'chain_verifiable',
    detail: 'the authorization nonce is consumed',
    legs: { authorization: req('failed', 'executed'), transfer: opt('not_reached', 'failed') },
  },
  transfer_leg_failed: {
    ceiling: 'chain_verifiable',
    detail: 'the authorization leg executed and the transfer leg did not, in the same attempt',
    legs: { authorization: req('executed'), transfer: req('failed') },
  },
  facilitator_timeout: {
    ceiling: 'issuer_asserted',
    detail: 'the facilitator did not answer in budget',
    legs: { authorization: req('unknown'), transfer: opt('not_reached', 'unknown') },
  },
  risk_policy_rejected: {
    ceiling: 'issuer_asserted',
    detail: 'declined by an undisclosed policy',
    legs: { authorization: req('not_reached', 'unknown'), transfer: opt('not_reached') },
  },
  commercial_refusal: {
    ceiling: 'issuer_asserted',
    detail: 'declined on business grounds, no technical cause',
    legs: { authorization: req('not_reached', 'unknown'), transfer: opt('not_reached') },
  },
  internal_error: {
    ceiling: 'issuer_asserted',
    detail: 'the seller failed and is not claiming a cause',
    legs: { authorization: req('executed', 'unknown'), transfer: opt('not_reached', 'unknown') },
  },
  replay_already_settled: {
    ceiling: 'issuer_asserted',
    detail: 'a prior presentation of this proof settled',
    legs: { authorization: req('executed'), transfer: opt('not_reached') },
  },
  replay_in_flight: {
    ceiling: 'issuer_asserted',
    detail: 'a prior presentation is unresolved',
    legs: { authorization: opt('not_reached', 'unknown'), transfer: opt('not_reached', 'unknown') },
  },
  could_not_compare: {
    ceiling: 'issuer_asserted',
    detail: 'a prior row exists, its settlement state was unreadable',
    legs: { authorization: opt('not_reached', 'unknown'), transfer: opt('not_reached', 'unknown') },
  },
};

// Section 5, the three repeat reasons: the settlement state each one claims.
const REPEAT_SETTLEMENT = {
  replay_already_settled: 'settled',
  replay_in_flight: 'pending',
  could_not_compare: 'unknown',
};

// Section 15.4 L6: settlement values each (leg, status) pair lists.
const LEG_SETTLEMENT = {
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

// Section 15.5: a reason may claim a class only if every leg whose execution it depends
// on carries a marker a third party can attribute to one attempt. The text names one
// reason that fails this rule (A10).
const DEPENDS_ON_UNATTRIBUTED_LEG = new Set(['transfer_leg_failed']);

const rank = (cls) => EVIDENCE_CLASSES.indexOf(cls);
const has = (list, v) => typeof v === 'string' && list.includes(v);
const isPlain = (v) => Object.prototype.toString.call(v) === '[object Object]';
const reject = (code) => ({ outcome: 'REJECT', code });

export function baseCeiling(reason) {
  return Object.hasOwn(REASONS, reason) ? REASONS[reason].ceiling : undefined;
}

// The class a refused row gets when it omits evidence_class (sections 5 and 15.7).
export function reproducibleCeiling(reason) {
  if (!Object.hasOwn(REASONS, reason)) return undefined;
  return DEPENDS_ON_UNATTRIBUTED_LEG.has(reason) ? 'issuer_asserted' : REASONS[reason].ceiling;
}

// Section 15.4: check one legs object against a known reason and a settlement value.
// Order inside this function is an A17 choice.
function checkLegs(legs, reason, settlement) {
  if (!isPlain(legs)) return 'malformed_legs'; // A18
  const names = Object.keys(legs);
  if (names.some((n) => !LEG_NAMES.includes(n))) return 'unknown_leg'; // L3
  const status = {};
  for (const name of LEG_NAMES) {
    if (!Object.hasOwn(legs, name)) continue;
    const entry = legs[name];
    if (!isPlain(entry)) return 'malformed_legs'; // A18
    if (Object.keys(entry).some((k) => k !== 'status')) return 'malformed_legs'; // A18
    if (!has(LEG_STATUSES, entry.status)) return 'unknown_leg_status'; // L3, A18
    status[name] = entry.status;
  }
  const table = REASONS[reason].legs;
  for (const name of LEG_NAMES) {
    if (table[name].required && status[name] === undefined) return 'leg_not_observed'; // L2
  }
  for (const name of LEG_NAMES) {
    if (status[name] !== undefined && !table[name].allowed.includes(status[name])) {
      return 'leg_contradicts_reason'; // L2
    }
  }
  // L4: a transfer that was submitted follows an authorization that completed or is unknown.
  if (
    status.transfer !== undefined &&
    status.transfer !== 'not_reached' &&
    (status.authorization === 'not_reached' || status.authorization === 'failed')
  ) {
    return 'leg_contradicts_reason'; // A19
  }
  // L6: every recorded leg must list the settlement (A25).
  for (const name of LEG_NAMES) {
    if (status[name] !== undefined && !LEG_SETTLEMENT[name][status[name]].includes(settlement)) {
      return 'settlement_contradicts_leg';
    }
  }
  return null;
}

export function evaluate(input) {
  if (!isPlain(input)) return reject('malformed_input');

  const { signing_public_key, attempt_identity, decision, settlement, reason, legs, evidence_class, final } = input;

  // Section 4 row table. A3, A4.
  if (typeof signing_public_key !== 'string' || !/^ed25519:[A-Za-z0-9_-]+$/.test(signing_public_key)) {
    return reject('invalid_signing_public_key');
  }
  if (typeof attempt_identity !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(attempt_identity)) {
    return reject('invalid_attempt_identity');
  }
  if (!has(DECISIONS, decision)) return reject('unknown_decision'); // section 6.1
  if (!has(SETTLEMENTS, settlement)) return reject('unknown_settlement'); // section 6.4

  // A5: `final` is required by the row table but optional in this interface.
  if (final !== undefined && typeof final !== 'boolean') return reject('final_invalid');
  if (settlement === 'pending' && final === true) return reject('pending_must_not_be_final');
  const finalValue = final === true;

  const common = {
    schema_version: SCHEMA_VERSION,
    decision,
  };
  const tail = {
    attempt_identity,
    settlement,
    final: finalValue,
    signer: { public_key: signing_public_key },
    key_check: 'not_measured', // no payee is supplied, so nothing was measured (A2)
  };

  if (decision === 'accepted') {
    // A12: reason, reason_detail, evidence_class are "when refused"; legs are never recorded on an accepted row.
    if (reason !== undefined || evidence_class !== undefined || legs !== undefined) {
      return reject('refused_field_on_accepted_row');
    }
    return { outcome: 'ACCEPT', fields: { ...common, ...tail } };
  }

  // Refused rows. Section 6.2, and L5: an unknown reason fails before any leg is read (A17).
  if (reason === undefined) return reject('missing_reason');
  if (typeof reason !== 'string' || !Object.hasOwn(REASONS, reason)) return reject('unknown_reason');

  // Section 6.3 and 15.5.
  const reproducible = reproducibleCeiling(reason);
  let evidence = reproducible; // section 15.7: the default is the reproducible ceiling
  if (evidence_class !== undefined) {
    if (!has(EVIDENCE_CLASSES, evidence_class)) return reject('unknown_evidence_class');
    if (rank(evidence_class) > rank(REASONS[reason].ceiling)) return reject('evidence_exceeds_ceiling');
    if (rank(evidence_class) > rank(reproducible)) return reject('evidence_not_reproducible');
    evidence = evidence_class;
  }

  // Section 6.4 with section 15.4.
  if (legs !== undefined) {
    const failure = checkLegs(legs, reason, settlement);
    if (failure) return reject(failure);
  }

  // Section 5 / 6.5: the three repeat reasons.
  if (Object.hasOwn(REPEAT_SETTLEMENT, reason) && REPEAT_SETTLEMENT[reason] !== settlement) {
    return reject('settlement_contradicts_reason');
  }

  const fields = {
    ...common,
    reason,
    reason_detail: REASONS[reason].detail,
    evidence_class: evidence,
    ...tail,
  };
  if (legs !== undefined) {
    const recorded = {};
    for (const name of LEG_NAMES) {
      if (Object.hasOwn(legs, name)) recorded[name] = { status: legs[name].status };
    }
    fields.legs = recorded;
  }
  return { outcome: 'ACCEPT', fields };
}

// Section 4 recipe for attempt_identity. A24: payload and requirements are hashed as
// presented (strings as UTF-8), each digest enters the object in its sha256:<hex> form,
// the object is serialised with sorted keys, and n is the 1-based presentation ordinal.
const sha256 = (data) => 'sha256:' + createHash('sha256').update(data).digest('hex');

export function deriveAttemptIdentity(payload, requirements, n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('presentation ordinal is 1-based');
  const body = {
    payload: sha256(payload),
    presentation: String(n),
    requirements: sha256(requirements),
    spec: SCHEMA_VERSION,
  };
  const canonical =
    '{' +
    Object.keys(body)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + JSON.stringify(body[k]))
      .join(',') +
    '}';
  return sha256(canonical);
}
