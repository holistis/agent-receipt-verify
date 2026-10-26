# How we check a rule before we propose it

Written on 26 October 2026, after a reviewer showed that a rule we had pinned in our vectors treated two requests as the same although every library we then measured tells them apart (see ERRATA.md in bug-bounty-intelligence-mcp). We had copied the equivalence from the specification text and tested our code against the text, not the text against the world.

Before we propose a rule, publish a vector set or say that two things are the same:

1. List the equivalences. Every place where the rule says that A and B are the same attempt, the same identity or the same request.
2. For each one, find out who can tell A and B apart, with real consumers and not by reading the text: run the libraries, frameworks or services that would receive them. Write the basis next to the vector in its `equivalence_basis` field, a standard or a measurement. The test in `test/attempt-identity.mjs` fails when a vector asserts an equivalence without one.
3. Write the negative control: a vector in which a consumer that can tell A and B apart gets different identities.
4. Let a reader who did not write the rule try to break it before it goes out, and keep the report. An objection from outside that we could have found ourselves is a failure of this step.
5. Say who outside us has checked it. Until someone has, the text says nobody else has. Our own checks, including checks by AI reviewers or by a second implementation we wrote, are never called independent.
6. When a correction comes, add it to ERRATA.md the same day, with how it was found.
