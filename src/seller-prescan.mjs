// Seller pre-scan: a read-only, fully reproducible check of a real x402 seller's
// discovery file (the self-hosted https://origin/.well-known/x402.json manifest proposed
// in x402-foundation/x402#2582), plus a simple, fully-readable grade on top of the raw
// signals. No payment is ever made: resource reachability is checked with a GET/HEAD
// request and a 402 response counts as "reachable" (it proves the resource speaks x402),
// not as a failure.
//
// Scope, stated plainly: this answers "does this seller's discovery surface actually
// work right now", not "does the paid response match what was promised" (that needs a
// real payment, a different, costlier check we are not doing here -- see README).

export function parseDiscoveryFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, reden: 'geen geldige JSON: ' + e.message };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, reden: 'geen JSON-object' };
  // De spec-discussie (x402#2582) noemt zowel "items" als "resources" als mogelijke sleutel
  // (nog niet geratificeerd); accepteer beide, dat is geen eigen aanname maar precies de
  // onzekerheid die het voorstel zelf benoemt.
  const lijst = data.resources ?? data.items;
  if (!Array.isArray(lijst)) return { ok: false, reden: 'geen "resources"- of "items"-lijst gevonden' };
  if (lijst.length === 0) return { ok: false, reden: 'lege resource-lijst' };
  const resources = [];
  for (const r of lijst) {
    // Dezelfde onzekerheid als de array-sleutel (x402#2582 noemt "items vs resources" als
    // open vraag): in de praktijk gezien zowel een "url"-veld als een "resource"-veld per
    // item (elon00/solana-ai gebruikt "resource"). Accepteer beide, geen eigen aanname.
    const echteUrl = typeof r?.url === 'string' && r.url ? r.url : (typeof r?.resource === 'string' && r.resource ? r.resource : null);
    if (!r || typeof r !== 'object' || !echteUrl) continue;
    resources.push({ url: echteUrl, method: typeof r.method === 'string' ? r.method : 'GET' });
  }
  if (resources.length === 0) return { ok: false, reden: 'geen enkele resource met een geldige url' };
  return { ok: true, x402Version: data.x402Version ?? null, service: data.service ?? null, resources };
}

/**
 * Harde, feitelijke signalen -> één label. Drie onderdelen, elk een percentage van 0-1:
 *   - discoveryBereikbaar: werd het discovery-bestand zelf opgehaald en als geldig JSON gelezen (0 of 1)
 *   - schemaGeldig: had het de verwachte vorm (resources-lijst met url's) (0 of 1)
 *   - endpointsBereikbaarFractie: van de genoemde resources, welk deel gaf een ECHT antwoord
 *     (elke status-code is prima, inclusief 402 -- dat bewijst juist dat het endpoint leeft en
 *     x402 spreekt; alleen een netwerkfout/timeout/DNS-fout telt als onbereikbaar)
 *
 * Gewicht, met reden: discoveryBereikbaar en schemaGeldig zijn allebei "kan een agent hier
 * überhaupt iets mee" (samen 50%, verdeeld 20/30 omdat een geldig SCHEMA net iets meer zegt
 * dan alleen "er kwam een bestand terug" -- een leeg of onleesbaar bestand dat toevallig 200
 * teruggeeft is net zo nutteloos als geen bestand). endpointsBereikbaarFractie is "doet het
 * ook echt wat het zegt" (50%), want dat is de kern van waar een kopende agent om vraagt.
 */
export function berekenOordeel({ discoveryBereikbaar, schemaGeldig, endpointsBereikbaarFractie }) {
  if (!discoveryBereikbaar) {
    return { score: 0, label: 'VERMIJD', reden: 'discovery-bestand niet bereikbaar of geen geldige JSON' };
  }
  const score = 0.2 * 1 + 0.3 * (schemaGeldig ? 1 : 0) + 0.5 * endpointsBereikbaarFractie;
  let label;
  if (!schemaGeldig) label = 'VERMIJD';
  else if (score >= 0.85) label = 'OK';
  else if (score >= 0.5) label = 'LET-OP';
  else label = 'VERMIJD';
  return { score: Math.round(score * 100) / 100, label, reden: null };
}

export async function haalDiscoveryOp(origin, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const url = origin.replace(/\/$/, '') + '/.well-known/x402.json';
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) return { bereikbaar: false, status: res.status, url };
    const text = await res.text();
    return { bereikbaar: true, status: res.status, url, text };
  } catch (e) {
    return { bereikbaar: false, status: null, url, fout: String(e.message || e).slice(0, 120) };
  }
}

/** Eén resource-URL: elk antwoord (ook 402/404/500) telt als "bereikbaar"; alleen een
 * netwerk-/DNS-/timeout-fout telt als onbereikbaar. Nooit een lichaam lezen of iets posten. */
export async function checkResourceBereikbaar(resource, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  try {
    const res = await fetchImpl(resource.url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    return { url: resource.url, bereikbaar: true, status: res.status };
  } catch (e) {
    return { url: resource.url, bereikbaar: false, status: null, fout: String(e.message || e).slice(0, 120) };
  }
}

export async function scanVerkoper(origin, deps = {}) {
  const discovery = await haalDiscoveryOp(origin, deps);
  if (!discovery.bereikbaar) {
    const oordeel = berekenOordeel({ discoveryBereikbaar: false, schemaGeldig: false, endpointsBereikbaarFractie: 0 });
    return { origin, discovery: { bereikbaar: false, status: discovery.status, fout: discovery.fout }, resources: [], oordeel };
  }
  const parsed = parseDiscoveryFile(discovery.text);
  if (!parsed.ok) {
    const oordeel = berekenOordeel({ discoveryBereikbaar: true, schemaGeldig: false, endpointsBereikbaarFractie: 0 });
    return { origin, discovery: { bereikbaar: true, status: discovery.status, parseReden: parsed.reden }, resources: [], oordeel };
  }
  const uitkomsten = [];
  for (const r of parsed.resources) uitkomsten.push(await checkResourceBereikbaar(r, deps));
  const fractie = uitkomsten.filter((u) => u.bereikbaar).length / uitkomsten.length;
  const oordeel = berekenOordeel({ discoveryBereikbaar: true, schemaGeldig: true, endpointsBereikbaarFractie: fractie });
  return {
    origin,
    discovery: { bereikbaar: true, status: discovery.status, x402Version: parsed.x402Version, service: parsed.service },
    resources: uitkomsten,
    oordeel,
  };
}
