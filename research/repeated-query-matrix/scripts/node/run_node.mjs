// Usage: node run_node.mjs <pkgs-node-dir> <out.json>
// Measures how Node libraries/frameworks expose repeated query keys and cross-name order.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import querystring from 'node:querystring';

const PK = process.argv[2];
const OUT = process.argv[3];
const req = createRequire(PK + '/package.json');
const ver = (n) => JSON.parse(fs.readFileSync(`${PK}/node_modules/${n}/package.json`, 'utf8')).version;

const REP = { ab: 'q=a&q=b', ba: 'q=b&q=a' };
const CROSS = { ab: 'a=1&b=2', ba: 'b=2&a=1' };

const records = [];
function rec(lib, version, transport, single_accessor, all_accessor, fn) {
  return { lib, version, transport, single_accessor, all_accessor, fn };
}

// fn(queryString) -> {single, all, keys} (sync or async)
const libs = [];

libs.push(rec('Node URLSearchParams', process.version, 'in-process', '.get("q")', '.getAll("q")', (qs) => {
  const p = new URLSearchParams(qs);
  return { single: p.get('q'), all: p.getAll('q'), keys: [...p.keys()] };
}));
libs.push(rec('Node URL.searchParams -> Object.fromEntries (idiom)', process.version, 'in-process', 'Object.fromEntries(sp).q', 'n/a (no list)', (qs) => {
  const o = Object.fromEntries(new URL('http://h/?' + qs).searchParams);
  return { single: o.q, all: 'n/a', keys: Object.keys(o) };
}));
libs.push(rec('Node querystring.parse', process.version, 'in-process', '.q (raw property)', 'same property (array when repeated)', (qs) => {
  const o = querystring.parse(qs);
  return { single: o.q, all: 'same-as-single', keys: Object.keys(o) };
}));
libs.push(rec('qs (qs.parse)', ver('qs'), 'in-process', '.q (raw property)', 'same property (array when repeated)', (qs) => {
  const o = req('qs').parse(qs);
  return { single: o.q, all: 'same-as-single', keys: Object.keys(o) };
}));

// ---- real HTTP servers ----
function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { resolve({ error: 'non-json', status: res.statusCode, body: b.slice(0, 200) }); }
      });
    }).on('error', reject);
  });
}

async function mkExpress(label, setting) {
  const express = req('express');
  const app = express();
  if (setting) app.set('query parser', setting);
  app.get('/', (rq, rs) => {
    const q = rq.query;
    rs.json({ single: q.q === undefined ? null : q.q, all: 'same-as-single', keys: Object.keys(q), ctor: q.q === undefined ? null : (Array.isArray(q.q) ? 'array' : typeof q.q) });
  });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { name: label, version: ver('express'), port: srv.address().port, close: () => srv.close() };
}

async function mkFastify() {
  const fastify = req('fastify')();
  fastify.get('/', async (rq) => {
    const q = rq.query;
    return { single: q.q === undefined ? null : q.q, all: 'same-as-single', keys: Object.keys(q) };
  });
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  return { version: ver('fastify'), port: fastify.server.address().port, close: () => fastify.close() };
}

async function mkKoa() {
  const Koa = req('koa');
  const app = new Koa();
  app.use((ctx) => {
    const q = ctx.query;
    ctx.body = { single: q.q === undefined ? null : q.q, all: 'same-as-single', keys: Object.keys(q) };
  });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { version: ver('koa'), port: srv.address().port, close: () => srv.close() };
}

async function mkHono() {
  const { Hono } = req('hono');
  const { serve } = req('@hono/node-server');
  const app = new Hono();
  app.get('/', (c) => {
    const all = c.req.queries('q');
    return c.json({ single: c.req.query('q') ?? null, all: all ?? null, keys: Object.keys(c.req.query()) });
  });
  const srv = await new Promise((r) => { const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r(s)); });
  return { version: ver('hono'), port: srv.address().port, close: () => srv.close() };
}

const servers = [];
const ex1 = await mkExpress('default', null);
servers.push(ex1);
libs.push(rec(`Express ${ex1.version} default parser (req.query)`, ex1.version, 'real-http', 'req.query.q (raw property)', 'same property (array when repeated)', ex1.port));
const ex2 = await mkExpress('extended', 'extended');
servers.push(ex2);
libs.push(rec(`Express ${ex2.version} "extended" (qs)`, ex2.version, 'real-http', 'req.query.q (raw property)', 'same property (array when repeated)', ex2.port));
const ex3 = await mkExpress('simple', 'simple');
servers.push(ex3);
libs.push(rec(`Express ${ex3.version} "simple" (querystring)`, ex3.version, 'real-http', 'req.query.q (raw property)', 'same property (array when repeated)', ex3.port));
const fa = await mkFastify();
servers.push(fa);
libs.push(rec('Fastify', fa.version, 'real-http', 'request.query.q (raw property)', 'same property (array when repeated)', fa.port));
const ko = await mkKoa();
servers.push(ko);
libs.push(rec('Koa', ko.version, 'real-http', 'ctx.query.q (raw property)', 'same property (array when repeated)', ko.port));
const ho = await mkHono();
servers.push(ho);
libs.push(rec('Hono (node-server)', ho.version, 'real-http', 'c.req.query("q")', 'c.req.queries("q")', ho.port));

const out = [];
for (const L of libs) {
  const call = async (qs) => (typeof L.fn === 'number' ? get(L.fn, '/?' + qs) : L.fn(qs));
  const r = { lib: L.lib, version: L.version, transport: L.transport, single_accessor: L.single_accessor, all_accessor: L.all_accessor, rep: {}, cross: {} };
  for (const k of Object.keys(REP)) r.rep[k] = { qs: '?' + REP[k], ...(await call(REP[k])) };
  for (const k of Object.keys(CROSS)) r.cross[k] = { qs: '?' + CROSS[k], keys: (await call(CROSS[k])).keys };
  out.push(r);
}
for (const s of servers) s.close();
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.map((o) => ({ lib: o.lib, ab: o.rep.ab.single, ba: o.rep.ba.single, allab: o.rep.ab.all, allba: o.rep.ba.all, kab: o.cross.ab.keys, kba: o.cross.ba.keys })), null, 1));
process.exit(0);
