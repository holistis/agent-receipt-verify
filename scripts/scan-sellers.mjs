#!/usr/bin/env node
// Vindt echte, publieke x402-verkopers (via GitHub code-search op .well-known/x402.json,
// dezelfde zelf-ontdekkende aanpak als concurrenten in dit veld gebruiken), haalt hun ECHTE
// live discovery-bestand op (niet de GitHub-kopie, het bestand zoals het nu op hun eigen
// domein staat), en scant het read-only: geen betaling, geen account, alleen GET-aanvragen.
//
// Usage: node scripts/scan-sellers.mjs [--max=20]
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { scanVerkoper } from '../src/seller-prescan.mjs';

function sh(cmd) { return execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function vindKandidaatOrigins(max) {
  const raw = sh(`gh api -X GET search/code -f q="filename:x402.json path:.well-known" -f per_page=${Math.min(max * 2, 100)}`);
  const items = JSON.parse(raw).items || [];
  const origins = new Set();
  for (const it of items) {
    if (it.repository.fork) continue;
    // De URL binnen het bestand (echte API-endpoints) wijst naar de echte deploy-plek; het
    // repo zelf heeft vaak geen eigen domein. Haal de content op en leid de origin van de
    // EERSTE resource-url af, dat is de daadwerkelijke, levende plek om te checken.
    try {
      const raw2 = sh(`gh api "repos/${it.repository.full_name}/contents/${it.path}"`);
      const content = Buffer.from(JSON.parse(raw2).content, 'base64').toString('utf8');
      const data = JSON.parse(content);
      const lijst = data.resources ?? data.items ?? [];
      const eersteUrl = lijst.find((r) => typeof r?.url === 'string' || typeof r?.resource === 'string')?.url
        ?? lijst.find((r) => typeof r?.resource === 'string')?.resource;
      if (eersteUrl) origins.add(new URL(eersteUrl).origin);
    } catch { /* onleesbaar bestand of geen geldige url, overslaan */ }
    if (origins.size >= max) break;
  }
  return [...origins];
}

async function main() {
  const max = Number((process.argv.find((a) => a.startsWith('--max=')) || '--max=15').split('=')[1]);
  console.log(`Kandidaten zoeken via GitHub code-search (max ${max})...`);
  const origins = await vindKandidaatOrigins(max);
  console.log(`${origins.length} echte, levende origins gevonden om te scannen.`);

  const resultaten = [];
  for (const origin of origins) {
    await sleep(300);
    console.log(`scannen: ${origin}`);
    const r = await scanVerkoper(origin);
    resultaten.push(r);
    console.log(`  -> ${r.oordeel.label} (${r.oordeel.score ?? 0})`);
  }

  resultaten.sort((a, b) => (b.oordeel.score ?? 0) - (a.oordeel.score ?? 0));
  mkdirSync('vectors/seller-prescan', { recursive: true });
  writeFileSync('vectors/seller-prescan/scan-resultaat.json', JSON.stringify({ gemeten: new Date().toISOString(), zoekopdracht: 'filename:x402.json path:.well-known (GitHub code search)', aantal_gescand: resultaten.length, resultaten }, null, 2) + '\n');

  const rijen = resultaten.map((r) => `| ${r.origin} | ${r.oordeel.label} | ${r.oordeel.score ?? 0} | ${r.resources.length} | ${r.resources.filter((x) => x.bereikbaar).length} |`).join('\n');
  const md = `# Seller pre-scan: wie publiceert echt een werkend x402-discoverybestand

Gemeten: ${new Date().toISOString()}
Zoekopdracht: GitHub code-search \`filename:x402.json path:.well-known\`, alleen echte (niet-fork) repos, origin afgeleid uit de eerste resource-url (veld \`url\` of \`resource\`, beide vormen gezien in echte bestanden) in het bestand.

## Wat dit is, en wat niet

Dit is een READ-ONLY check van een verkoper se discovery-oppervlak (het per-origin \`/.well-known/x402.json\`-bestand uit [x402-foundation/x402#2582](https://github.com/x402-foundation/x402/issues/2582), nog geen geratificeerde spec): bestaat het, is het geldig, antwoorden de genoemde endpoints. Geen enkele betaling is gedaan; elke status-code (ook 402, dat bewijst juist dat een endpoint leeft en x402 spreekt) telt als "bereikbaar", alleen een netwerk-/DNS-/timeout-fout telt als onbereikbaar. Dit beantwoordt NIET of een betaalde reactie klopt met wat beloofd werd (dat vraagt een echte betaling, een apart, duurder onderzoek, nog niet gedaan).

Dit is iets anders dan \`vectors/facilitator-request-binding/\` in deze repo: die vectoren tonen een gat in het PROTOCOL zelf. Dit hier beoordeelt losse VERKOPERS vooraf, voor een agent iets koopt.

## De formule, volledig narekenbaar (src/seller-prescan.mjs, \`berekenOordeel\`)

- Discovery-bestand bereikbaar en geldige JSON: 20% (kan weegt as "bestaat het überhaupt").
- Schema geldig (een leesbare resources-lijst met url's): 30% (een leeg of onleesbaar bestand dat toevallig 200 teruggeeft is net zo nutteloos als geen bestand).
- Fractie van de genoemde endpoints die een echt antwoord geven: 50% (dit is de kern: doet het ook wat het zegt).

Geen geldig schema → altijd VERMIJD, ongeacht de rest. Score ≥ 0.85 → OK, ≥ 0.5 → LET-OP, lager → VERMIJD.

| Origin | Oordeel | Score | Resources | Bereikbaar |
| --- | --- | --- | --- | --- |
${rijen}
`;
  writeFileSync('vectors/seller-prescan/README.md', md);
  console.log('\nWeggeschreven naar vectors/seller-prescan/.');
}

main().catch((e) => { console.error('FOUT:', e.message); process.exit(1); });
