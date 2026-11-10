import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscoveryFile, berekenOordeel, scanVerkoper } from '../src/seller-prescan.mjs';

// --- parseDiscoveryFile: geplante fouten, elk moet FALEN herkennen, niet alleen het goede geval ---
test('parseDiscoveryFile: geldig bestand (echte vorm, resources-sleutel) wordt geaccepteerd', () => {
  const r = parseDiscoveryFile(JSON.stringify({
    x402Version: 2, service: 'demo',
    resources: [{ url: 'https://example.test/api/a', method: 'GET' }],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.resources.length, 1);
});

test('parseDiscoveryFile: "items"-sleutel (het andere, nog niet geratificeerde voorstel) wordt ook geaccepteerd', () => {
  const r = parseDiscoveryFile(JSON.stringify({ items: [{ url: 'https://example.test/x' }] }));
  assert.equal(r.ok, true);
});

test('GEPLANTE FOUT: kapotte JSON wordt geweigerd, niet stil als leeg gelezen', () => {
  const r = parseDiscoveryFile('{ "resources": [');
  assert.equal(r.ok, false);
  assert.match(r.reden, /JSON/);
});

test('GEPLANTE FOUT: geen resources/items-sleutel wordt geweigerd', () => {
  const r = parseDiscoveryFile(JSON.stringify({ x402Version: 2, service: 'leeg' }));
  assert.equal(r.ok, false);
});

test('GEPLANTE FOUT: lege resource-lijst wordt geweigerd, niet als "0 dus prima" gelezen', () => {
  const r = parseDiscoveryFile(JSON.stringify({ resources: [] }));
  assert.equal(r.ok, false);
  assert.match(r.reden, /lege/);
});

test('GEPLANTE FOUT: resources zonder url-veld worden overgeslagen, geen crash', () => {
  const r = parseDiscoveryFile(JSON.stringify({ resources: [{ method: 'GET' }, { url: 'https://example.test/ok' }] }));
  assert.equal(r.ok, true);
  assert.equal(r.resources.length, 1);
});

test('echte vondst (elon00/solana-ai): "resource"-veld in plaats van "url" wordt ook herkend', () => {
  const r = parseDiscoveryFile(JSON.stringify({ items: [{ resource: 'https://example.test/via-resource-veld' }] }));
  assert.equal(r.ok, true);
  assert.equal(r.resources[0].url, 'https://example.test/via-resource-veld');
});

// --- berekenOordeel: dit is de kern, hier moet de geplante-fout-discipline het scherpst zijn ---
test('berekenOordeel: alles goed -> OK', () => {
  const o = berekenOordeel({ discoveryBereikbaar: true, schemaGeldig: true, endpointsBereikbaarFractie: 1 });
  assert.equal(o.label, 'OK');
});

test('GEPLANTE FOUT: discovery onbereikbaar moet ALTIJD VERMIJD geven, ook als de rest toevallig "goed" zou lijken', () => {
  const o = berekenOordeel({ discoveryBereikbaar: false, schemaGeldig: true, endpointsBereikbaarFractie: 1 });
  assert.equal(o.label, 'VERMIJD');
  assert.match(o.reden, /niet bereikbaar/);
});

test('GEPLANTE FOUT: geldig bestand maar GEEN geldig schema moet VERMIJD geven, niet OK', () => {
  const o = berekenOordeel({ discoveryBereikbaar: true, schemaGeldig: false, endpointsBereikbaarFractie: 1 });
  assert.equal(o.label, 'VERMIJD');
});

test('GEPLANTE FOUT: schema geldig maar nul bereikbare endpoints moet LET-OP of VERMIJD geven, nooit OK', () => {
  const o = berekenOordeel({ discoveryBereikbaar: true, schemaGeldig: true, endpointsBereikbaarFractie: 0 });
  assert.notEqual(o.label, 'OK');
});

test('grenswaarde: precies op 0.85 is nog OK, net onder is LET-OP (geen off-by-one)', () => {
  const opGrens = berekenOordeel({ discoveryBereikbaar: true, schemaGeldig: true, endpointsBereikbaarFractie: (0.85 - 0.5) / 0.5 });
  assert.equal(opGrens.label, 'OK');
  const onderGrens = berekenOordeel({ discoveryBereikbaar: true, schemaGeldig: true, endpointsBereikbaarFractie: (0.84 - 0.5) / 0.5 });
  assert.equal(onderGrens.label, 'LET-OP');
});

// --- scanVerkoper: end-to-end met een neppe, gecontroleerde fetch (geen echt netwerkverkeer) ---
function nepFetch(routes) {
  return async (url) => {
    const r = routes[url];
    if (!r) throw new Error('nep-DNS-fout: ' + url);
    if (r.netwerkfout) throw new Error('nep-netwerkfout');
    return { status: r.status, text: async () => r.body ?? '' };
  };
}

test('scanVerkoper: een nette nep-verkoper (geldig bestand, alle endpoints antwoorden) krijgt OK', async () => {
  const origin = 'https://nette-verkoper.test';
  const body = JSON.stringify({ x402Version: 2, resources: [{ url: origin + '/api/a' }, { url: origin + '/api/b' }] });
  const fetchImpl = nepFetch({
    [origin + '/.well-known/x402.json']: { status: 200, body },
    [origin + '/api/a']: { status: 402 }, // 402 telt als bereikbaar: hij spreekt x402
    [origin + '/api/b']: { status: 200 },
  });
  const r = await scanVerkoper(origin, { fetchImpl });
  assert.equal(r.oordeel.label, 'OK');
  assert.equal(r.resources.length, 2);
});

test('GEPLANTE FOUT: een kapotte nep-verkoper (discovery geeft 404) krijgt VERMIJD, nooit een hoog cijfer', async () => {
  const origin = 'https://kapotte-verkoper.test';
  const fetchImpl = nepFetch({ [origin + '/.well-known/x402.json']: { status: 404 } });
  const r = await scanVerkoper(origin, { fetchImpl });
  assert.equal(r.oordeel.label, 'VERMIJD');
  assert.equal(r.discovery.bereikbaar, false);
});

test('GEPLANTE FOUT: discovery-bestand bereikbaar maar kapotte JSON krijgt VERMIJD, niet een halve score', async () => {
  const origin = 'https://kapotte-json.test';
  const fetchImpl = nepFetch({ [origin + '/.well-known/x402.json']: { status: 200, body: '{ niet geldig' } });
  const r = await scanVerkoper(origin, { fetchImpl });
  assert.equal(r.oordeel.label, 'VERMIJD');
});

test('GEPLANTE FOUT: geldig bestand maar alle endpoints geven een netwerkfout krijgt geen OK', async () => {
  const origin = 'https://dode-endpoints.test';
  const body = JSON.stringify({ resources: [{ url: origin + '/api/a' }] });
  const fetchImpl = nepFetch({
    [origin + '/.well-known/x402.json']: { status: 200, body },
    [origin + '/api/a']: { netwerkfout: true },
  });
  const r = await scanVerkoper(origin, { fetchImpl });
  assert.notEqual(r.oordeel.label, 'OK');
  assert.equal(r.resources[0].bereikbaar, false);
});

console.log('Alle seller-prescan-tests geslaagd (node --test registreerde geen enkele FAIL hierboven).');
