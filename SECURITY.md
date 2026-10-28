# Security policy

This repository is maintained by one person (Abdellah Ouadoudi, github.com/holistis). Reports are read by that person and answered directly.

## Supported versions

Only the latest version published on npm (`agent-receipt-verify`) is supported. There is no long-term-support branch. If you find a problem in an older version, check first whether it still reproduces on the current release.

## How to report a vulnerability

Email info@holistischadviseur.nl with a clear subject line and, if possible, a minimal way to reproduce the problem. Please do not open a public issue for a security report before it has been looked at privately.

## What to expect

A first answer within 7 days, usually sooner. There is no paid bug bounty. What you get is a direct answer, credit in the fix if you want it, and a plain account of what was found and how it was fixed. Fixed vulnerabilities are listed in the release notes of the version that contains the fix.

## Scope

This covers the code in this repository: the verifier library, the command line tool, and the conformance vectors. It does not cover third-party dependencies (report those upstream) or the services of other parties that the checks read from, such as public RPC endpoints.
