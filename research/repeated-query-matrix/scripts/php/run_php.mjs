// Usage: node run_php.mjs <www-dir> <out.json>
// Starts a real `php -S` server and sends real HTTP requests.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
const [WWW, OUT] = process.argv.slice(2);
const PORT = 18000 + Math.floor(Math.random() * 1000);
const proc = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', WWW], { stdio: 'ignore' });
const get = (qs) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: '/probe.php?' + qs, agent: false }, (r) => {
    let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res({ error: b.slice(0, 200) }); } });
  }).on('error', rej);
});
for (let i = 0; i < 50; i++) { try { await get('x=1'); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const REP = { ab: 'q=a&q=b', ba: 'q=b&q=a' };
const CROSS = { ab: 'a=1&b=2', ba: 'b=2&a=1' };
const BR = { ab: 'q[]=a&q[]=b', ba: 'q[]=b&q[]=a' };
const row = { lib: 'PHP $_GET (php -S)', version: '', transport: 'real-http', single_accessor: "$_GET['q']", all_accessor: 'none for plain repeated names (only q[] syntax makes a list)', rep: {}, cross: {}, extra: { bracket_syntax: {} } };
for (const k of Object.keys(REP)) { const o = await get(REP[k]); row.version = 'PHP ' + o.php; row.rep[k] = { qs: '?' + REP[k], single: o.single, all: 'n/a', parse_str_q: o.parse_str_q, request_q: o.request_q }; }
for (const k of Object.keys(CROSS)) { const o = await get(CROSS[k]); row.cross[k] = { qs: '?' + CROSS[k], keys: o.keys }; }
for (const k of Object.keys(BR)) { const o = await get(BR[k]); row.extra.bracket_syntax[k] = { qs: '?' + BR[k], q: o.single }; }
fs.writeFileSync(OUT, JSON.stringify([row], null, 2));
console.log(JSON.stringify(row));
proc.kill();
process.exit(0);
