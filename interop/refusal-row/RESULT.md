Cite as: github.com/holistis/agent-receipt-verify, interop/refusal-row, 2026-11-23.

# Refusal row, section 15: an implementation written from the text alone, run against 76 vector files

This is a result file. It says "ran against". It does not say verified, certified or conformant, and nothing here was checked by the author of the vectors.

## What was run, registered before the run

- The specification: specs/extensions/refusal-row.md at commit d9552b8 of github.com/ruiruii/sycee, sha256 f0b9d8e54e04b915e6d0faaa73401bd1acd2cfbc10595840bff76eb5edc64acf.
- The vectors: conformance/refusal/vectors at the same commit, 76 files (46 ACCEPT, 30 REJECT). The manifest hash is sha256 over the sorted lines of file hash and file name. In the form that Linux writes (two spaces between hash and name) it is b7309cc84c1b866bcc1997a758cbd41e5616bb2e58171d9de0070015e5e0aca8. The value registered in the Slack message was 61cd79f65033d7a9564706f050ee5b93ead75565da6a8739ad4641f216d94aaa, which comes from the form that sha256sum writes on Windows (a star before the name). It is the same 76 files; the registered value named the wrong line form and was not marked as such.
- The implementation: interop/refusal-row/refusal-row.mjs, commit 3c0abc6e5aa3f0cefbdd2caa00e7591e04d147d2 of branch interop-refusal-row, sha256 def9ffa708a9d542d5047efdc2aa1a8385898156d995611bc1b8c89088eff912. The runner refuses to run any other file.
- The list of places where the text does not decide, written before any vector was run: interop/refusal-row/AMBIGUITIES.md, sha256 633d831f019f5a852a1bd4cec0a31ecedbabe89316d6ea78f0b23b232131c45f, 25 entries.
- The runner: interop/refusal-row/run-vectors.mjs, sha256 3dd21f7ade37c8c71d7bbe1976bfa44df9e1ca58b7562c352b56d2403d00a3d4. Earlier versions of the runner gave the same outcome, code and field numbers as below; only the twin numbers changed, with the correction in point 5 of the exploratory section.

## What this does not show

- The implementation was written by an implementer who saw only the specification file. His own log says that his session had project instruction files attached and that he did not open them; that log is a self-report and not proof.
- The person who ran the comparison had read the README of the conformance folder, the head of judge.mjs and one vector file before the implementation was written. The interface of the function (the names of its input fields) was taken from the field names of the vector files, without any values or cases.
- It is independent of the code of github.com/ruiruii/sycee. It is not independent of our own tooling.
- The exploratory run below was decided after the vectors had been seen.
- None of her code was executed. Her result file had not been read when this one was frozen.

## Result of the primary run (the registered implementation, the vectors as they are)

| outcome equal | reject code equal | accepted fields equal | twin checks | divergences |
|---|---|---|---|---|
| 42 of 76 | 3 of 30 | 11 of 18 | 11 of 69 | 68 |

Divergences by kind: {"field evidence_class":2,"field final":5,"outcome":34,"code":27}. The 34 outcome divergences are all the same: the implementation rejects with malformed_legs where the vector accepts. The vectors write a leg as a plain string (for example "authorization": "executed"); the implementation reads the text of lines 97 and 509 as an object with a status. This is ambiguity A18, written down before the run.

## Result of the exploratory run (legs written as { status }, decided after seeing the vectors)

| outcome equal | reject code equal | accepted fields equal | twin checks | divergences |
|---|---|---|---|---|
| 76 of 76 | 23 of 30 | 46 of 69 | 46 of 69 | 30 |

Divergences by kind: {"field evidence_class":2,"field final":21,"code":7}. With the shape of a leg aligned, all 76 outcomes agree. What remains:

1. Five rejection codes have another name, in seven files. The text names 6 codes and the implementer had to invent the others (ambiguities A6 and A7). The pairs, recorded name then our name, with the number of files:
   - bad_decision | unknown_decision (1)
   - bad_settlement | unknown_settlement (1)
   - finality_pending_is_not_final | pending_must_not_be_final (2)
   - not_reproducible | evidence_not_reproducible (1)
   - unreviewed_reason | unknown_reason (2)
2. The field final: the vectors record true on an accepted row and the implementation computes false. The text does not say what final is when the input leaves it out (A5). 21 files.
3. The field evidence_class on an accepted row: the vectors record null and the implementation leaves the field out (A12). 2 files.
4. The twin checks (a wrong file must compute the value that its right twin records): 46 of 69 hold. The failures by field: {"evidence_class":2,"final":21}. They follow from points 2 and 3.
5. A correction to the runner, made before this file was frozen: its first version demanded a difference from the wrong twin on every field, including fields where both twins record the same value, which can never hold. It was changed to demand the difference only where the two twins differ. The numbers above are from the corrected runner; the outcome, code and field numbers did not change.

## Files

- result-primary.json, sha256 16147dc6ee0e2b83159aedefbf5b8032813a8b547018533f9e171dce2f92f163
- result-exploratory.json, sha256 24e49d3d17b1821cca833dc320b0bf3cdd3961792ee4d66eea58603783a4be36
- Every divergence with the recorded value and our value is in those two files.
