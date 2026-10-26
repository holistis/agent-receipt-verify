# Repeated query parameters: what real libraries do

Question: do `?q=a&q=b` and `?q=b&q=a` mean the same thing to a server? A canonicalization that sorts repeated values (the query rule of section 5.5 of the x402 specification at pull request 3776, commit 8494922) says yes. This folder measures what libraries and frameworks do with them.

Measured on 26 October 2026, on one Windows machine, with Node 24.14.1, Python 3.12.10 in a virtual environment, Go 1.27.0 and PHP 8.3.33. Frameworks were run as real servers on the loopback interface and queried over HTTP, parsers were called in process. Ruby/Rack was not run because Ruby is not installed here.

## Result

Every row differs. In `results/` and `RESULT-TABLES.txt`:

- single-value accessor: the two requests give a different value in 24 of 24 rows that have one (18 of 18 libraries and frameworks);
- list accessor: the two requests give a different list in 23 of 23 rows that have one (18 of 18);
- first value wins in URLSearchParams, Werkzeug/Flask, aiohttp, Hono, Go `net/url` and `net/http`, and Gin; last value wins in Django, Starlette, FastAPI, Tornado, Bottle and PHP `$_GET`; Express, Fastify, Koa, `qs` and `querystring` return the array in arrival order.

No tested library treats the two requests as equal. A handler that reads the first value, the last value or the list can therefore do different work for them.

Cross-name order (`?a=1&b=2` against `?b=2&a=1`): the default key iteration exposes the order of different names in every row except the Go ones (Go's map iteration order is random). Handlers rarely depend on it, but a library does show it.

## Reproduce

Each script takes the folder with its installed packages and an output path, and writes JSON; `scripts/aggregate.mjs <results-dir>` prints the tables.

- Node: `npm install express@5.3.0 fastify@5.12.7 koa@3.2.1 qs@6.16.1 hono@4.13.14 @hono/node-server` in an empty folder, then `node scripts/node/run_node.mjs <that folder> results/node.json`.
- Python: a virtual environment with `flask==3.1.3 werkzeug==3.1.9 starlette==1.10.0 fastapi==0.162.0 django==6.1.2 tornado==6.6 bottle==0.13.4 aiohttp==3.14.5 uvicorn`, then `<venv>/Scripts/python.exe -I scripts/python/run_python.py results/python.json`.
- Go: `go run .` in `scripts/go` (modules in `go.mod`), output to `results/go.json`.
- PHP: `node scripts/php/run_php.mjs scripts/php/www results/php.json` with `php` on the path.

The versions that produced the committed results are in each row of `RESULT-TABLES.txt`.

## Limits

One machine, one day, loopback only. The framework defaults were used, with no custom query parser configured. The measurement shows that the libraries disagree about order, not how often a real handler depends on it.
